import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";
import { streamText } from "@/lib/ai";
import { applyStyle, isImageStyle, type ImageStyleId } from "@/lib/image-styles";
import { IMAGE_ASPECTS, generateImage, type ImageAspect } from "@/lib/media-gen";

export const runtime = "nodejs";
export const maxDuration = 150;

const MAX_COUNT = 4;

/** Rewrites a short idea into a detailed image prompt; falls back to the original on any problem. */
async function enhancePrompt(prompt: string, styled: boolean): Promise<string> {
  const ask = `Rewrite this image idea as one vivid, specific prompt for an image generator.
Keep the subject and any text the user wants shown exactly. Add composition, lighting, setting and mood.${
    styled ? "\nDo not name an art style, medium or camera (no 'photorealistic', 'painting', '3D' etc.): the style is added separately." : ""
  }
At most 60 words. No quotes, no preamble, no lists — reply with the prompt only.

Idea: ${prompt}`;
  try {
    let out = "";
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("enhance timeout")), 20_000));
    await Promise.race([
      (async () => {
        for await (const chunk of streamText(ask)) out += chunk;
      })(),
      timeout,
    ]);
    const cleaned = out.trim().replace(/^["'“]+|["'”]+$/g, "").replace(/\s+/g, " ");
    return cleaned.length >= prompt.length && cleaned.length < 700 ? cleaned : prompt;
  } catch {
    return prompt;
  }
}

export async function POST(request: Request) {
  let body: { prompt?: string; aspect?: string; style?: string; enhance?: boolean; count?: number; seed?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const prompt = body.prompt?.trim().slice(0, 2000);
  if (!prompt) return Response.json({ error: "Describe the image you want." }, { status: 400 });
  const aspect = (IMAGE_ASPECTS as readonly string[]).includes(body.aspect || "") ? (body.aspect as ImageAspect) : "1:1";
  const style: ImageStyleId = isImageStyle(body.style) ? body.style : "none";
  const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(Number(body.count) || 1)));
  const seed = Number.isInteger(body.seed) && body.seed! >= 0 ? body.seed : undefined;

  const gate = allowRequest(`image:${clientKeyFromRequest(request)}`, 12, 60_000, count);
  if (!gate.ok) {
    return Response.json({ error: `Too many images. Try again in ~${gate.retryAfterSec}s.` }, { status: 429 });
  }

  const base = body.enhance ? await enhancePrompt(prompt, style !== "none") : prompt;
  const finalPrompt = applyStyle(base, style);

  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => generateImage(finalPrompt, aspect, seed !== undefined ? { seed: seed + i } : {})),
  );
  for (const r of settled) if (r.status === "rejected") console.warn(`image: one of ${count} failed — ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  const images = settled.flatMap((r) =>
    r.status === "fulfilled"
      ? [{ src: `data:${r.value.mimeType};base64,${r.value.data}`, provider: r.value.provider, model: r.value.model, seed: r.value.seed }]
      : [],
  );
  if (!images.length) {
    const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    console.error("image generation error", first?.reason);
    const msg = first?.reason instanceof Error ? first.reason.message : "Image generation failed.";
    return Response.json({ error: msg }, { status: 502 });
  }

  return Response.json({
    // The first image at the top level keeps older clients working.
    ...images[0],
    images,
    prompt: finalPrompt,
    enhanced: base !== prompt,
    failed: count - images.length,
  });
}
