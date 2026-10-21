import {
  agentExec,
  agentListDir,
  agentReadFile,
  agentSearch,
  agentWriteFile,
} from "@/lib/local-agent";
import {
  formatToolResultForModel,
  type AgentToolCall,
} from "@/lib/agent-tools";
import { planFileEdit } from "@/lib/apply-edit";
import { stripComments } from "@/lib/strip-comments";

const READ_CHUNK_LINES = 600;

/** Inline scripts break on cmd.exe quoting, and the model uses them to bypass reviewed file edits. */
const INLINE_SCRIPT = /\b(node|python3?|py|deno|bun)(\.exe)?\s+(-e|--eval|-p|--print|-c)\b|\bpowershell(\.exe)?\b.*-(c|command|encodedcommand)\b/i;
const WRITES_FILES = /writeFile|Set-Content|Out-File|Add-Content|WriteAllText|open\([^)]*['"]w|>\s*[\w./\\-]+\.\w+/i;

function terminalCommandProblem(command: string) {
  if (INLINE_SCRIPT.test(command) && (WRITES_FILES.test(command) || command.length > 200)) {
    return "Blocked: long inline scripts (node -e / python -c / powershell -c) break in cmd.exe and must not modify files. Change files with edit_file, write_file or remove_comments.";
  }
  if (/[\r\n]/.test(command)) return "Blocked: cmd.exe runs one line at a time. Send a single-line command.";
  return null;
}

/** For classic scripts, refuse a comment strip that would turn parseable code into a syntax error. */
function breaksScript(path: string, before: string, after: string) {
  if (!/\.(js|cjs)$/i.test(path)) return false;
  const parses = (code: string) => {
    try {
      new Function(code);
      return true;
    } catch {
      return false;
    }
  };
  return parses(before) && !parses(after);
}

/** Models sometimes paste read_file output with its "  12| " prefixes; drop them only if every line has one. */
function stripLineNumbers(text: string) {
  const lines = text.split(/\r?\n/);
  const prefix = /^\s*\d+\| ?/;
  return lines.every((l) => prefix.test(l)) ? lines.map((l) => l.replace(prefix, "")).join("\n") : text;
}

type TextEdit = { old_text: string; new_text: string; replace_all: boolean };

const truthy = (v: unknown) => v === true || /^(true|1|yes)$/i.test(String(v ?? ""));

function parseEdits(args: Record<string, string>): TextEdit[] {
  if (args.edits) {
    try {
      const list = JSON.parse(args.edits) as Record<string, unknown>[];
      if (Array.isArray(list)) {
        return list
          .map((e) => ({
            old_text: String(e.old_text ?? e.old_string ?? e.search ?? e.find ?? ""),
            new_text: String(e.new_text ?? e.new_string ?? e.replace ?? e.replacement ?? ""),
            replace_all: truthy(e.replace_all),
          }))
          .filter((e) => e.old_text);
      }
    } catch {
      /* fall through to single edit */
    }
  }
  if (!args.old_text) return [];
  return [{ old_text: args.old_text, new_text: args.new_text ?? "", replace_all: truthy(args.replace_all) }];
}

function globToRegExp(pattern: string) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i++;
      if (pattern[i + 1] === "/") i++;
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`(^|/)${re}$`, "i");
}

function findFiles(pattern: string, paths: string[]) {
  const p = pattern.trim().replace(/\\/g, "/");
  const matcher = /[*?]/.test(p)
    ? (path: string) => globToRegExp(p).test(path)
    : (path: string) => path.toLowerCase().includes(p.toLowerCase());
  const hits = paths.filter(matcher);
  return { pattern: p, count: hits.length, files: hits.slice(0, 200), truncated: hits.length > 200 };
}

