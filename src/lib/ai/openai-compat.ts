/**
 * Streaming chat client for OpenAI-compatible services (Groq, OpenRouter, Cloudflare, vLLM,
 * the PaperPilot server), plus conversion between the agent's Gemini-shaped history and
 * OpenAI messages, so the browser-side agent loop stays unchanged.
 */
import type { CompatProvider } from "@/lib/ai/providers";

export type OAToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type OAMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OAToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type GeminiLikeContent = { role: "user" | "model"; parts: Record<string, unknown>[] };

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: "quota" | "auth" | "model" | "busy" | "bad_request" | "network",
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

function classify(status: number, body: string): ProviderError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || status === 402) return "quota";
  if (status === 404 || /model[^.]{0,40}(not found|does not exist|decommissioned|not available|no endpoints)/i.test(body)) return "model";
  if (status >= 500) return "busy";
  return "bad_request";
}

function retryAfter(res: Response, body: string) {
  const header = res.headers.get("retry-after");
  if (header && /^\d+(\.\d+)?$/.test(header)) return Math.ceil(parseFloat(header) * 1000);
  const m = /try again in\s*(?:(\d+)m)?\s*(\d+(?:\.\d+)?)s/i.exec(body);
  return m ? Math.ceil(((Number(m[1]) || 0) * 60 + parseFloat(m[2])) * 1000) : null;
}

/* ---------- format conversion ---------- */

export function toolsFromDeclarations(decls: Record<string, unknown>[]) {
  return decls.map((d) => ({
    type: "function" as const,
    function: {
      name: String(d.name),
      description: String(d.description || ""),
      parameters: (d.parametersJsonSchema || d.parameters || { type: "object", properties: {} }) as Record<string, unknown>,
    },
  }));
}

function stringifyOutput(response: unknown) {
  const out = (response as { output?: unknown } | undefined)?.output ?? response;
  return typeof out === "string" ? out : JSON.stringify(out ?? "");
}

/**
 * Gemini history → OpenAI messages. Calls without ids (Gemini doesn't always give one) get
 * stable synthetic ids, matched to their responses by tool name in order.
 */
export function toOpenAIMessages(system: string, contents: GeminiLikeContent[]): OAMessage[] {
  const messages: OAMessage[] = [{ role: "system", content: system }];
  const pending: { id: string; name: string }[] = [];

  contents.forEach((turn, t) => {
    if (turn.role === "model") {
      const text = turn.parts
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text as string)
        .join("");
      const calls: OAToolCall[] = [];
      turn.parts.forEach((p, i) => {
        const fc = p.functionCall as { id?: string; name?: string; args?: unknown } | undefined;
        if (!fc?.name) return;
        const id = fc.id || `call_${t}_${i}`;
        pending.push({ id, name: fc.name });
        calls.push({ id, type: "function", function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) } });
      });
      if (text || calls.length) messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      return;
    }
    const texts: string[] = [];
    for (const p of turn.parts) {
      const fr = p.functionResponse as { id?: string; name?: string; response?: unknown } | undefined;
      if (fr) {
        const idx = fr.id ? pending.findIndex((c) => c.id === fr.id) : pending.findIndex((c) => c.name === fr.name);
        const id = idx >= 0 ? pending.splice(idx, 1)[0].id : fr.id || `call_${t}_orphan`;
        messages.push({ role: "tool", tool_call_id: id, content: stringifyOutput(fr.response) });
      } else if (typeof p.text === "string") {
        texts.push(p.text);
      }
    }
    if (texts.length) messages.push({ role: "user", content: texts.join("\n") });
  });
  return messages;
}

/* ---------- streaming ---------- */

export type CompatChunk =
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_calls"; calls: { id: string; name: string; args: Record<string, unknown> }[] }
  | { type: "usage"; promptTokens: number; completionTokens: number };

const FIRST_CHUNK_TIMEOUT_MS = 60_000;
const STALL_TIMEOUT_MS = 90_000;

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export async function* streamCompatChat(opts: {
  provider: CompatProvider;
  model: string;
  messages: OAMessage[];
  tools?: ReturnType<typeof toolsFromDeclarations>;
  temperature?: number;
  signal?: AbortSignal;
}): AsyncGenerator<CompatChunk> {
  const { provider } = opts;
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);
  let timer = setTimeout(() => ctrl.abort(), FIRST_CHUNK_TIMEOUT_MS);

  try {
    let res: Response;
    try {
      res = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}`, ...provider.headers },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          stream: true,
          temperature: opts.temperature ?? 0.2,
          ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new ProviderError(
        ctrl.signal.aborted ? `${provider.label} did not respond in time` : `${provider.label} unreachable: ${e instanceof Error ? e.message : e}`,
        0,
        "network",
      );
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const detail = /"message"\s*:\s*"([^"]{1,300})"/.exec(body)?.[1] || body.slice(0, 300) || res.statusText;
      throw new ProviderError(`${provider.label} ${res.status}: ${detail}`, res.status, classify(res.status, body), retryAfter(res, body));
    }

    const calls = new Map<number, { id: string; name: string; args: string }>();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handle = function* (line: string): Generator<CompatChunk> {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      let json: {
        choices?: {
          delta?: {
            content?: string | null;
            reasoning?: string | null;
            reasoning_content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string; code?: number | string };
      };
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      if (json.error) {
        const code = Number(json.error.code) || 500;
        throw new ProviderError(`${provider.label}: ${json.error.message || "stream error"}`, code, classify(code, json.error.message || ""));
      }
      const delta = json.choices?.[0]?.delta;
      const thought = delta?.reasoning_content || delta?.reasoning;
      if (thought) yield { type: "thought", text: thought };
      if (delta?.content) yield { type: "text", text: delta.content };
      for (const tc of delta?.tool_calls || []) {
        const idx = tc.index ?? calls.size;
        const cur = calls.get(idx) || { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (json.usage) {
        yield { type: "usage", promptTokens: json.usage.prompt_tokens || 0, completionTokens: json.usage.completion_tokens || 0 };
      }
    };

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if (opts.signal?.aborted) throw e;
        throw new ProviderError(`${provider.label} stream ${ctrl.signal.aborted ? "stalled (timeout)" : "broke"}`, 0, "network");
      }
      if (chunk.done) break;
      clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort(), STALL_TIMEOUT_MS);
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        yield* handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
    }
    yield* handle(buffer);

    if (calls.size) {
      yield {
        type: "tool_calls",
        calls: [...calls.entries()]
          .sort((a, b) => a[0] - b[0])
          .filter(([, c]) => c.name)
          .map(([i, c]) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, args: parseArgs(c.args) })),
      };
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}
