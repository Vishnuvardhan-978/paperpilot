import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";
import { apiError, handleChatCompletions } from "@/lib/server/gateway";

export const runtime = "nodejs";
export const maxDuration = 300;

/** PaperPilot AI server — OpenAI-compatible chat completions (streaming and tools pass through). */
export async function POST(request: Request) {
  const gate = allowRequest(`v1:${clientKeyFromRequest(request)}`, 120, 60_000);
  if (!gate.ok) return apiError(429, `Too many requests. Try again in ~${gate.retryAfterSec}s.`, "rate_limited", { "Retry-After": String(gate.retryAfterSec) });
  return handleChatCompletions(request);
}
