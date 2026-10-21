/**
 * One entry point for chat and the coding agent: tries each configured provider in order
 * (AI_PROVIDERS) and falls through on quota / outage / missing model.
 */
import {
  streamGeminiAgentTurn,
  streamWithFallback as streamGeminiText,
  type AgentContent,
  type AgentStreamEvent,
  type ContentPart,
} from "@/lib/gemini";
import { ProviderError, streamCompatChat, toOpenAIMessages, toolsFromDeclarations } from "@/lib/ai/openai-compat";
import {
  compatProvider,
  modelRef,
  modelsFor,
  parseModelRef,
  providerLabel,
  providerOrder,
  type CompatProvider,
  type ProviderId,
} from "@/lib/ai/providers";

export type { AgentContent, AgentStreamEvent, ContentPart };

const MAX_SHORT_WAIT_MS = 12_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function shortReason(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  if (/used up today's free quota|per.?day/i.test(msg)) return "daily free quota used up";
  if (error instanceof ProviderError) {
    if (error.kind === "quota") return error.retryAfterMs ? `rate limited (retry in ${Math.ceil(error.retryAfterMs / 1000)}s)` : "rate limit / quota reached";
    if (error.kind === "auth") return "key rejected";
    if (error.kind === "model") return "model unavailable";
    if (error.kind === "busy") return "service busy";
    if (error.kind === "network") return "no response";
  }
  return msg.replace(/\s+/g, " ").slice(0, 120);
}

function allFailed(failures: { provider: ProviderId; error: unknown }[]) {
  if (!failures.length) {
    return new Error("No AI provider is configured. Add GEMINI_API_KEY (or GROQ_API_KEY / OPENROUTER_API_KEY) to .env.local.");
  }
  if (failures.length === 1) {
    const only = failures[0].error;
    return only instanceof Error ? only : new Error(String(only));
  }
  const lines = failures.map((f) => `${providerLabel(f.provider)}: ${shortReason(f.error)}`).join("; ");
  return new Error(`Every AI provider failed — ${lines}. Try again shortly, or add another provider key.`);
}

/** Which providers may continue this run. Gemini needs its own thought signatures, so a run that started elsewhere never moves to Gemini. */
function agentProviders(pinned: string | null | undefined): { provider: ProviderId; model: string | null }[] {
  const order = providerOrder();
  if (!pinned) return order.map((provider) => ({ provider, model: null }));
  const ref = parseModelRef(pinned);
  const rest = order.filter((p) => p !== ref.provider && p !== "gemini").map((provider) => ({ provider, model: null }));
  return [{ provider: ref.provider, model: ref.model }, ...rest];
}

async function* compatAgentTurn(
  p: CompatProvider,
  models: string[],
  opts: { contents: AgentContent[]; systemInstruction: string; functionDeclarations: Record<string, unknown>[] },
): AsyncGenerator<AgentStreamEvent> {
  const messages = toOpenAIMessages(opts.systemInstruction, opts.contents);
  const tools = toolsFromDeclarations(opts.functionDeclarations);
  let lastError: unknown = new Error(`${p.label}: no model available`);

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const parts: Record<string, unknown>[] = [];
      let yielded = false;
      try {
        let thought = "";
        let text = "";
        for await (const chunk of streamCompatChat({ provider: p, model, messages, tools })) {
          if (chunk.type === "thought") {
            thought += chunk.text;
            yielded = true;
            yield chunk;
          } else if (chunk.type === "text") {
            text += chunk.text;
            yielded = true;
            yield chunk;
          } else if (chunk.type === "tool_calls") {
            if (thought) parts.push({ text: thought, thought: true });
            thought = "";
            for (const c of chunk.calls) parts.push({ functionCall: { id: c.id, name: c.name, args: c.args } });
          }
        }
        if (thought) parts.unshift({ text: thought, thought: true });
        if (text) parts.push({ text });
        if (!parts.some((x) => x.functionCall || (typeof x.text === "string" && !x.thought))) {
          throw new ProviderError(`${p.label} returned an empty answer`, 502, "busy");
        }
        yield { type: "done", model: modelRef(p.id, model), parts };
        return;
      } catch (error) {
        lastError = error;
        if (yielded) yield { type: "reset" };
        const pe = error instanceof ProviderError ? error : null;
        if (pe?.kind === "auth") throw error;
        const wait = pe?.kind === "quota" || pe?.kind === "busy" ? (pe.retryAfterMs ?? 2000) : null;
        if (wait !== null && wait <= MAX_SHORT_WAIT_MS && attempt < 2) {
          if (wait >= 3000) yield { type: "wait", seconds: Math.ceil(wait / 1000), attempt, provider: p.label };
          await sleep(wait);
          continue;
        }
        if (pe?.kind === "quota") throw error;
        break;
      }
    }
  }
  throw lastError;
}