/** Run one tool against the local agent (browser → 127.0.0.1:8787). */
export async function runLocalAgentTool(call: AgentToolCall, ctx: { paths?: string[] } = {}): Promise<string> {
  try {
    switch (call.name) {
      case "find_files": {
        if (!call.args.pattern) return JSON.stringify({ error: "pattern required" });
        return formatToolResultForModel(findFiles(call.args.pattern, ctx.paths || []));
      }
      case "list_dir": {
        const data = await agentListDir(call.args.path || ".");
        return formatToolResultForModel(data);
      }
      case "read_file": {
        if (!call.args.path) return JSON.stringify({ error: "path required" });
        const file = await agentReadFile(call.args.path);
        const lines = file.text.replace(/\r\n/g, "\n").split("\n");
        const start = Math.max(1, parseInt(call.args.start_line || "1", 10) || 1);
        const wantEnd = parseInt(call.args.end_line || "", 10);
        const end = Math.min(lines.length, start + READ_CHUNK_LINES - 1, wantEnd > 0 ? wantEnd : Infinity);
        const width = String(end).length;
        const body = lines
          .slice(start - 1, end)
          .map((l, i) => `${String(start + i).padStart(width)}| ${l}`)
          .join("\n");
        const more = end < lines.length;
        return `path: ${file.path}\ntotal_lines: ${lines.length}\nshowing: ${start}-${end}\nmore: ${more}${
          more ? ` (call read_file again with start_line ${end + 1})` : ""
        }\n---\n${body}`;
      }
      case "edit_file": {
        const { path } = call.args;
        if (!path) {
          return JSON.stringify({
            error: `path required — put "path" inside "args". Got args keys: ${Object.keys(call.args).join(", ") || "none"}`,
          });
        }
        const edits = parseEdits(call.args);
        if (!edits.length) return JSON.stringify({ error: "old_text (or an edits array) required" });
        const before = (await agentReadFile(path)).text;
        const crlf = before.includes("\r\n");
        const norm = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s.replace(/\r\n/g, "\n"));
        let next = before;
        let replacements = 0;
        const failed: string[] = [];
        for (const [i, e] of edits.entries()) {
          const find = norm(stripLineNumbers(e.old_text));
          const repl = norm(e.new_text);
          const count = find ? next.split(find).length - 1 : 0;
          const label = `edit ${i + 1} (${e.old_text.split("\n")[0].slice(0, 60)})`;
          if (count === 0) {
            failed.push(`${label}: old_text not found — copy it exactly from read_file (no line numbers)`);
            continue;
          }
          if (count > 1 && !e.replace_all) {
            failed.push(`${label}: appears ${count} times — add surrounding lines or set replace_all`);
            continue;
          }
          next = e.replace_all ? next.split(find).join(repl) : next.replace(find, () => repl);
          replacements += e.replace_all ? count : 1;
        }
        if (!replacements) return JSON.stringify({ error: failed.join("; ") });
        const result = await agentWriteFile(path, next);
        return formatToolResultForModel({
          ok: true,
          path,
          replacements,
          failed: failed.length ? failed : undefined,
          backup: result.backup || null,
        });
      }
      case "search_code": {
        if (!call.args.query) return JSON.stringify({ error: "query required" });
        const data = await agentSearch(call.args.query, call.args.path || ".", {
          regex: /^true$/i.test(call.args.regex || ""),
          caseSensitive: /^true$/i.test(call.args.case_sensitive || ""),
        });
        return formatToolResultForModel(data);
      }
      case "write_file": {
        if (!call.args.path || typeof call.args.text !== "string") {
          return JSON.stringify({ error: "path and text required" });
        }
        let before = "";
        try {
          before = (await agentReadFile(call.args.path)).text;
        } catch {
          before = "";
        }
        const plan = planFileEdit(before, call.args.text);
        if (plan.warning && plan.nextText === before) {
          return formatToolResultForModel({ ok: false, error: plan.warning, mode: plan.mode });
        }
        const result = await agentWriteFile(call.args.path, plan.nextText);
        return formatToolResultForModel({
          ok: true,
          path: call.args.path,
          mode: plan.mode,
          warning: plan.warning || null,
          backup: result.backup || null,
          bytes: result.bytes,
        });
      }
      case "remove_comments": {
        const { path } = call.args;
        if (!path) return JSON.stringify({ error: "path required" });
        const before = (await agentReadFile(path)).text;
        const { text, removed } = stripComments(path, before);
        if (!removed) return formatToolResultForModel({ ok: true, path, comments_removed: 0, note: "No comments found." });
        if (breaksScript(path, before, text)) {
          return JSON.stringify({ error: "Removing comments would break this script's syntax; file left unchanged. Remove them with edit_file instead." });
        }
        const result = await agentWriteFile(path, text);
        return formatToolResultForModel({
          ok: true,
          path,
          comments_removed: removed,
          lines_before: before.split(/\r?\n/).length,
          lines_after: text.split(/\r?\n/).length,
          backup: result.backup || null,
        });
      }
      case "run_terminal": {
        if (!call.args.command) return JSON.stringify({ error: "command required" });
        const problem = terminalCommandProblem(call.args.command);
        if (problem) return JSON.stringify({ error: problem });
        const data = await agentExec(call.args.command, call.args.cwd || ".");
        return formatToolResultForModel(data);
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${call.name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
  }
}
