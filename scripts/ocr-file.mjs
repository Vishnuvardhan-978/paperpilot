import { createWorker } from "tesseract.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/ocr-file.mjs <imagePath>");
  process.exit(1);
}

const worker = await createWorker("eng");
try {
  const {
    data: { text },
  } = await worker.recognize(filePath);
  process.stdout.write(text || "");
} finally {
  await worker.terminate();
}
