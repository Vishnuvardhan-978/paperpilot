import { generateTextOnce, formatAskError } from "@/lib/gemini";
import {
  buildAgentStepPrompt,
  parseAgentDecision,
  type AgentToolStep,
} from "@/lib/agent-tools";
import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  question?: string;
  focusPath?: string | null;
  documentName?: string;
  workspaceHint?: string;
  steps?: AgentToolStep[];
};

export async function POST(request: Request) {
  try {
    const gate = allowRequest(`agent:${clientKeyFromRequest(request)}`, 60, 60_000);
    if (!gate.ok) {
      return Response.json(
        { error: `Too many agent steps. Try again in ~${gate.retryAfterSec}s.` },
        { status: 429 },
      );
    }

    const body = (await request.json()) as Body;
    const question = body.question?.trim();
    if (!question) {
      return Response.json({ error: "Question is required." }, { status: 400 });
    }

    const steps = (body.steps || [])
      .filter((s) => s?.call?.name && typeof s.result === "string")
      .slice(0, 12)
      .map((s) => ({
        call: {
          id: String(s.call.id || "t"),
          name: s.call.name,
          args: Object.fromEntries(
            Object.entries(s.call.args || {}).map(([k, v]) => [k, String(v).slice(0, 200_000)]),
          ),
        },
        result: String(s.result).slice(0, 12_000),
      })) as AgentToolStep[];

    const prompt = buildAgentStepPrompt({
      question,
      focusPath: body.focusPath,
      documentName: body.documentName || "workspace",
      workspaceHint: body.workspaceHint,
      steps,
    });

    const raw = await generateTextOnce(prompt);
    const decision = parseAgentDecision(raw);
    return Response.json({ decision, raw: raw.slice(0, 2000) });
  } catch (error) {
    console.error("agent step error", error);
    const { message, status } = formatAskError(error);
    return Response.json({ error: message }, { status });
  }
}
