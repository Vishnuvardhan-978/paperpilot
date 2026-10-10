import { formatAskError, streamAgentTurn, type AgentContent } from "@/lib/gemini";
import { AGENT_FUNCTIONS, buildAgentSystemPrompt, buildAgentUserMessage, toToolCall } from "@/lib/agent-tools";
import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";

export const runtime = "nodejs";
export const maxDuration = 180;

type Body = {
  question?: string;
  history?: { role?: string; content?: string }[];
  project?: { name?: string; root?: string; paths?: string[] };
  focusPath?: string | null;
  /** Model/tool turns of this run so far, exactly as returned by earlier steps. */
  turns?: AgentContent[];
  model?: string | null;
};

/**
 * Streams NDJSON events:
 *  {"type":"thought"|"text","text"} while the model works,
 *  {"type":"reset"} if a model attempt failed mid-stream,
 *  then {"type":"result", model, modelContent, calls, text} or {"type":"error"}.
 */
export async function POST(request: Request) {
  const gate = allowRequest(`agent:${clientKeyFromRequest(request)}`, 90, 60_000);
  if (!gate.ok) {
    return Response.json({ error: `Too many agent steps. Try again in ~${gate.retryAfterSec}s.` }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const question = body.question?.trim();
  if (!question) return Response.json({ error: "Question is required." }, { status: 400 });

  const history = (body.history || [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));

  const systemInstruction = buildAgentSystemPrompt({
    projectName: body.project?.name || "workspace",
    root: body.project?.root,
    paths: (body.project?.paths || []).filter((p) => typeof p === "string"),
    focusPath: body.focusPath,
  });

  const contents: AgentContent[] = [
    { role: "user", parts: [{ text: buildAgentUserMessage({ question, history }) }] },
    ...(body.turns || []).filter((t) => (t.role === "user" || t.role === "model") && Array.isArray(t.parts)),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        for await (const ev of streamAgentTurn({
          contents,
          systemInstruction,
          functionDeclarations: AGENT_FUNCTIONS,
          model: body.model,
        })) {
          if (request.signal.aborted) break;
          if (ev.type !== "done") {
            emit(ev);
            continue;
          }
          const calls = ev.parts
            .map((p, i) => (p.functionCall ? toToolCall(p.functionCall as never, i) : null))
            .filter(Boolean);
          const text = ev.parts
            .filter((p) => typeof p.text === "string" && !p.thought)
            .map((p) => p.text as string)
            .join("")
            .trim();
          emit({ type: "result", model: ev.model, modelContent: { role: "model", parts: ev.parts }, calls, text });
        }
      } catch (error) {
        console.error("agent step error", error);
        emit({ type: "error", error: formatAskError(error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
