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

/** Run one tool against the local agent (browser → 127.0.0.1:8787). */
export async function runLocalAgentTool(call: AgentToolCall): Promise<string> {
  try {
    switch (call.name) {
      case "list_dir": {
        const data = await agentListDir(call.args.path || ".");
        return formatToolResultForModel(data);
      }
      case "read_file": {
        if (!call.args.path) return JSON.stringify({ error: "path required" });
        const file = await agentReadFile(call.args.path);
        const text = file.text.length > 100_000 ? `${file.text.slice(0, 100_000)}\n…(truncated)` : file.text;
        return formatToolResultForModel({ path: file.path, text });
      }
      case "search_code": {
        if (!call.args.query) return JSON.stringify({ error: "query required" });
        const data = await agentSearch(call.args.query, call.args.path || ".");
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
      case "run_terminal": {
        if (!call.args.command) return JSON.stringify({ error: "command required" });
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

export function formatAgentProgress(steps: { call: AgentToolCall; result: string }[], live?: string) {
  const lines = ["**Agent working…**", ""];
  for (const s of steps) {
    const argSummary =
      s.call.name === "write_file"
        ? s.call.args.path || ""
        : s.call.name === "run_terminal"
          ? s.call.args.command || ""
          : s.call.name === "search_code"
            ? s.call.args.query || ""
            : s.call.args.path || Object.values(s.call.args)[0] || "";
    let ok = true;
    try {
      const j = JSON.parse(s.result) as { error?: string; ok?: boolean };
      if (j.error || j.ok === false) ok = false;
    } catch {
      /* plain */
    }
    lines.push(`- \`${s.call.name}\` ${argSummary ? `\`${argSummary}\`` : ""} → ${ok ? "ok" : "error"}`);
  }
  if (live) lines.push(`- _${live}_`);
  return lines.join("\n");
}
