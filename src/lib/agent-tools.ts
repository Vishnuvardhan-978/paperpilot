/** Cursor-like agent tool protocol (Gemini native function calling ↔ local agent). */

export type AgentToolName =
  | "list_dir"
  | "find_files"
  | "read_file"
  | "search_code"
  | "edit_file"
  | "write_file"
  | "run_terminal";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  args: Record<string, string>;
};

export type AgentToolStep = {
  call: AgentToolCall;
  result: string;
  thought?: string;
};

const TOOL_NAMES = new Set<AgentToolName>([
  "list_dir",
  "find_files",
  "read_file",
  "search_code",
  "edit_file",
  "write_file",
  "run_terminal",
]);

/** Model round-trips per request (each round may run several tools). */
export const MAX_AGENT_STEPS = 25;

export const AGENT_FUNCTIONS: Record<string, unknown>[] = [
  {
    name: "find_files",
    description:
      "Find files in the project by name. Accepts a substring (\"login\") or a glob (\"*.jsp\", \"src/**/user*.ts\"). Use this to locate files before reading.",
    parametersJsonSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "list_dir",
    description: "List the entries of one directory (relative to the project root; \".\" is the root).",
    parametersJsonSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a file. Returns numbered lines (\"  12| code\"), at most 600 per call; if the result says more: true, call again with the next start_line. The line-number prefix is NOT part of the file.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer", description: "1-based, optional" },
        end_line: { type: "integer", description: "optional" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description:
      "Search file contents across the project (like grep). Returns path, line number and the matching line. Use to find where something is defined or used.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string", description: "folder to search in, default \".\"" },
        regex: { type: "boolean", description: "treat query as a regular expression" },
        case_sensitive: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "edit_file",
    description:
      "Edit an existing file by exact text replacement. Each old_text must be copied exactly from the file (without line numbers) and match exactly once unless replace_all is true; include 2-3 surrounding lines to make it unique. Put several edits in one call. Use an empty new_text to delete.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              old_text: { type: "string" },
              new_text: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["old_text", "new_text"],
          },
        },
      },
      required: ["path", "edits"],
    },
  },
  {
    name: "write_file",
    description: "Create a NEW file (or fully replace a very small one). Never use this to rewrite a large existing file — use edit_file.",
    parametersJsonSchema: {
      type: "object",
      properties: { path: { type: "string" }, text: { type: "string" } },
      required: ["path", "text"],
    },
  },
  {
    name: "run_terminal",
    description:
      "Run a short shell command in the project (Windows cmd.exe), e.g. git status, npm test, mvn -q compile. Not for reading or editing files. Times out after ~45s.",
    parametersJsonSchema: {
      type: "object",
      properties: { command: { type: "string" }, cwd: { type: "string", description: "relative folder, default \".\"" } },
      required: ["command"],
    },
  },
];

const ARG_ALIASES: Record<string, string> = {
  cmd: "command",
  file: "path",
  file_path: "path",
  filepath: "path",
  content: "text",
  contents: "text",
  old_string: "old_text",
  new_string: "new_text",
  glob: "pattern",
  name: "pattern",
};

/** Function-call args arrive as typed JSON; tools take strings (arrays/objects as JSON). */
export function normalizeToolArgs(raw: Record<string, unknown> | undefined): Record<string, string> {
  const args: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const key = ARG_ALIASES[k] || k;
    if (key in args && key !== k) continue;
    if (v === undefined || v === null) continue;
    args[key] = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  }
  return args;
}

export function toToolCall(fc: { name?: string; args?: Record<string, unknown>; id?: string }, index = 0): AgentToolCall | null {
  const name = fc.name as AgentToolName | undefined;
  if (!name || !TOOL_NAMES.has(name)) return null;
  return { id: fc.id || `t_${Date.now()}_${index}`, name, args: normalizeToolArgs(fc.args) };
}

const MAX_TREE_IN_PROMPT = 900;

