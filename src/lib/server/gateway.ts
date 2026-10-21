/**
 * PaperPilot AI server: an OpenAI-compatible endpoint that checks a pp_live_ key and its daily
 * allowance, then forwards to the upstream providers configured on this server (never to
 * "paperpilot" itself), falling through on quota / outage / missing model.
 */
import { compatProvider, modelsFor, providerOrder, type CompatProviderId } from "@/lib/ai/providers";
import { addTokens, burstWait, findKey, secondsUntilUtcMidnight, takeRequest, type ApiKeyRecord } from "@/lib/server/api-keys";

export function apiError(status: number, message: string, code: string, headers?: Record<string, string>) {
  return Response.json({ error: { message, type: code, code } }, { status, headers });
}

export async function authenticate(request: Request): Promise<ApiKeyRecord | Response> {
  const raw = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
  if (!raw) return apiError(401, "Missing API key. Send `Authorization: Bearer pp_live_…`.", "missing_api_key");
  const key = await findKey(raw);
  if (!key) return apiError(401, "Invalid PaperPilot API key.", "invalid_api_key");
  if (key.disabled) return apiError(403, "This PaperPilot API key has been disabled.", "key_disabled");
  return key;
}

export function upstreamProviders() {
  return providerOrder()
    .filter((p): p is CompatProviderId => p !== "gemini" && p !== "paperpilot")
    .map((p) => compatProvider(p))
    .filter((p) => p !== null);
}

/** Upstream statuses worth retrying on another provider / model. */
const FALL_THROUGH = new Set([401, 402, 403, 404, 408, 409, 429, 500, 502, 503, 504]);

function usageTap(keyId: string) {
  let tail = "";
  const decoder = new TextDecoder();
  const scan = (text: string) => {
    for (const m of text.matchAll(/"prompt_tokens"\s*:\s*(\d+)[^}]*?"completion_tokens"\s*:\s*(\d+)/g)) {
      void addTokens(keyId, Number(m[1]), Number(m[2]));
    }
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      const text = tail + decoder.decode(chunk, { stream: true });
      const cut = text.lastIndexOf("\n");
      if (cut >= 0) {
        scan(text.slice(0, cut));
        tail = text.slice(cut + 1);
      } else {
        tail = text;
      }
    },
    flush() {
      scan(tail);
    },
  });
}

export async function handleChatCompletions(request: Request): Promise<Response> {
  const key = await authenticate(request);
  if (key instanceof Response) return key;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiError(400, "Request body must be JSON.", "invalid_request");
  }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return apiError(400, "`messages` is required.", "invalid_request");
  }

  const burst = burstWait(key);
  if (burst) {
    return apiError(429, `Too many requests for this key (${key.perMinute ?? 30}/minute). Retry in ${burst}s.`, "rate_limited", {
      "Retry-After": String(burst),
    });
  }
  const quota = await takeRequest(key);
  if (!quota.ok) {
    const wait = secondsUntilUtcMidnight();
    return apiError(
      429,
      `Daily limit reached (${quota.limit} requests). It resets at 00:00 UTC (5:30 AM IST).`,
      "daily_limit",
      { "Retry-After": String(wait) },
    );
  }

  const providers = upstreamProviders();
  if (!providers.length) return apiError(503, "No upstream AI provider is configured on this server.", "no_upstream");

  const failures: string[] = [];
  for (const p of providers) {
    for (const model of await modelsFor(p, 2)) {
      let res: Response;
      try {
        res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}`, ...p.headers },
          body: JSON.stringify({ ...body, model }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
        });
      } catch (e) {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        failures.push(`${p.label}/${model}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        failures.push(`${p.label}/${model}: ${res.status}`);
        if (FALL_THROUGH.has(res.status)) {
          console.warn(`gateway: ${p.label}/${model} ${res.status} ${text.slice(0, 160).replace(/\s+/g, " ")}`);
          continue;
        }
        // A request problem (400 etc.) would fail everywhere; hand it back as-is.
        return new Response(text, { status: res.status, headers: { "Content-Type": res.headers.get("content-type") || "application/json" } });
      }

      const headers = {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Cache-Control": "no-cache, no-transform",
        "X-PaperPilot-Provider": p.id,
        "X-PaperPilot-Model": model,
        "X-RateLimit-Remaining-Requests": String(Math.max(0, quota.limit - quota.used)),
      };
      if (body.stream && res.body) return new Response(res.body.pipeThrough(usageTap(key.id)), { headers });
      const text = await res.text();
      try {
        const u = (JSON.parse(text) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
        if (u) void addTokens(key.id, u.prompt_tokens || 0, u.completion_tokens || 0);
      } catch {
        /* not JSON — pass through */
      }
      return new Response(text, { headers });
    }
  }
  console.warn(`gateway: all upstreams failed — ${failures.join("; ")}`);
  return apiError(503, "All AI providers are busy or out of quota right now. Try again shortly.", "upstream_unavailable");
}
