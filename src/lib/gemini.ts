import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_CANDIDATES = [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
];

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .env.local");
  }

  return new GoogleGenerativeAI(apiKey);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("[503]") ||
    message.includes("[429]") ||
    message.toLowerCase().includes("high demand") ||
    message.toLowerCase().includes("overloaded") ||
    message.toLowerCase().includes("resource exhausted")
  );
}

export async function* streamWithFallback(prompt: string): AsyncGenerator<string> {
  const genAI = getClient();
  let lastError: unknown;

  for (const modelName of MODEL_CANDIDATES) {
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContentStream(prompt);
        let yielded = false;

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            yielded = true;
            yield text;
          }
        }

        if (yielded) return;
        throw new Error("Empty response from Gemini");
      } catch (error) {
        lastError = error;
        if (isRetryable(error) && attempt < 2) {
          await sleep(700 * attempt);
          continue;
        }
        if (isRetryable(error)) {
          break;
        }
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini is busy. Please try again in a moment.");
}

export function buildAskPrompt(
  question: string,
  documentText: string,
  documentName: string,
) {
  return `You are PaperPilot, an assistant that answers questions using only the provided document(s).

Rules:
- Answer clearly and helpfully.
- Use only facts found in the document(s).
- If the answer is not in the documents, say you cannot find it.
- When multiple documents are provided, say which document a fact comes from when useful.
- Quote short supporting snippets when useful.
- Keep answers concise unless the user asks for detail.
- Use markdown formatting (bold, lists) when it helps readability.

Document(s): ${documentName}

Document content:
"""
${documentText.slice(0, 100000)}
"""

User question: ${question}`;
}

export function formatAskError(error: unknown): { message: string; status: number } {
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

  return { message, status };
}
