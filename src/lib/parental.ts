/**
 * Parent controls for the Kid lens: a PIN, a daily ask limit and a log of what was asked.
 * Stored in this browser only. The PIN keeps a curious kid out; it is not real security.
 */

export type ParentSettings = {
  kidMode: boolean;
  /** SHA-256 of the PIN, hex. Empty until a parent sets one. */
  pinHash: string;
  dailyLimit: number;
};

export type KidQuestion = { at: number; question: string; flagged: boolean };

const SETTINGS_KEY = "paperpilot-parent";
const LOG_KEY = "paperpilot-kid-log";
const DEFAULTS: ParentSettings = { kidMode: false, pinHash: "", dailyLimit: 20 };

/** Topics a parent probably wants to know about. Shown as flags, never blocked. */
const SENSITIVE = /\b(kill|suicide|self.?harm|drug|alcohol|sex|porn|weapon|gun|knife|bully|abuse|hate|address|phone number|password|meet (?:up|me))\b/i;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

export function getParentSettings(): ParentSettings {
  return read(SETTINGS_KEY, DEFAULTS);
}

export function saveParentSettings(patch: Partial<ParentSettings>) {
  const next = { ...getParentSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export async function hashPin(pin: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`paperpilot:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkPin(pin: string) {
  const { pinHash } = getParentSettings();
  return !pinHash || (await hashPin(pin)) === pinHash;
}

export function isSensitive(question: string) {
  return SENSITIVE.test(question);
}

export function getKidLog(): KidQuestion[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as KidQuestion[];
  } catch {
    return [];
  }
}

export function logKidQuestion(question: string) {
  const log = getKidLog();
  log.push({ at: Date.now(), question: question.slice(0, 500), flagged: isSensitive(question) });
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-300)));
  } catch {
    /* ignore */
  }
}

export function clearKidLog() {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}
