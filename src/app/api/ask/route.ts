import { buildAskPrompt, formatAskError, streamWithFallback } from "@/lib/gemini";

export const runtime = "nodejs";

type AskBody = {
  question?: string;
  documentText?: string;
  documentName?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AskBody;
    const question = body.question?.trim();
    const documentText = body.documentText?.trim();
    const documentName = body.documentName?.trim() || "document.pdf";

    if (!question) {
      return Response.json({ error: "Question is required." }, { status: 400 });
    }

    if (!documentText) {
      return Response.json(
        { error: "Upload a PDF before asking questions." },
        { status: 400 },
      );
    }

    const prompt = buildAskPrompt(question, documentText, documentName);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamWithFallback(prompt)) {
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
