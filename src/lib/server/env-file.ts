import fs from "fs/promises";
import path from "path";

/** Keys the settings screen may read and write. Nothing else in .env.local is touched. */
export const SETTINGS_KEYS = [
  { key: "GEMINI_API_KEY", label: "Gemini API key", group: "Chat", secret: true, help: "https://aistudio.google.com/apikey" },
  { key: "GROQ_API_KEY", label: "Groq API key", group: "Chat", secret: true, help: "https://console.groq.com/keys" },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter API key", group: "Chat", secret: true, help: "https://openrouter.ai/keys" },
  { key: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare account ID", group: "Chat", secret: false, help: "https://dash.cloudflare.com" },
  { key: "CLOUDFLARE_API_TOKEN", label: "Cloudflare API token", group: "Chat", secret: true },
  { key: "AI_PROVIDERS", label: "Provider order", group: "Chat", secret: false, placeholder: "gemini,groq,openrouter,cloudflare" },
  { key: "PAPERPILOT_AI_URL", label: "PaperPilot AI server URL", group: "Own server", secret: false, placeholder: "https://your-server/api/v1" },
  { key: "PAPERPILOT_AI_KEY", label: "PaperPilot AI key", group: "Own server", secret: true, placeholder: "pp_live_…" },
  { key: "OPENAI_COMPAT_BASE_URL", label: "OpenAI-compatible URL", group: "Own server", secret: false, placeholder: "http://gpu-box:8000/v1" },
  { key: "OPENAI_COMPAT_API_KEY", label: "OpenAI-compatible key", group: "Own server", secret: true },
  { key: "OPENAI_COMPAT_MODEL", label: "OpenAI-compatible model", group: "Own server", secret: false },
  { key: "POLLINATIONS_API_KEY", label: "Pollinations key (images/video)", group: "Media", secret: true, help: "https://enter.pollinations.ai/keys" },
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number]["key"];

const ALLOWED = new Set<string>(SETTINGS_KEYS.map((k) => k.key));

export function envFilePath() {
  return process.env.PAPERPILOT_ENV_FILE || path.join(process.cwd(), ".env.local");
}

function quote(value: string) {
  return /^[\w@:/.,+-]*$/.test(value) ? value : JSON.stringify(value);
}

/** Set or remove keys in .env.local, keeping comments and other lines; also applies them to this process. */
export async function writeEnvValues(values: Partial<Record<string, string>>) {
  const file = envFilePath();
  let lines: string[] = [];
  try {
    lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
  } catch {
    /* new file */
  }
  for (const [key, raw] of Object.entries(values)) {
    if (!ALLOWED.has(key) || raw === undefined) continue;
    const value = raw.replace(/[\r\n]/g, "").trim();
    const at = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (value) {
      const line = `${key}=${quote(value)}`;
      if (at >= 0) lines[at] = line;
      else lines.push(line);
      process.env[key] = value;
    } else {
      if (at >= 0) lines.splice(at, 1);
      delete process.env[key];
    }
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  await fs.writeFile(file, `${lines.join("\n")}\n`, "utf8");
}

export function maskedSettings() {
  return SETTINGS_KEYS.map((k) => {
    const value = process.env[k.key]?.trim() || "";
    return {
      ...k,
      set: Boolean(value),
      preview: !value ? "" : k.secret ? `••••${value.slice(-4)}` : value,
    };
  });
}
