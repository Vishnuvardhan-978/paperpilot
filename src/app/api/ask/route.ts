import { NextResponse } from "next/server";
import { generateWithFallback } from "@/lib/gemini";

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
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    if (!documentText) {
      return NextResponse.json(
        { error: "Upload a PDF before asking questions." },
        { status: 400 },
      );
    }

    const prompt = `You are PaperPilot, an assistant that answers questions using only the provided document.

Rules:
- Answer clearly and helpfully.
- Use only facts found in the document.
- If the answer is not in the document, say you cannot find it.
- Quote short supporting snippets when useful.
- Keep answers concise unless the user asks for detail.

Document name: ${documentName}

Document content:
"""
${documentText.slice(0, 100000)}
"""

User question: ${question}`;

    const answer = await generateWithFallback(prompt);

    return NextResponse.json({ answer });
  } catch (error) {
    console.error("ask error", error);

    let message = "Gemini request failed. Try again.";
    let status = 500;

    if (error instanceof Error) {
      if (error.message.includes("GEMINI_API_KEY")) {
        message = error.message;
      } else if (error.message.includes("[401]") || error.message.includes("API key")) {
        message = "Invalid Gemini API key. Update GEMINI_API_KEY in Vercel settings.";
      } else if (error.message.includes("[404]")) {
        message = "Gemini model not found. Please try again shortly.";
      } else if (
        error.message.includes("[503]") ||
        error.message.includes("[429]") ||
        error.message.toLowerCase().includes("high demand")
      ) {
        message = "AI is busy right now. Please wait a few seconds and try again.";
        status = 503;
      } else {
        message = error.message.slice(0, 240);
      }
    }

    return NextResponse.json({ error: message }, { status });
  }
}
