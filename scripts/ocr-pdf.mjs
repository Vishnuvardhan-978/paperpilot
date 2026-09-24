/**
 * Scanned-PDF OCR outside Next.js.
 * Uses Poppler (pdftoppm) for page images — handles JBIG2 scans pdf.js cannot.
 * Then Tesseract for text.
 *
 * Usage: node scripts/ocr-pdf.mjs <pdfPath>
 * Prints JSON: { text, pages, usedOcr } | { error }
 *
 * Spawned automatically by the app — no separate terminal needed.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createWorker } from "tesseract.js";
import { extractText, getDocumentProxy } from "unpdf";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: node scripts/ocr-pdf.mjs <pdfPath>");
  process.exit(1);
}

function fail(message) {
  process.stdout.write(
    JSON.stringify({ error: message, text: "", pages: 0, usedOcr: false }),
  );
  process.exit(2);
}

function findPdftoppm() {
  if (process.env.PDFTOPPM_PATH && fs.existsSync(process.env.PDFTOPPM_PATH)) {
    return process.env.PDFTOPPM_PATH;
  }

  const candidates = [
    "pdftoppm",
    "pdftoppm.exe",
    path.join("E:", "poppler", "poppler-25.12.0", "Library", "bin", "pdftoppm.exe"),
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "poppler",
      "Library",
      "bin",
      "pdftoppm.exe",
    ),
  ];

  for (const bin of candidates) {
    try {
      execFileSync(bin, ["-v"], { stdio: "pipe", windowsHide: true });
      return bin;
    } catch {
      // try next
    }
  }
  return null;
}

function renderWithPoppler(pdfFile, outDir, maxPages = 8) {
  const pdftoppm = findPdftoppm();
  if (!pdftoppm) {
    throw new Error(
      "Poppler pdftoppm not found. Install Poppler and add it to PATH, or set PDFTOPPM_PATH.",
    );
  }

  const stat = fs.statSync(pdfFile);
  if (!stat.size) {
    throw new Error("PDF file on disk is empty (0 bytes). Re-upload the file.");
  }

  const prefix = path.join(outDir, "page");
  try {
    execFileSync(
      pdftoppm,
      ["-png", "-r", "200", "-f", "1", "-l", String(maxPages), pdfFile, prefix],
      { stdio: "pipe", windowsHide: true, timeout: 180_000 },
    );
  } catch (error) {
    const detail =
      (error.stderr && error.stderr.toString()) ||
      (error.stdout && error.stdout.toString()) ||
      (error instanceof Error ? error.message : String(error));
    throw new Error(`pdftoppm failed (${stat.size} bytes PDF): ${detail.slice(0, 400)}`);
  }

  return fs
    .readdirSync(outDir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => path.join(outDir, f));
}

try {
  if (!fs.existsSync(pdfPath)) {
    fail(`PDF not found: ${pdfPath}`);
  }

  const fileSize = fs.statSync(pdfPath).size;
  if (fileSize < 64) {
    fail(`PDF is too small (${fileSize} bytes). Re-upload the file.`);
  }

  // Header check
  const fd = fs.openSync(pdfPath, "r");
  const head = Buffer.alloc(5);
  fs.readSync(fd, head, 0, 5, 0);
  fs.closeSync(fd);
  if (head.toString("ascii") !== "%PDF-") {
    fail("Temp file is not a valid PDF (missing %PDF- header). Re-upload.");
  }

  const buffer = new Uint8Array(fs.readFileSync(pdfPath));
  let pages = 8; // default render budget when metadata is untrusted

  try {
    const pdf = await getDocumentProxy(buffer);
    if (pdf.numPages && pdf.numPages > 0) {
      pages = pdf.numPages;
    }
    const extracted = await extractText(pdf, { mergePages: true });
    const cleaned = (extracted.text || "").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 40) {
      process.stdout.write(
        JSON.stringify({
          text: cleaned.slice(0, 120000),
          pages: extracted.totalPages || pages,
          usedOcr: false,
        }),
      );
      process.exit(0);
    }
  } catch {
    // continue to image OCR
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperpilot-pdf-ocr-"));
  const worker = await createWorker("eng");
  const parts = [];

  try {
    const renderPages = Math.min(Math.max(pages, 1), 8);
    const images = renderWithPoppler(pdfPath, tmpDir, renderPages);
    if (!images.length) {
      throw new Error("Poppler produced no page images from this PDF.");
    }

    for (let i = 0; i < images.length; i++) {
      const {
        data: { text },
      } = await worker.recognize(images[i]);
      const t = (text || "").replace(/\s+/g, " ").trim();
      if (t) parts.push(`--- Page ${i + 1} ---\n${t}`);
    }
  } finally {
    await worker.terminate().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const out = parts.join("\n\n").trim();
  if (!out) {
    fail("OCR produced no readable text from this scanned PDF.");
  }

  process.stdout.write(
    JSON.stringify({
      text: out.slice(0, 120000),
      pages: Math.max(pages === 8 ? parts.length : pages, parts.length),
      usedOcr: true,
    }),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
