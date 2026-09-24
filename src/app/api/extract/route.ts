import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { extractTextWithGemini } from "@/lib/gemini";
import { ocrImageBuffers, ocrPdfLocally } from "@/lib/local-ocr";
import {
  DocKind,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  detectDocKind,
  mimeForFile,
} from "@/lib/media";
import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

function looksLikePdf(buffer: Uint8Array) {
  // %PDF-
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  );
}

async function extractPdfText(
  buffer: Uint8Array,
  fileName: string,
): Promise<{
  text: string;
  pages: number;
  usedOcr: boolean;
}> {
  let pages = 1;
  let cleaned = "";
  let parseFailed = false;

  if (!looksLikePdf(buffer)) {
    throw new Error(
      "This file does not look like a valid PDF. Try re-exporting it, or upload a PNG/JPG screenshot instead.",
    );
  }

  // pdf.js/unpdf detaches the ArrayBuffer after parse — keep an owned copy for OCR
  const preserved = Buffer.from(buffer);

  try {
    const pdf = await getDocumentProxy(new Uint8Array(preserved));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    pages = totalPages || 1;
    cleaned = (text || "").replace(/\s+/g, " ").trim();
  } catch (error) {
    parseFailed = true;
    console.warn("unpdf failed", error);
  }

  if (cleaned.length >= 40) {
    return { text: cleaned.slice(0, 120000), pages, usedOcr: false };
  }

  // Image-only / scanned PDF → local OCR first (Gemini often blocks ID/passport docs)
  try {
    const local = await ocrPdfLocally(new Uint8Array(preserved));
    if (local.replace(/\s+/g, " ").trim().length >= 15) {
      return {
        text: local,
        pages: Math.max(pages, 1),
        usedOcr: true,
      };
    }
  } catch (error) {
    console.warn("local OCR failed", error);
  }

  // Cloud OCR fallback for non-sensitive scanned docs
  try {
    const ocr = await extractTextWithGemini(
      new Uint8Array(preserved),
      "application/pdf",
      fileName,
    );
    return {
      text: ocr,
      pages: Math.max(pages, 1),
      usedOcr: true,
    };
  } catch (error) {
    if (parseFailed || cleaned.length < 40) {
      throw new Error(
        "This looks like a scanned PDF (no selectable text). Local OCR found little text, and cloud AI may refuse ID/passport documents. Upload a clearer PNG/JPG of each page, or use a text-based PDF.",
      );
    }
    throw error;
  }
}

async function extractFromKind(
  kind: DocKind,
  file: File,
  buffer: Uint8Array,
): Promise<{ text: string; pages: number; usedOcr?: boolean }> {
  const mime = mimeForFile(file, kind);

  if (kind === "pdf") {
    return extractPdfText(buffer, file.name);
  }

  if (kind === "text") {
    const text = new TextDecoder("utf-8").decode(buffer).replace(/\s+/g, " ").trim();
    if (!text) throw new Error("This text file is empty.");
    return { text: text.slice(0, 120000), pages: 1 };
  }

  if (kind === "docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    const text = (result.value || "").replace(/\s+/g, " ").trim();
    if (!text) {
      throw new Error("Could not read text from this Word file.");
    }
    return { text: text.slice(0, 120000), pages: 1 };
  }

  if (kind === "image") {
    // Local OCR first (keeps ID photos off the cloud when possible)
    try {
      const local = await ocrImageBuffers([Buffer.from(buffer)]);
      if (local.replace(/\s+/g, " ").trim().length >= 15) {
        return { text: local, pages: 1, usedOcr: true };
      }
    } catch (error) {
      console.warn("local image OCR failed", error);
    }

    const text = await extractTextWithGemini(buffer, mime, file.name);
    if (!text.trim()) {
      throw new Error("Could not read anything from this image.");
    }
    return { text, pages: 1, usedOcr: true };
  }

  throw new Error("Unsupported file type.");
}

function friendlyExtractError(error: unknown): { message: string; status: number } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes("invalid pdf") || lower.includes("invalidpdf")) {
    return {
      message:
        "This PDF looks damaged or password-protected. Try exporting it again, or upload a screenshot/image of the pages.",
      status: 422,
    };
  }
  if (lower.includes("password")) {
    return {
      message: "This PDF is password-protected. Remove the password and upload again.",
      status: 422,
    };
  }
  if (lower.includes("gemini_api_key") || lower.includes("api key")) {
    return { message: raw, status: 500 };
  }
  if (lower.includes("busy") || lower.includes("429") || lower.includes("503")) {
    return {
      message: "AI is busy reading this file. Wait a few seconds and try again.",
      status: 503,
    };
  }
  if (lower.includes("unexpected end of json") || lower.includes("json input")) {
    return {
      message:
        "AI could not read this file. Try again, re-export the PDF, or upload a PNG/JPG screenshot.",
      status: 502,
    };
  }

  return {
    message: raw.slice(0, 220) || "Failed to read file. Please try again.",
    status: 500,
  };
}

export async function POST(request: Request) {
  try {
    const gate = allowRequest(`extract:${clientKeyFromRequest(request)}`, 20, 60_000);
    if (!gate.ok) {
      return NextResponse.json(
        { error: `Too many uploads. Try again in ~${gate.retryAfterSec}s.` },
        { status: 429 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A file is required." }, { status: 400 });
    }

    const kind = detectDocKind(file);
    if (!kind) {
      return NextResponse.json(
        {
          error:
            "Unsupported file. Use PDF, image (PNG/JPG/WEBP), TXT/MD, or DOCX.",
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File is too large. Keep uploads under ${MAX_UPLOAD_LABEL}.` },
        { status: 400 },
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const { text, pages, usedOcr } = await extractFromKind(kind, file, buffer);
    const clipped = text.replace(/\s+/g, " ").trim().slice(0, 120000);

    if (!clipped) {
      return NextResponse.json(
        {
          error:
            "Could not read content from this file. Try another format or a clearer scan.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      name: file.name,
      kind,
      mimeType: mimeForFile(file, kind),
      pages,
      sizeBytes: file.size,
      charCount: clipped.length,
      preview: clipped.slice(0, 220),
      text: clipped,
      usedOcr: Boolean(usedOcr),
    });
  } catch (error) {
    console.error("extract error", error);
    const { message, status } = friendlyExtractError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
