import { localRequestProblem } from "@/lib/server/local-request";
import { saveExample, type TraceInput } from "@/lib/server/training-data";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

/** Saves a rated coding-agent run on this machine (never on a shared server). */
export async function POST(request: Request) {
  const problem = localRequestProblem(request);
  if (problem) return Response.json({ error: problem }, { status: 403 });

  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "This run is too large to save as an example." }, { status: 413 });
  let body: TraceInput;
  try {
    body = JSON.parse(raw) as TraceInput;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (body.rating !== "good" && body.rating !== "bad") return Response.json({ error: "rating must be good or bad." }, { status: 400 });
  if (!body.id || !body.question?.trim() || !Array.isArray(body.turns) || !body.turns.length || !body.project) {
    return Response.json({ error: "Missing run details." }, { status: 400 });
  }

  try {
    const saved = await saveExample({
      ...body,
      project: { name: String(body.project.name || "workspace"), root: body.project.root, paths: (body.project.paths || []).filter((p) => typeof p === "string") },
      turns: body.turns.filter((t) => (t.role === "user" || t.role === "model") && Array.isArray(t.parts)),
    });
    return Response.json({ ok: true, ...saved });
  } catch (e) {
    console.error("training example save failed", e);
    return Response.json({ error: "Could not save the example." }, { status: 500 });
  }
}