/** One coding-agent turn on the first provider that answers. */
export async function* streamAgentTurn(opts: {
  contents: AgentContent[];
  systemInstruction: string;
  functionDeclarations: Record<string, unknown>[];
  model?: string | null;
}): AsyncGenerator<AgentStreamEvent> {
  const failures: { provider: ProviderId; error: unknown }[] = [];
  for (const { provider, model } of agentProviders(opts.model)) {
    try {
      if (provider === "gemini") {
        yield* streamGeminiAgentTurn({ ...opts, model });
        return;
      }
      const p = compatProvider(provider);
      if (!p) continue;
      const models = model ? [model] : await modelsFor(p);
      yield* compatAgentTurn(p, models, opts);
      return;
    } catch (error) {
      failures.push({ provider, error });
      console.warn(`ai: ${providerLabel(provider)} failed for agent — ${shortReason(error)}`);
    }
  }
  throw allFailed(failures);
}

function partsToText(input: string | ContentPart[]) {
  if (typeof input === "string") return input;
  return input
    .map((p) => ("text" in p ? p.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Which service wrote an answer, and the ones skipped before it. */
export type AnswerMeta = {
  provider: string;
  model: string;
  skipped: { provider: string; reason: string }[];
};

/** Plain chat answer (Ask). YouTube parts can only be watched by Gemini. */
export async function* streamText(
  input: string | ContentPart[],
  onMeta?: (meta: AnswerMeta) => void,
): AsyncGenerator<string> {
  const needsGemini = typeof input !== "string" && input.some((p) => "fileData" in p || "inlineData" in p);
  const order = needsGemini ? providerOrder().filter((p) => p === "gemini") : providerOrder();
  if (needsGemini && !order.length) throw new Error("Reading YouTube videos needs GEMINI_API_KEY.");

  const failures: { provider: ProviderId; error: unknown }[] = [];
  const announce = (provider: ProviderId, model: string) =>
    onMeta?.({
      provider: providerLabel(provider),
      model,
      skipped: failures.map((f) => ({ provider: providerLabel(f.provider), reason: shortReason(f.error) })),
    });
  for (const provider of order) {
    let yielded = false;
    try {
      if (provider === "gemini") {
        for await (const text of streamGeminiText(input, (model) => announce("gemini", model))) {
          yielded = true;
          yield text;
        }
        return;
      }
      const p = compatProvider(provider);
      if (!p) continue;
      const prompt = partsToText(input);
      let lastError: unknown = null;
      for (const model of await modelsFor(p)) {
        try {
          for await (const chunk of streamCompatChat({
            provider: p,
            model,
            temperature: 0.4,
            messages: [{ role: "user", content: prompt }],
          })) {
            if (chunk.type === "text") {
              if (!yielded) announce(provider, model);
              yielded = true;
              yield chunk.text;
            }
          }
          if (yielded) return;
          throw new ProviderError(`${p.label} returned an empty answer`, 502, "busy");
        } catch (error) {
          lastError = error;
          if (yielded) throw error;
          const pe = error instanceof ProviderError ? error : null;
          if (pe?.kind === "quota" || pe?.kind === "auth") break;
        }
      }
      throw lastError ?? new Error(`${p.label}: no model available`);
    } catch (error) {
      // Text already shown can't be taken back; only switch provider before the first word.
      if (yielded) throw error;
      failures.push({ provider, error });
      console.warn(`ai: ${providerLabel(provider)} failed for chat — ${shortReason(error)}`);
    }
  }
  throw allFailed(failures);
}
