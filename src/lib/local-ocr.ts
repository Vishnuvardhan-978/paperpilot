import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function sniffExt(buf: Buffer): ".png" | ".jpg" {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return ".jpg";
  }
  return ".png";
}

function parseOcrStdout(stdout: string | Buffer | undefined) {
  const raw = (stdout?.toString?.() || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { text?: string; error?: string; usedOcr?: boolean };
  } catch {
    return null;
  }
}

/**
 * OCR a scanned PDF in a background child process (same npm run dev terminal logs it).
 * You do NOT need to open another terminal.
 */
export async function ocrPdfLocally(buffer: Uint8Array): Promise<string> {
  if (!buffer?.byteLength) {
    throw new Error("Upload buffer was empty. Try uploading the PDF again.");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperpilot-pdf-"));
  const pdfPath = path.join(tmpDir, "doc.pdf");
  const script = path.join(process.cwd(), "scripts", "ocr-pdf.mjs");

  try {
    // Hard copy so the ArrayBuffer cannot be detached before the child reads it
    const copy = Buffer.alloc(buffer.byteLength);
    copy.set(buffer);
    await fs.writeFile(pdfPath, copy);

    const stat = await fs.stat(pdfPath);
    if (stat.size !== copy.length) {
      throw new Error(
        `PDF write incomplete (${stat.size}/${copy.length} bytes). Try again.`,
      );
    }

    let stdout = "";
    try {
      const result = await execFileAsync(process.execPath, [script, pdfPath], {
        maxBuffer: 12 * 1024 * 1024,
        timeout: 300_000,
        windowsHide: true,
        env: process.env,
        cwd: process.cwd(),
      });
      stdout = result.stdout?.toString?.() || "";
      if (result.stderr?.toString?.()?.trim()) {
        console.warn("ocr-pdf stderr:", result.stderr.toString().slice(0, 500));
      }
    } catch (error) {
      const err = error as { stdout?: Buffer | string; message?: string };
      const parsed = parseOcrStdout(err.stdout);
      if (parsed?.error) throw new Error(parsed.error);
      if (parsed?.text) return parsed.text.trim();
      throw new Error(err.message || "OCR process failed.");
    }

    const parsed = parseOcrStdout(stdout);
    if (!parsed) {
      throw new Error("OCR process returned empty output.");
    }
    if (parsed.error && !parsed.text) {
      throw new Error(parsed.error);
    }
    return (parsed.text || "").trim();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** OCR standalone images via child process (same isolation). */
export async function ocrImageBuffers(images: Buffer[]): Promise<string> {
  if (!images.length) return "";

  const limited = images.slice(0, 8);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperpilot-img-ocr-"));
  const script = path.join(process.cwd(), "scripts", "ocr-file.mjs");
  const parts: string[] = [];

  try {
    for (let i = 0; i < limited.length; i++) {
      const img = Buffer.from(limited[i]);
      const filePath = path.join(tmpDir, `page-${i}${sniffExt(img)}`);
      await fs.writeFile(filePath, img);
      const { stdout } = await execFileAsync(process.execPath, [script, filePath], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
        env: process.env,
        cwd: process.cwd(),
      });
      const text = (stdout || "").replace(/\s+/g, " ").trim();
      if (text) parts.push(`--- Page ${i + 1} ---\n${text}`);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return parts.join("\n\n").trim().slice(0, 120000);
}
