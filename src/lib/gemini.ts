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

export async function generateWithFallback(prompt: string) {
  const genAI = getClient();
  let lastError: unknown;

  for (const modelName of MODEL_CANDIDATES) {
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (text) {
          return text;
        }
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
