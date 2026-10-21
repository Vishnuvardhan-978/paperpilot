/**
 * Image and video generation (server only).
 * Images: Gemini image models → Imagen → Pollinations (POLLINATIONS_API_KEY, else the legacy keyless endpoint).
 * Video: Veo through the Gemini key (needs billing) → Pollinations video when POLLINATIONS_API_KEY is set.
 * Gemini models are discovered from the key itself, so retired / new model names need no code change.
 */
import { GenerateVideosOperation, type GoogleGenAI } from "@google/genai";
import { createHash, randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getClient } from "@/lib/gemini";

export const IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];
export type VideoAspect = "16:9" | "9:16";

export const MEDIA_DIR = path.join(os.homedir(), ".paperpilot", "media");

export type GeneratedImage = { mimeType: string; data: string; provider: string; model: string };

type MediaModels = { geminiImage: string[]; imagen: string[]; veo: string[] };

let cachedModels: { at: number; models: MediaModels } | null = null;
/** Models this key can't use (no access / no billing / quota) → skipped until the timestamp. */
const blocked = new Map<string, number>();

const version = (name: string) => parseFloat(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? "0");
const newestFirst = (a: string, b: string) => version(b) - version(a);
const usable = (model: string) => (blocked.get(model) ?? 0) < Date.now();

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function needsBilling(error: unknown) {
  return /billing|paid|limit: 0\b|quota|permission|FAILED_PRECONDITION|not available|not supported|404|not found/i.test(message(error));
}

async function mediaModels(ai: GoogleGenAI): Promise<MediaModels> {
  if (cachedModels && Date.now() - cachedModels.at < 60 * 60_000) return cachedModels.models;
  const models: MediaModels = { geminiImage: [], imagen: [], veo: [] };
  try {
    const pager = await ai.models.list({ config: { pageSize: 200 } });
    for await (const m of pager) {
      const name = (m.name || "").replace(/^models\//, "");
      const actions = m.supportedActions || [];
      if (/^veo/i.test(name) && actions.includes("predictLongRunning")) models.veo.push(name);
      else if (/^imagen/i.test(name) && actions.includes("predict")) models.imagen.push(name);
      else if (/^gemini.*image/i.test(name) && actions.includes("generateContent")) models.geminiImage.push(name);
    }
  } catch (e) {
    console.warn(`media: could not list models — ${message(e).slice(0, 160)}`);
  }
  models.geminiImage.sort(newestFirst);
  models.imagen.sort(newestFirst);
  // Fast Veo variants cost less per second; try them first.
  models.veo.sort((a, b) => Number(/fast/i.test(b)) - Number(/fast/i.test(a)) || newestFirst(a, b));
  cachedModels = { at: Date.now(), models };
  return models;
}

function block(model: string, error: unknown) {
  blocked.set(model, Date.now() + 30 * 60_000);
  console.warn(`media: skipping ${model} for 30 min — ${message(error).replace(/\s+/g, " ").slice(0, 160)}`);
}

const POLLINATIONS_SIZE: Record<ImageAspect, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
};

const pollinationsKey = () => process.env.POLLINATIONS_API_KEY?.trim() || "";

const NO_IMAGE_PROVIDER =
  "Couldn't create an image: this Gemini key can't make images on the free tier, and the free Pollinations service is out of credits. Enable billing on the Gemini key, or add POLLINATIONS_API_KEY (from enter.pollinations.ai) to .env.local and restart.";

async function pollinationsError(res: Response) {
  const body = (await res.text().catch(() => "")).slice(0, 300);
  const detail = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1];
  if (res.status === 401) return "Pollinations rejected POLLINATIONS_API_KEY — check the key.";
  if (res.status === 402) return "Your Pollinations account is out of credits (pollen). Top it up at enter.pollinations.ai.";
  return `Pollinations failed (${res.status})${detail ? `: ${detail}` : ""}. Try again in a moment.`;
}

