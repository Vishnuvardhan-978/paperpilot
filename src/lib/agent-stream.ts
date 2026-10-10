import type { AgentToolCall } from "@/lib/agent-tools";
import type { AgentContent } from "@/lib/gemini";

export type AgentStepRequest = {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  project: { name: string; root?: string; paths: string[] };
  focusPath?: string | null;
  turns: AgentContent[];
  model?: string | null;
};

export type AgentStepResult = {
  model: string;
  modelContent: AgentContent;
  calls: AgentToolCall[];
  text: string;
};

/** Last paragraph of the model's thinking summary, for a one-line "thinking…" status. */
export function lastThought(thought: string) {
  const paras = thought.trim().split(/\n\s*\n/);
  const last = (paras[paras.length - 1] || "").replace(/\*\*/g, "").trim();
  return last.length > 220 ? `${last.slice(0, 220)}…` : last || undefined;
}

/** Keep request size bounded: tool outputs older than the last two rounds are shortened. */
export function compactOldToolResults(turns: AgentContent[], keepRounds = 2, maxChars = 3000) {
  const toolTurnIdx = turns.map((t, i) => (t.role === "user" ? i : -1)).filter((i) => i >= 0);
  for (const idx of toolTurnIdx.slice(0, -keepRounds)) {
    turns[idx] = {
      ...turns[idx],
      parts: turns[idx].parts.map((p) => {
        const fr = p.functionResponse as { response?: { output?: string } } | undefined;
        const out = fr?.response?.output;
        if (typeof out !== "string" || out.length <= maxChars) return p;
        return {
          ...p,
          functionResponse: { ...fr, response: { output: `${out.slice(0, maxChars)}\n…(older output shortened)` } },
        };
      }),
    };
  }
}

/** Calls /api/agent/step; reports live thinking and answer text as they stream in. */
export async function streamAgentStep(
  body: AgentStepRequest,
  signal: AbortSignal,
  onLive: (live: { thought: string; text: string }) => void,
): Promise<AgentStepResult> {
  const res = await fetch("/api/agent/step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Agent step failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let thought = "";
  let text = "";
  let result: AgentStepResult | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as
      | { type: "thought" | "text"; text: string }
      | { type: "reset" }
      | ({ type: "result" } & AgentStepResult)
      | { type: "error"; error: string };
    if (msg.type === "thought") thought += msg.text;
    else if (msg.type === "text") text += msg.text;
    else if (msg.type === "reset") {
      thought = "";
      text = "";
    } else if (msg.type === "result") {
      result = { model: msg.model, modelContent: msg.modelContent, calls: msg.calls, text: msg.text };
      return;
    } else if (msg.type === "error") throw new Error(msg.error);
    onLive({ thought, text });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  handleLine(buffer);

  if (!result) throw new Error("Agent stream ended without a result");
  return result;
}
