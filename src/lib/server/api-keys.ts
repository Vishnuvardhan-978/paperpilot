/**
 * PaperPilot API keys (pp_live_…) and per-day usage, stored as JSON files.
 * Keys are kept only as SHA-256 hashes. Manage them with `node scripts/pp-keys.mjs`.
 * A single long-running server is assumed (desktop / one VPS); a database replaces this later.
 */
import { createHash, timingSafeEqual } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

export type ApiKeyRecord = {
  id: string;
  name: string;
  hash: string;
  /** Requests allowed per UTC day. */
  dailyRequests: number;
  /** Burst limit per rolling minute (default 30). */
  perMinute?: number;
  disabled?: boolean;
  createdAt: string;
};

type DayUsage = Record<string, { requests: number; promptTokens: number; completionTokens: number }>;

export const SERVER_DIR = process.env.PAPERPILOT_SERVER_DIR?.trim() || path.join(os.homedir(), ".paperpilot", "server");
const KEYS_FILE = () => path.join(SERVER_DIR, "keys.json");
const usageFile = (day: string) => path.join(SERVER_DIR, "usage", `${day}.json`);

export const hashKey = (raw: string) => createHash("sha256").update(raw.trim()).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);

let keysCache: { at: number; keys: ApiKeyRecord[] } | null = null;

async function loadKeys(): Promise<ApiKeyRecord[]> {
  // Short cache so `pp-keys.mjs disable` takes effect within seconds.
  if (keysCache && Date.now() - keysCache.at < 5_000) return keysCache.keys;
  try {
    const data = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ KEYS_FILE(), "utf8")) as { keys?: ApiKeyRecord[] };
    keysCache = { at: Date.now(), keys: data.keys || [] };
  } catch {
    keysCache = { at: Date.now(), keys: [] };
  }
  return keysCache.keys;
}

export async function findKey(raw: string): Promise<ApiKeyRecord | null> {
  if (!/^pp_(live|test)_[A-Za-z0-9]{20,80}$/.test(raw)) return null;
  const want = Buffer.from(hashKey(raw), "hex");
  for (const k of await loadKeys()) {
    const have = Buffer.from(k.hash, "hex");
    if (have.length === want.length && timingSafeEqual(have, want)) return k;
  }
  return null;
}

/* ---------- usage ---------- */

let usage: { day: string; data: DayUsage; dirty: boolean } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function usageToday() {
  const day = today();
  if (usage?.day === day) return usage;
  if (usage?.dirty) await flush();
  let data: DayUsage = {};
  try {
    data = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ usageFile(day), "utf8"));
  } catch {
    /* first request today */
  }
  usage = { day, data, dirty: false };
  return usage;
}

async function flush() {
  if (!usage?.dirty) return;
  const { day, data } = usage;
  usage.dirty = false;
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(usageFile(day)), { recursive: true });
  await fs.writeFile(/*turbopackIgnore: true*/ usageFile(day), JSON.stringify(data, null, 1));
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch((e) => console.error("usage flush failed", e));
  }, 2_000);
}

const recent = new Map<string, number[]>();

/** Rolling one-minute window per key, in memory. Returns seconds to wait, or 0. */
export function burstWait(key: ApiKeyRecord, now = Date.now()): number {
  const limit = key.perMinute ?? 30;
  const hits = (recent.get(key.id) || []).filter((t) => now - t < 60_000);
  if (hits.length >= limit) {
    recent.set(key.id, hits);
    return Math.max(1, Math.ceil((hits[0] + 60_000 - now) / 1000));
  }
  hits.push(now);
  recent.set(key.id, hits);
  return 0;
}

/** Counts one request; false when today's allowance is used up. */
export async function takeRequest(key: ApiKeyRecord): Promise<{ ok: boolean; used: number; limit: number }> {
  const u = await usageToday();
  const row = (u.data[key.id] ??= { requests: 0, promptTokens: 0, completionTokens: 0 });
  if (row.requests >= key.dailyRequests) return { ok: false, used: row.requests, limit: key.dailyRequests };
  row.requests++;
  u.dirty = true;
  scheduleFlush();
  return { ok: true, used: row.requests, limit: key.dailyRequests };
}

export async function addTokens(keyId: string, promptTokens: number, completionTokens: number) {
  if (!promptTokens && !completionTokens) return;
  const u = await usageToday();
  const row = (u.data[keyId] ??= { requests: 0, promptTokens: 0, completionTokens: 0 });
  row.promptTokens += promptTokens;
  row.completionTokens += completionTokens;
  u.dirty = true;
  scheduleFlush();
}

export function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}
