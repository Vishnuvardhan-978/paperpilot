import { getParentSettings } from "@/lib/parental";

const KEY = "paperpilot-daily-asks";
export const DAILY_ASK_LIMIT = 40;

/** Kid mode uses the parent's limit instead of the default. */
function dailyLimit() {
  const p = getParentSettings();
  return p.kidMode ? p.dailyLimit : DAILY_ASK_LIMIT;
}

type DayBucket = { day: string; count: number };

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readBucket(): DayBucket {
  if (typeof window === "undefined") return { day: todayKey(), count: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { day: todayKey(), count: 0 };
    const parsed = JSON.parse(raw) as DayBucket;
    if (parsed.day !== todayKey()) return { day: todayKey(), count: 0 };
    return parsed;
  } catch {
    return { day: todayKey(), count: 0 };
  }
}

function writeBucket(bucket: DayBucket) {
  localStorage.setItem(KEY, JSON.stringify(bucket));
}

export function getAskUsage() {
  const bucket = readBucket();
  return {
    used: bucket.count,
    limit: dailyLimit(),
    remaining: Math.max(0, dailyLimit() - bucket.count),
  };
}

export function canAsk(): { ok: boolean; remaining: number; limit: number } {
  const usage = getAskUsage();
  return {
    ok: usage.remaining > 0,
    remaining: usage.remaining,
    limit: usage.limit,
  };
}

export function recordAsk() {
  const bucket = readBucket();
  const next = { day: todayKey(), count: bucket.count + 1 };
  writeBucket(next);
  return {
    used: next.count,
    limit: dailyLimit(),
    remaining: Math.max(0, dailyLimit() - next.count),
  };
}
