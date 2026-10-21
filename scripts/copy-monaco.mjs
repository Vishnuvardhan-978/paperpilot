#!/usr/bin/env node
/**
 * Copies Monaco's prebuilt editor into public/monaco/vs so the editor loads
 * from the app itself (works offline and inside the desktop build).
 * Runs automatically after npm install and before dev/build.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "node_modules", "monaco-editor", "min", "vs");
const DEST_DIR = path.join(ROOT, "public", "monaco");
const DEST = path.join(DEST_DIR, "vs");
const STAMP = path.join(DEST_DIR, "VERSION");

if (!fs.existsSync(SRC)) {
  console.warn("[monaco] monaco-editor is not installed; the editor will fall back to the CDN.");
  process.exit(0);
}

const { version } = JSON.parse(
  fs.readFileSync(path.join(ROOT, "node_modules", "monaco-editor", "package.json"), "utf8"),
);
const current = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, "utf8").trim() : "";
if (current === version && fs.existsSync(path.join(DEST, "loader.js"))) process.exit(0);

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST_DIR, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });
fs.writeFileSync(STAMP, version);
console.log(`[monaco] copied monaco-editor ${version} to public/monaco/vs`);