/** Keyed API when POLLINATIONS_API_KEY is set; otherwise the legacy keyless endpoint (often out of credits). */
async function pollinationsImage(prompt: string, aspect: ImageAspect): Promise<GeneratedImage> {
  const [width, height] = POLLINATIONS_SIZE[aspect];
  const seed = Math.floor(Math.random() * 1_000_000);
  const key = pollinationsKey();
  const model = process.env.POLLINATIONS_IMAGE_MODEL?.trim() || "";
  const q = new URLSearchParams({ width: String(width), height: String(height), seed: String(seed), nologo: "true" });
  if (model) q.set("model", model);
  const url = key
    ? `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${q}`
    : `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${q}`;
  const res = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) {
    if (!key && [401, 402, 403, 429].includes(res.status)) throw new Error(NO_IMAGE_PROVIDER);
    throw new Error(await pollinationsError(res));
  }
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { mimeType: type.split(";")[0], data, provider: key ? "Pollinations" : "Pollinations (free)", model: model || "default" };
}

/** Cloudflare Workers AI (free daily allowance). Flux schnell has no size option, so images are square. */
async function cloudflareImage(account: string, token: string, model: string, prompt: string): Promise<GeneratedImage> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, steps: 4 }),
    signal: AbortSignal.timeout(90_000),
  });
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("image/") && res.ok) {
    return { mimeType: type.split(";")[0], data: Buffer.from(await res.arrayBuffer()).toString("base64"), provider: "Cloudflare AI", model };
  }
  const body = (await res.json().catch(() => ({}))) as { result?: { image?: string }; errors?: { message?: string }[] };
  if (!res.ok || !body.result?.image) {
    throw new Error(`Cloudflare ${res.status}: ${body.errors?.[0]?.message || "no image returned"}`);
  }
  return { mimeType: "image/jpeg", data: body.result.image, provider: "Cloudflare AI", model };
}

export async function generateImage(prompt: string, aspect: ImageAspect): Promise<GeneratedImage> {
  let ai: GoogleGenAI | null = null;
  try {
    ai = getClient();
  } catch {
    ai = null;
  }

  if (ai) {
    const models = await mediaModels(ai);
    for (const model of models.geminiImage.filter(usable)) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: aspect } },
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (part?.inlineData?.data) {
          return { mimeType: part.inlineData.mimeType || "image/png", data: part.inlineData.data, provider: "Gemini", model };
        }
        throw new Error("No image in the response");
      } catch (e) {
        if (needsBilling(e)) block(model, e);
        else console.warn(`media: ${model} failed — ${message(e).slice(0, 160)}`);
      }
    }
    for (const model of models.imagen.filter(usable)) {
      try {
        const res = await ai.models.generateImages({ model, prompt, config: { numberOfImages: 1, aspectRatio: aspect } });
        const image = res.generatedImages?.[0]?.image;
        if (image?.imageBytes) {
          return { mimeType: image.mimeType || "image/png", data: image.imageBytes, provider: "Google Imagen", model };
        }
        throw new Error(res.generatedImages?.[0]?.raiFilteredReason || "No image in the response");
      } catch (e) {
        if (needsBilling(e)) block(model, e);
        else console.warn(`media: ${model} failed — ${message(e).slice(0, 160)}`);
      }
    }
  }

  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const cfToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cfModel = process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || "@cf/black-forest-labs/flux-1-schnell";
  if (cfAccount && cfToken && usable(cfModel)) {
    try {
      return await cloudflareImage(cfAccount, cfToken, cfModel, prompt);
    } catch (e) {
      if (needsBilling(e) || /\b(401|403|429)\b/.test(message(e))) block(cfModel, e);
      else console.warn(`media: ${cfModel} failed — ${message(e).slice(0, 160)}`);
    }
  }

  if (!ai && !pollinationsKey()) {
    try {
      return await pollinationsImage(prompt, aspect);
    } catch {
      throw new Error("Add a Gemini key (with billing) or POLLINATIONS_API_KEY to .env.local to create images.");
    }
  }
  return pollinationsImage(prompt, aspect);
}

const VIDEO_NEEDS_BILLING =
  "Video generation needs a paid provider: either enable billing on your Gemini key (Google Veo isn't on the free tier), or add POLLINATIONS_API_KEY (from enter.pollinations.ai) to .env.local and restart.";

