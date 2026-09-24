import {
  GoogleGenAI,
  createPartFromBase64,
  createPartFromUri,
  createUserContent,
} from "@google/genai";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { AskIntent, LensId } from "@/lib/lenses";
import { lensSystemRules, responseShapeInstructions } from "@/lib/lenses";
import type { AskScope } from "@/lib/scopes";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
];

/** Prefer these for PDF/image OCR (document understanding). */
const OCR_MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
];

export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType?: string } };

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Add it to .env.local");
  }

  return new GoogleGenAI({ apiKey });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown) {
  const message = errorMessage(error);
  return (
    message.includes("[503]") ||
    message.includes("[429]") ||
    message.includes("503") ||
    message.includes("429") ||
    message.toLowerCase().includes("high demand") ||
    message.toLowerCase().includes("overloaded") ||
    message.toLowerCase().includes("resource exhausted")
  );
}

/** Model missing / bad payload — try next model instead of hard-failing. */
function isModelSkip(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("invalid_argument") ||
    message.includes("invalid argument") ||
    message.includes("not found") ||
    message.includes("[404]") ||
    message.includes("404") ||
    message.includes("[400]") ||
    message.includes("\"code\":400") ||
    message.includes("unexpected end of json") ||
    message.includes("json input")
  );
}

function asContents(input: string | ContentPart[]) {
  if (typeof input === "string") return input;
  return createUserContent(
    input.map((part) => {
      if ("text" in part) return part.text;
      if ("inlineData" in part) {
        return createPartFromBase64(part.inlineData.data, part.inlineData.mimeType);
      }
      return createPartFromUri(
        part.fileData.fileUri,
        part.fileData.mimeType || "video/mp4",
      );
    }),
  );
}

