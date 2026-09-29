/** Cursor-like agent tool protocol (model ↔ local agent). */

export type AgentToolName = "list_dir" | "read_file" | "search_code" | "write_file" | "run_terminal";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  args: Record<string, string>;
};

export type AgentToolStep = {
  call: AgentToolCall;
  result: string;
};

export type AgentStepDecision =
  | { action: "tool"; call: AgentToolCall }
  | { action: "done"; text: string };

const TOOL_NAMES = new Set<AgentToolName>([
  "list_dir",
  "read_file",
  "search_code",
  "write_file",
  "run_terminal",
]);

export const MAX_AGENT_STEPS = 8;

export function buildAgentStepPrompt(opts: {
  question: string;
  focusPath?: string | null;
  documentName?: string;
  steps: AgentToolStep[];
  workspaceHint?: string;
}) {
  const focus = opts.focusPath ? `\nFocused file: ${opts.focusPath}` : "";
  const hint = opts.workspaceHint ? `\nWorkspace note: ${opts.workspaceHint}` : "";
  const trace =
    opts.steps.length === 0
      ? "(no tools run yet)"
      : opts.steps
          .map(
            (s, i) =>
              `### Step ${i + 1}: ${s.call.name}\nArgs: ${JSON.stringify(s.call.args)}\nResult:\n${s.result.slice(0, 6000)}`,
          )
          .join("\n\n");

  return `You are PaperPilot coding agent (Cursor-like). You can call tools on the user's local machine via a local agent.
Project: ${opts.documentName || "workspace"}${focus}${hint}

Rules:
- Prefer tools over guessing file contents.
- For edits: read the file first, then write_file with the FULL updated file contents (or a careful full replacement). Never wipe a large file with a tiny snippet.
- Prefer SEARCH-style edits only when you write the complete intended file body after merging mentally.
- run_terminal is for short safe commands (git status, npm test, dir/ls). No destructive system commands.
- After enough info, finish with a clear answer for the user.
- Max useful tool calls; do not loop forever.

Respond with ONLY one JSON object (no markdown fences), either:
{"action":"tool","call":{"name":"read_file","args":{"path":"src/app.js"}}}
or
{"action":"done","text":"markdown answer for the user"}

Allowed tools:
- list_dir args: { "path": "." }
- read_file args: { "path": "relative/file" }
- search_code args: { "query": "text", "path": "." }
- write_file args: { "path": "relative/file", "text": "full file contents" }
- run_terminal args: { "command": "git status", "cwd": "." }

User request:
${opts.question}

Tool trace so far:
${trace}
`;
}

/** Parse model JSON decision; tolerate ```json fences. */
export function parseAgentDecision(raw: string): AgentStepDecision {
  let text = (raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // Prefer first JSON object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { action: "done", text: raw.trim() || "No response." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { action: "done", text: raw.trim() };
  }

  const obj = parsed as {
    action?: string;
    text?: string;
    call?: { name?: string; args?: Record<string, unknown>; id?: string };
  };

  if (obj.action === "done" || (!obj.action && typeof obj.text === "string")) {
    return { action: "done", text: String(obj.text || raw).trim() || "Done." };
  }

  const name = obj.call?.name as AgentToolName | undefined;
  if (obj.action === "tool" && name && TOOL_NAMES.has(name)) {
    const args: Record<string, string> = {};
    const rawArgs = obj.call?.args || {};
    for (const [k, v] of Object.entries(rawArgs)) {
      args[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return {
      action: "tool",
      call: {
        id: obj.call?.id || `t_${Date.now()}`,
        name,
        args,
      },
    };
  }

  return { action: "done", text: raw.trim() || "Could not parse agent response." };
}

export function formatToolResultForModel(data: unknown): string {
  try {
    const s = JSON.stringify(data, null, 2);
    return s.length > 12000 ? `${s.slice(0, 12000)}\n…(truncated)` : s;
  } catch {
    return String(data);
  }
}
