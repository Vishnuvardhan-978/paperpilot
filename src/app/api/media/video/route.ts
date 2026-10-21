import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";
import { isVideoJobId, pollVideo, startVideo } from "@/lib/media-gen";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Starts a Veo job; the client then polls GET ?job=… until the video is ready. */
export async function POST(request: Request) {
  const gate = allowRequest(`video:${clientKeyFromRequest(request)}`, 4, 60_000);
  if (!gate.ok) {
    return Response.json({ error: `Too many videos. Try again in ~${gate.retryAfterSec}s.` }, { status: 429 });
  }
  let body: { prompt?: string; aspect?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const prompt = body.prompt?.trim().slice(0, 2000);
  if (!prompt) return Response.json({ error: "Describe the video you want." }, { status: 400 });
  const aspect = body.aspect === "9:16" ? "9:16" : "16:9";

  try {
    return Response.json(await startVideo(prompt, aspect));
  } catch (e) {
    console.error("video start error", e);
    return Response.json({ error: e instanceof Error ? e.message : "Could not start the video." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job") || "";
  if (!isVideoJobId(jobId)) return Response.json({ error: "Unknown video job." }, { status: 400 });
  try {
    const status = await pollVideo(jobId);
    if (status.status === "done") return Response.json({ status: "done", src: `/api/media/file/${status.file}` });
    return Response.json(status);
  } catch (e) {
    console.error("video poll error", e);
    return Response.json({ status: "error", error: e instanceof Error ? e.message : "Could not check the video." });
  }
}