export async function* streamWithFallback(
  input: string | ContentPart[],
): AsyncGenerator<string> {
  const ai = getClient();
  let lastError: unknown;
  const contents = asContents(input);

  for (const modelName of MODEL_CANDIDATES) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const stream = await ai.models.generateContentStream({
          model: modelName,
          contents,
        });
        let yielded = false;

        for await (const chunk of stream) {
          const text = chunk.text;
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
        if (isRetryable(error) || isModelSkip(error)) {
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

const OCR_PROMPT = (fileName: string) =>
  `You are extracting content for a document Q&A app.
File name: ${fileName}

Extract ALL readable text from this file accurately.
- Preserve reading order.
- Keep headings, lists, tables (as text), numbers, names, and dates.
- For images: transcribe visible text (OCR) and briefly describe important non-text visuals if they matter for answering questions.
- For scanned PDFs: OCR every page you can see.
- Do not invent content that is not in the file.
- Return plain text only (no markdown fences).`;

/**
 * OCR / vision extract for images, scanned PDFs, or hard-to-parse files.
 * Small files: inline base64. Larger files (>1.5MB): Files API (inline often fails ~2MB+).
 */
export async function extractTextWithGemini(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const ai = getClient();
  let lastError: unknown;
  const prompt = OCR_PROMPT(fileName);

  // Inline payloads blow up ~33% as base64; Gemini often errors past ~2MB files.
  const INLINE_SAFE_BYTES = 1.5 * 1024 * 1024;
  const tryInlineFirst = bytes.byteLength <= INLINE_SAFE_BYTES;

  if (tryInlineFirst) {
    const inlinePart = createPartFromBase64(
      Buffer.from(bytes).toString("base64"),
      mimeType,
    );

    for (const modelName of OCR_MODEL_CANDIDATES) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await ai.models.generateContent({
            model: modelName,
            contents: createUserContent([inlinePart, prompt]),
          });
          const text = (result.text || "").trim();
          if (text) return text.slice(0, 120000);
          throw new Error("Empty OCR response");
        } catch (error) {
          lastError = error;
          if (isRetryable(error) && attempt < 2) {
            await sleep(700 * attempt);
            continue;
          }
          if (isRetryable(error) || isModelSkip(error)) break;
          break;
        }
      }
    }
  }

  // Files API via temp path (required for larger PDFs/images)
  const ext =
    mimeType === "application/pdf"
      ? ".pdf"
      : mimeType.includes("png")
        ? ".png"
        : mimeType.includes("webp")
          ? ".webp"
          : mimeType.includes("gif")
            ? ".gif"
            : mimeType.includes("jpeg") || mimeType.includes("jpg")
              ? ".jpg"
              : ".bin";

  const tmpPath = path.join(
    os.tmpdir(),
    `paperpilot-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
  );
  let uploadedName: string | undefined;

  try {
    await fs.writeFile(tmpPath, Buffer.from(bytes));
    const uploaded = await ai.files.upload({
      file: tmpPath,
      config: { mimeType, displayName: fileName.slice(0, 40) },
    });
    if (!uploaded.name) throw new Error("File upload to Gemini failed.");
    uploadedName = uploaded.name;

    let file = uploaded;
    for (let i = 0; i < 45; i++) {
      if (file.state && file.state !== "PROCESSING") break;
      await sleep(1000);
      file = await ai.files.get({ name: uploadedName });
    }
    if (file.state === "FAILED") {
      throw new Error(
        "Gemini could not process this file. Try another PDF or upload a PNG/JPG screenshot.",
      );
    }
    if (!file.uri || !file.mimeType) {
      throw new Error("File upload to Gemini failed.");
    }

    const mediaPart = createPartFromUri(file.uri, file.mimeType);
    const contents = createUserContent([mediaPart, prompt]);

    for (const modelName of OCR_MODEL_CANDIDATES) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await ai.models.generateContent({
            model: modelName,
            contents,
          });
          const text = (result.text || "").trim();
          if (text) return text.slice(0, 120000);
          throw new Error("Empty OCR response");
        } catch (error) {
          lastError = error;
          if (isRetryable(error) && attempt < 2) {
            await sleep(700 * attempt);
            continue;
          }
          if (isRetryable(error) || isModelSkip(error)) break;
          throw error;
        }
      }
    }
  } catch (error) {
    lastError = error;
  } finally {
    if (uploadedName) {
      try {
        await ai.files.delete({ name: uploadedName });
      } catch {
        /* ignore */
      }
    }
    try {
      await fs.unlink(tmpPath);
    } catch {
      /* ignore */
    }
  }

  const msg = errorMessage(lastError).toLowerCase();
  if (msg.includes("unexpected end of json") || msg.includes("json")) {
    throw new Error(
      "AI could not read this file (empty API response). Try again, or upload a PNG/JPG of the pages.",
    );
  }
  if (
    msg.includes("invalid") ||
    msg.includes("no pages") ||
    msg.includes("invalidpdf") ||
    msg.includes("corrupt")
  ) {
    throw new Error(
      "This PDF could not be read (damaged, empty, or password-protected). Re-export it, or upload a clear screenshot/image of the pages.",
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not read this file with AI. Try another file.");
}

export function buildAskPrompt(
  question: string,
  documentText: string,
  documentName: string,
  compareMode = false,
  hasVideo = false,
  lens: LensId = "normal",
  intent: AskIntent = "ask",
  scope: AskScope = "docs",
) {
  const videoNote = hasVideo
    ? `\n- One or more YouTube videos are attached as media. Use the video content (speech + visuals) together with any document text below.`
    : "";

  const intentNote =
    intent === "quiz"
      ? `\nINTENT: QUIZ — Build a quiz (see user question for format). Ground in sources when present; for Open Tutor use general knowledge and label it.`
      : intent === "explain"
        ? `\nINTENT: EXPLAIN — Teach/explain simply for the active lens.`
        : intent === "claim"
          ? `\nINTENT: CLAIM CHECK — Verdict must be one of SUPPORTS | PARTIAL | CONTRADICTS | NOT FOUND. Quote evidence. Never invent support.`
          : intent === "map"
            ? `\nINTENT: DOCUMENT MAP — Structured outline of the source only (overview, sections, key terms).`
            : intent === "blind"
              ? `\nINTENT: BLIND SPOTS — What the sources cover well vs what is thin or missing. Honest gaps only.`
              : intent === "conflict"
                ? `\nINTENT: CONFLICT SCAN — Find disagreements across documents (or internal inconsistencies).`
                : intent === "teach"
                  ? `\nINTENT: TEACH — Short lesson with learning goal, sections, check-understanding questions + answer key.`
                  : "";

  const scopeNote =
    scope === "open"
      ? `\nSCOPE: OPEN TUTOR — No required file. Use careful general knowledge.`
      : scope === "library"
        ? `\nSCOPE: LIBRARY — Answer using the user's library corpus (many past uploads). Cite which chat/file a fact came from when possible.`
        : `\nSCOPE: THIS CHAT — Prefer attached sources in this chat.`;

  const bridgeForce =
    lens === "bridge" && scope !== "open"
      ? `\nAlways structure with:\n## From your sources\n## Beyond the page (world context)\n## How they connect`
      : lens === "bridge" && scope === "open"
        ? `\nStructure with:\n## Tutor answer\n## Try this next`
        : "";

  const docsOnly =
    scope === "docs" && lens !== "bridge"
      ? `- Use only facts found in the document(s) / video(s).\n- If the answer is not in the sources, say you cannot find it.`
      : scope === "library" && lens !== "bridge"
        ? `- Prefer facts from the library corpus.\n- If missing, say so — do not invent library quotes.`
        : scope === "open"
          ? `- You may use general knowledge.\n- For kids: keep it safe and age-appropriate.`
          : `- Separate source-backed facts from world context (Bridge lens).`;

  const shape = responseShapeInstructions(question, intent, scope);

  const tail = `
${shape}

Document(s): ${documentName}

Document content:
"""
${documentText.slice(0, 100000) || (scope === "open" ? "(Open Tutor — no uploaded corpus for this turn.)" : "(No extracted text — rely on attached media if any.)")}
"""

User question: ${question}`;

  if (compareMode && scope === "docs") {
    return `You are PaperPilot in DOCUMENT COMPARE mode.

${lensSystemRules(lens)}
${intentNote}
${scopeNote}

Rules:
- Always refer to documents by their real file names.
- Structure the answer with clear markdown sections:
  ## What's the same
  ## What's different
  ## Key takeaways
- Be specific: numbers, dates, names, amounts, clauses.
- If something appears in only one document, say which one.
- Use only facts from the documents. Do not invent details.
- Keep it scannable with bullets.
- Use markdown formatting.${videoNote}
${tail}`;
  }

  return `You are PaperPilot — a helpful tutor.

${lensSystemRules(lens)}
${intentNote}
${scopeNote}
${bridgeForce}

Rules:
- Match answer length to the question (short question → short answer).
- Answer clearly for the active lens.
${docsOnly}
- When multiple documents are provided, say which document a fact comes from when useful.
- Use markdown only when it helps.${videoNote}
${tail}`;
}

export type AskHistoryTurn = { role: "user" | "assistant"; content: string };

function formatHistory(history?: AskHistoryTurn[]) {
  if (!history?.length) return "";
  const lines = history.slice(-6).map((t) => {
    const who = t.role === "user" ? "User" : "Assistant";
    const clipped = t.content.slice(0, 1200);
    return `${who}: ${clipped}`;
  });
  return `\nRecent conversation (for continuity; still ground answers in the documents):\n${lines.join("\n")}\n`;
}

/** Build multimodal ask payload: optional YouTube URIs + text prompt. */
export function buildAskParts(opts: {
  question: string;
  documentText: string;
  documentName: string;
  compareMode?: boolean;
  youtubeUrls?: string[];
  lens?: LensId;
  intent?: AskIntent;
  history?: AskHistoryTurn[];
  scope?: AskScope;
}): ContentPart[] {
  const youtubeUrls = (opts.youtubeUrls || []).filter(Boolean);
  let prompt = buildAskPrompt(
    opts.question,
    opts.documentText,
    opts.documentName,
    opts.compareMode,
    youtubeUrls.length > 0,
    opts.lens || "normal",
    opts.intent || "ask",
    opts.scope || "docs",
  );
  const hist = formatHistory(opts.history);
  if (hist) {
    prompt = prompt.replace("User question:", `${hist}\nUser question:`);
  }

  const parts: ContentPart[] = youtubeUrls.map((uri) => ({
    fileData: { fileUri: uri },
  }));
  parts.push({ text: prompt });
  return parts;
}

export function formatAskError(error: unknown): { message: string; status: number } {
  let message = "Gemini request failed. Try again.";
  let status = 500;

  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("GEMINI_API_KEY")) {
      message = msg;
    } else if (msg.includes("[401]") || msg.includes("API key") || msg.includes("401")) {
      message = "Invalid Gemini API key. Update GEMINI_API_KEY in Vercel settings.";
    } else if (msg.includes("[404]") || msg.includes("not found") || msg.includes("404")) {
      message = "Gemini model not found. Please try again shortly.";
    } else if (
      msg.includes("[503]") ||
      msg.includes("[429]") ||
      msg.includes("503") ||
      msg.includes("429") ||
      msg.toLowerCase().includes("high demand")
    ) {
      message = "AI is busy right now. Please wait a few seconds and try again.";
      status = 503;
    } else if (msg.toLowerCase().includes("youtube") || msg.toLowerCase().includes("video")) {
      message =
        "Could not read that YouTube video. Use a public video link (not private/unlisted).";
      status = 422;
    } else {
      message = msg.slice(0, 240);
    }
  }

  return { message, status };
}
