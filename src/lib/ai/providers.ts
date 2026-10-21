/**
 * Which AI services PaperPilot can use, configured only through env keys.
 * Every non-Gemini service speaks the OpenAI chat-completions format.
 *
 *   AI_PROVIDERS=gemini,groq,openrouter   (order to try; default: every configured one)
 */

export type CompatProviderId = "paperpilot" | "groq" | "openrouter" | "cloudflare" | "custom";
export type ProviderId = CompatProviderId | "gemini";

export type CompatProvider = {
  id: CompatProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  /** Pinned by env; when empty the provider's /models list is used. */
  models: string[];
  /** Used when /models can't be read. */
  fallbackModels: string[];
  discover: boolean;
  headers?: Record<string, string>;
};

const DEFAULT_ORDER: ProviderId[] = ["paperpilot", "gemini", "groq", "openrouter", "cloudflare", "custom"];

const env = (name: string) => process.env[name]?.trim() || "";
const list = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function compatProvider(id: CompatProviderId): CompatProvider | null {
  switch (id) {
    case "paperpilot": {
      const baseUrl = env("PAPERPILOT_AI_URL");
      const apiKey = env("PAPERPILOT_AI_KEY");
      if (!baseUrl || !apiKey) return null;
      return { id, label: "PaperPilot AI", baseUrl, apiKey, models: list(env("PAPERPILOT_AI_MODEL")), fallbackModels: ["auto"], discover: false };
    }
    case "groq": {
      const apiKey = env("GROQ_API_KEY");
      if (!apiKey) return null;
      return {
        id,
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey,
        models: list(env("GROQ_MODEL")),
        fallbackModels: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
        discover: true,
      };
    }
    case "openrouter": {
      const apiKey = env("OPENROUTER_API_KEY");
      if (!apiKey) return null;
      return {
        id,
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey,
        models: list(env("OPENROUTER_MODEL")),
        fallbackModels: ["qwen/qwen3-coder:free", "meta-llama/llama-3.3-70b-instruct:free"],
        discover: true,
        headers: { "HTTP-Referer": "https://paperpilot.app", "X-Title": "PaperPilot" },
      };
    }
    case "cloudflare": {
      const account = env("CLOUDFLARE_ACCOUNT_ID");
      const apiKey = env("CLOUDFLARE_API_TOKEN");
      if (!account || !apiKey) return null;
      return {
        id,
        label: "Cloudflare AI",
        baseUrl: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
        apiKey,
        models: list(env("CLOUDFLARE_MODEL")),
        fallbackModels: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
        discover: false,
      };
    }
    case "custom": {
      const baseUrl = env("OPENAI_COMPAT_BASE_URL");
      if (!baseUrl) return null;
      return {
        id,
        label: env("OPENAI_COMPAT_LABEL") || "Custom AI server",
        baseUrl,
        apiKey: env("OPENAI_COMPAT_API_KEY") || "none",
        models: list(env("OPENAI_COMPAT_MODEL")),
        fallbackModels: [],
        discover: true,
      };
    }
  }
}

export function geminiConfigured() {
  return Boolean(env("GEMINI_API_KEY"));
}

function isConfigured(id: ProviderId) {
  return id === "gemini" ? geminiConfigured() : compatProvider(id) !== null;
}

/** Providers to try, in order. */
export function providerOrder(): ProviderId[] {
  const wanted = list(env("AI_PROVIDERS").toLowerCase()).filter((p): p is ProviderId => DEFAULT_ORDER.includes(p as ProviderId));
  return (wanted.length ? wanted : DEFAULT_ORDER).filter(isConfigured);
}

export function providerLabel(id: ProviderId) {
  return id === "gemini" ? "Gemini" : compatProvider(id)?.label || id;
}

/**
 * Model references travel through the client between agent steps:
 * "groq:llama-3.3-70b-versatile" for OpenAI-compatible services, a bare name for Gemini.
 */
export function parseModelRef(ref: string): { provider: ProviderId; model: string } {
  const m = /^(paperpilot|groq|openrouter|cloudflare|custom):(.+)$/.exec(ref);
  return m ? { provider: m[1] as CompatProviderId, model: m[2] } : { provider: "gemini", model: ref };
}

export const modelRef = (provider: CompatProviderId, model: string) => `${provider}:${model}`;

/* ---------- model discovery ---------- */

/** Best first. Matching is loose on purpose so renamed / newer versions still rank. */
const PREFER = [
  /qwen[\w.-]*coder/i,
  /gpt-oss-120b/i,
  /kimi-k2/i,
  /deepseek[\w.-]*(v3|chat|r1)/i,
  /llama-4[\w.-]*maverick/i,
  /qwen3[\w.-]*(235b|32b)/i,
  /llama-3\.3-70b/i,
  /llama-4/i,
  /gpt-oss/i,
  /qwen/i,
  /mistral|devstral/i,
  /llama/i,
];
const NOT_CHAT = /guard|whisper|tts|embed|audio|vision-preview|safeguard|compound|playai|distil|moderation|rerank|transcribe|image/i;

function rank(id: string) {
  const i = PREFER.findIndex((re) => re.test(id));
  return i < 0 ? PREFER.length : i;
}

type ModelInfo = { id: string; supported_parameters?: string[]; context_length?: number };

const discovered = new Map<CompatProviderId, { at: number; models: string[] }>();

async function listModels(p: CompatProvider): Promise<string[]> {
  const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${p.apiKey}`, ...p.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`models list ${res.status}`);
  const data = (await res.json()) as { data?: ModelInfo[] };
  let models = (data.data || []).filter((m) => m.id && !NOT_CHAT.test(m.id));
  if (p.id === "openrouter") {
    // Free models only, and only ones that can call tools.
    models = models.filter((m) => m.id.endsWith(":free") && (m.supported_parameters || []).includes("tools"));
  }
  return models.map((m) => m.id).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Up to `max` model names to try on this provider, best first. */
export async function modelsFor(p: CompatProvider, max = 3): Promise<string[]> {
  if (p.models.length) return p.models.slice(0, max);
  if (!p.discover) return p.fallbackModels.slice(0, max);
  const hit = discovered.get(p.id);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.models.slice(0, max);
  try {
    const models = await listModels(p);
    const usable = models.length ? models : p.fallbackModels;
    discovered.set(p.id, { at: Date.now(), models: usable });
    return usable.slice(0, max);
  } catch (e) {
    console.warn(`ai: could not list ${p.label} models — ${e instanceof Error ? e.message : e}`);
    return p.fallbackModels.slice(0, max);
  }
}
