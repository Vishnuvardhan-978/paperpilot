import {
  buildAskParts,
  formatAskError,
  streamWithFallback,
  type AskHistoryTurn,
} from "@/lib/gemini";
import type { AskIntent, LensId } from "@/lib/lenses";
import type { AskScope } from "@/lib/scopes";
import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

type AskBody = {
  question?: string;
  documentText?: string;
  documentName?: string;
  compareMode?: boolean;
  youtubeUrls?: string[];
  lens?: LensId;
  intent?: AskIntent;
  history?: AskHistoryTurn[];
  scope?: AskScope;
};

const LENSES: LensId[] = ["kid", "study", "normal", "proof", "bridge"];
const INTENTS: AskIntent[] = [
  "ask",
  "quiz",
  "explain",
  "claim",
  "map",
  "blind",
  "conflict",
  "teach",
];
const SCOPES: AskScope[] = ["docs", "library", "open"];

export async function POST(request: Request) {
  try {
    const gate = allowRequest(`ask:${clientKeyFromRequest(request)}`, 30, 60_000);
    if (!gate.ok) {
      return Response.json(
        { error: `Too many asks. Try again in ~${gate.retryAfterSec}s.` },
        { status: 429 },
      );
    }

    const body = (await request.json()) as AskBody;
    const question = body.question?.trim();
    const documentText = body.documentText?.trim() || "";
    const documentName = body.documentName?.trim() || "document";
    const compareMode = Boolean(body.compareMode);
    const youtubeUrls = (body.youtubeUrls || []).filter(Boolean);
    const lens: LensId = LENSES.includes(body.lens as LensId)
      ? (body.lens as LensId)
      : "normal";
    const intent: AskIntent = INTENTS.includes(body.intent as AskIntent)
      ? (body.intent as AskIntent)
      : "ask";
    const scope: AskScope = SCOPES.includes(body.scope as AskScope)
      ? (body.scope as AskScope)
      : "docs";
    const history = (body.history || [])
      .filter((t) => t?.role && t?.content)
      .slice(-6)
      .map((t) => ({
        role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(t.content).slice(0, 2000),
      }));

    if (!question) {
      return Response.json({ error: "Question is required." }, { status: 400 });
    }

    const hasCorpus = Boolean(documentText) || youtubeUrls.length > 0;
    if (!hasCorpus && scope === "docs") {
      return Response.json(
        {
          error:
            "Upload a file, switch to Open tutor, or use Library (if you have past uploads).",
        },
        { status: 400 },
      );
    }
    if (!hasCorpus && scope === "library") {
      return Response.json(
        { error: "Your library is empty. Upload a file first, or use Open tutor." },
        { status: 400 },
      );
    }

    const parts = buildAskParts({
      question,
      documentText,
      documentName,
      compareMode: compareMode && scope === "docs",
      youtubeUrls: scope === "docs" ? youtubeUrls : [],
      lens,
      intent,
      history,
      scope,
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamWithFallback(parts)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`),
            );
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (error) {
          console.error("ask stream error", error);
          const { message } = formatAskError(error);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("ask error", error);
    const { message, status } = formatAskError(error);
    return Response.json({ error: message }, { status });
  }
}