export type VideoStatus =
  | { status: "running" }
  | { status: "done"; file: string }
  | { status: "error"; error: string };

const POLLINATIONS_JOB = /^pollinations\/[0-9a-f-]{36}$/;
/** In-process Pollinations renders; on globalThis so dev-mode module reloads keep them. */
const localJobs: Map<string, VideoStatus> = ((globalThis as { __ppVideoJobs?: Map<string, VideoStatus> }).__ppVideoJobs ??= new Map());

function startPollinationsVideo(prompt: string, aspect: VideoAspect, key: string) {
  const jobId = `pollinations/${randomUUID()}`;
  const model = process.env.POLLINATIONS_VIDEO_MODEL?.trim() || "alibaba/wan-2.2-fast";
  const q = new URLSearchParams({ model, duration: "5", aspectRatio: aspect });
  localJobs.set(jobId, { status: "running" });
  void (async () => {
    try {
      const res = await fetch(`https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}?${q}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("video/")) throw new Error(await pollinationsError(res));
      const file = mediaFileFor(jobId);
      await fs.mkdir(MEDIA_DIR, { recursive: true });
      await fs.writeFile(path.join(MEDIA_DIR, file), Buffer.from(await res.arrayBuffer()));
      localJobs.set(jobId, { status: "done", file });
    } catch (e) {
      localJobs.set(jobId, { status: "error", error: message(e) });
    }
  })();
  return { jobId, model };
}

export async function startVideo(prompt: string, aspect: VideoAspect): Promise<{ jobId: string; model: string; provider: string }> {
  let lastError: unknown = null;
  let ai: GoogleGenAI | null = null;
  try {
    ai = getClient();
  } catch (e) {
    lastError = e;
  }
  if (ai) {
    const { veo } = await mediaModels(ai);
    for (const model of veo.filter(usable)) {
      try {
        const op = await ai.models.generateVideos({ model, source: { prompt }, config: { aspectRatio: aspect, numberOfVideos: 1 } });
        if (!op.name) throw new Error("Veo did not return a job id");
        return { jobId: op.name, model, provider: "Google Veo" };
      } catch (e) {
        lastError = e;
        if (needsBilling(e)) block(model, e);
        else break;
      }
    }
  }
  const key = pollinationsKey();
  if (key) return { ...startPollinationsVideo(prompt, aspect, key), provider: "Pollinations" };
  throw new Error(lastError && !needsBilling(lastError) ? message(lastError) : VIDEO_NEEDS_BILLING);
}

export function isVideoJobId(jobId: string) {
  return POLLINATIONS_JOB.test(jobId) || (/^[\w./-]{5,240}$/.test(jobId) && jobId.includes("operations/"));
}

export function mediaFileFor(jobId: string) {
  return `${createHash("sha256").update(jobId).digest("hex").slice(0, 32)}.mp4`;
}

export async function pollVideo(jobId: string): Promise<VideoStatus> {
  const file = mediaFileFor(jobId);
  const full = path.join(MEDIA_DIR, file);
  try {
    await fs.access(full);
    return { status: "done", file };
  } catch {
    /* not downloaded yet */
  }

  if (POLLINATIONS_JOB.test(jobId)) {
    return localJobs.get(jobId) ?? { status: "error", error: "The video render was interrupted (the app restarted). Try again." };
  }

  const ai = getClient();
  const op = new GenerateVideosOperation();
  op.name = jobId;
  const current = await ai.operations.getVideosOperation({ operation: op });
  if (!current.done) return { status: "running" };
  if (current.error) {
    const err = current.error as { message?: string };
    return { status: "error", error: err.message || JSON.stringify(current.error).slice(0, 300) };
  }
  const video = current.response?.generatedVideos?.[0]?.video;
  if (!video) {
    const reasons = current.response?.raiMediaFilteredReasons?.join("; ");
    return { status: "error", error: reasons || "The video was blocked by safety filters. Try a different prompt." };
  }
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  if (video.videoBytes) await fs.writeFile(full, Buffer.from(video.videoBytes, "base64"));
  else await ai.files.download({ file: video, downloadPath: full });
  return { status: "done", file };
}
