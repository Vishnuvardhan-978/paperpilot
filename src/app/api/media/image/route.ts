import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";
import { IMAGE_ASPECTS, generateImage, type ImageAspect } from "@/lib/media-gen";

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  const gate = allowRequest(`image:${clientKeyFromRequest(request)}`, 12, 60_000);
  if (!gate.ok) {
    return Response.json({ error: `Too many images. Try again in ~${gate.retryAfterSec}s.` }, { status: 429 });
  }
  let body: { prompt?: string; aspect?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const prompt = body.prompt?.trim().slice(0, 2000);
  if (!prompt) return Response.json({ error: "Describe the image you want." }, { status: 400 });
  const aspect = (IMAGE_ASPECTS as readonly string[]).includes(body.aspect || "") ? (body.aspect as ImageAspect) : "1:1";

  try {
    const image = await generateImage(prompt, aspect);
    return Response.json({
      src: `data:${image.mimeType};base64,${image.data}`,
      provider: image.provider,
      model: image.model,
    });
  } catch (e) {
    console.error("image generation error", e);
    return Response.json({ error: e instanceof Error ? e.message : "Image generation failed." }, { status: 502 });
  }
}
