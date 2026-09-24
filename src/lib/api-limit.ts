/** Simple in-memory sliding window limiter (best-effort on one Node process). */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export function allowRequest(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key) || { timestamps: [] };
  b.timestamps = b.timestamps.filter((t) => now - t < windowMs);
  if (b.timestamps.length >= limit) {
    const oldest = b.timestamps[0] || now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    buckets.set(key, b);
    return { ok: false, retryAfterSec };
  }
  b.timestamps.push(now);
  buckets.set(key, b);
  return { ok: true, retryAfterSec: 0 };
}

export function clientKeyFromRequest(request: Request) {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "local";
}