export function buildAgentSystemPrompt(opts: {
  projectName: string;
  root?: string;
  paths: string[];
  focusPath?: string | null;
}) {
  const shown = opts.paths.slice(0, MAX_TREE_IN_PROMPT);
  const more = opts.paths.length - shown.length;
  return `You are PaperPilot, an expert senior software engineer working as a coding agent inside the user's project — like Cursor. You act through tools that run on the user's machine.

How to work:
1. Understand first: locate the relevant code with find_files / search_code, then read_file the parts you need. Never guess file contents or invent APIs.
2. Make the change with edit_file (exact old_text → new_text, several edits per call). Keep the existing style, indentation and line endings. Only change what the request needs.
3. Verify: re-read the edited region if unsure. Run a build/test with run_terminal only when it is cheap and relevant.
4. Finish with a short summary for the user: what you changed (file + what), and anything they should check. Use markdown, keep it brief. Do not paste whole files back.

Rules:
- When the user says "this file", they mean the focused file.
- Prefer several small precise edits over rewriting. write_file is only for new files.
- Big jobs (e.g. remove all comments in a long file): read the whole file in chunks, then apply edits in batches of ~20 per edit_file call until done.
- If a tool returns an error, read it and change approach — never repeat the identical failing call.
- If the request is a question (no change needed), answer it after looking at the code.
- Short follow-ups like "continue" or "do the same for X" refer to the earlier conversation.

Project: ${opts.projectName}${opts.root ? ` (${opts.root})` : ""}
Platform: Windows
${opts.focusPath ? `Focused file (open in the editor): ${opts.focusPath}\n` : ""}
Project files (${opts.paths.length}${more > 0 ? `, first ${shown.length} shown — use find_files for the rest` : ""}):
${shown.join("\n")}`;
}

export function buildAgentUserMessage(opts: {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
}) {
  const history = (opts.history || [])
    .filter((m) => m.content.trim())
    .slice(-8)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 2500)}`)
    .join("\n\n");
  return history ? `Earlier conversation:\n${history}\n\n---\nCurrent request:\n${opts.question}` : opts.question;
}

export function formatToolResultForModel(data: unknown): string {
  try {
    const s = JSON.stringify(data, null, 2);
    return s.length > 60000 ? `${s.slice(0, 60000)}\n…(truncated)` : s;
  } catch {
    return String(data);
  }
}

/** One-line description of a tool call for the chat UI. */
export function describeToolCall(call: AgentToolCall): { verb: string; target: string } {
  const a = call.args;
  switch (call.name) {
    case "find_files":
      return { verb: "Find files", target: a.pattern || "" };
    case "list_dir":
      return { verb: "List", target: a.path || "." };
    case "read_file":
      return {
        verb: "Read",
        target: `${a.path || ""}${a.start_line ? ` L${a.start_line}${a.end_line ? `-${a.end_line}` : "+"}` : ""}`,
      };
    case "search_code":
      return { verb: "Search", target: a.query || "" };
    case "edit_file": {
      let n = 0;
      try {
        n = a.edits ? (JSON.parse(a.edits) as unknown[]).length : a.old_text ? 1 : 0;
      } catch {
        n = 0;
      }
      return { verb: "Edit", target: `${a.path || ""}${n > 1 ? ` (${n} edits)` : ""}` };
    }
    case "write_file":
      return { verb: "Write", target: a.path || "" };
    case "run_terminal":
      return { verb: "Run", target: a.command || "" };
    default:
      return { verb: call.name, target: "" };
  }
}

/** Short status for a tool result: null when ok, else the error text. */
export function toolResultError(call: AgentToolCall, result: string): string | null {
  try {
    const j = JSON.parse(result) as { error?: string; ok?: boolean; code?: number };
    if (j.error) return j.error;
    if (j.ok === false) return call.name === "run_terminal" ? `exit ${j.code ?? "?"}` : "failed";
  } catch {
    /* plain text results are successes */
  }
  return null;
}
