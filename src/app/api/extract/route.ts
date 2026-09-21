import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PDF file is required." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF files are supported." }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File is too large. Keep PDFs under 8MB for now." },
        { status: 400 },
      );
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const cleaned = (text || "").replace(/\s+/g, " ").trim();

    if (!cleaned) {
      return NextResponse.json(
        { error: "Could not read text from this PDF. Try another file." },
        { status: 422 },
      );
    }

    const clipped = cleaned.slice(0, 120000);

    return NextResponse.json({
      name: file.name,
      pages: totalPages,
      sizeBytes: file.size,
      charCount: clipped.length,
      preview: clipped.slice(0, 220),
      text: clipped,
    });
  } catch (error) {
    console.error("extract error", error);
    return NextResponse.json(
      { error: "Failed to read PDF. Please try again." },
      { status: 500 },
    );
  }
}
