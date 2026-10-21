import { localRequestProblem } from "@/lib/server/local-request";
import { maskedSettings, writeEnvValues } from "@/lib/server/env-file";
import { providerOrder, providerLabel } from "@/lib/ai/providers";

export const runtime = "nodejs";

function status() {
  return { settings: maskedSettings(), active: providerOrder().map(providerLabel) };
}

export async function GET(request: Request) {
  const problem = localRequestProblem(request);
  if (problem) return Response.json({ error: problem }, { status: 403 });
  return Response.json(status());
}

export async function POST(request: Request) {
  const problem = localRequestProblem(request);
  if (problem) return Response.json({ error: problem }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { values?: Record<string, unknown> };
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.values || {})) if (typeof v === "string") values[k] = v;
  try {
    await writeEnvValues(values);
  } catch (error) {
    return Response.json({ error: `Could not save: ${error instanceof Error ? error.message : error}` }, { status: 500 });
  }
  return Response.json(status());
}
