/**
 * Turns rated agent runs (👍/👎 in the app) into fine-tuning files for PaperPilot-Coder.
 *
 *   node scripts/training-export.mjs [--val 0.1] [--out <dir>]
 *
 * Reads  ~/.paperpilot/training/examples.jsonl (PAPERPILOT_TRAINING_DIR to change)
 * Writes <out>/train.jsonl and val.jsonl (👍 runs: what to learn) and bad.jsonl (👎 runs: what to avoid)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.PAPERPILOT_TRAINING_DIR?.trim() || path.join(os.homedir(), ".paperpilot", "training");
const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const valShare = Number(flag("--val", "0.1"));
const out = path.resolve(flag("--out", path.join(DIR, "export")));
const file = path.join(DIR, "examples.jsonl");

if (!fs.existsSync(file)) {
  console.log(`No examples yet (${file}).\nRate coding-agent answers with 👍 / 👎 in PaperPilot to start collecting.`);
  process.exit(0);
}

const latest = new Map();
let broken = 0;
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const ex = JSON.parse(line);
    latest.set(ex.id, ex);
  } catch {
    broken++;
  }
}

const usable = (ex) => Array.isArray(ex.messages) && ex.messages.some((m) => m.role === "assistant");
const all = [...latest.values()].filter(usable);
const good = all.filter((ex) => ex.rating === "good");
const bad = all.filter((ex) => ex.rating === "bad");

// Deterministic split (by id) so re-exports keep the same validation set.
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const val = good.filter((ex) => hash(ex.id) % 1000 < valShare * 1000);
const train = good.filter((ex) => !val.includes(ex));

const strip = ({ messages, tools }) => JSON.stringify({ messages, tools });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "train.jsonl"), train.map(strip).join("\n") + (train.length ? "\n" : ""));
fs.writeFileSync(path.join(out, "val.jsonl"), val.map(strip).join("\n") + (val.length ? "\n" : ""));
fs.writeFileSync(path.join(out, "bad.jsonl"), bad.map(strip).join("\n") + (bad.length ? "\n" : ""));

const toolCalls = good.reduce((n, ex) => n + ex.messages.reduce((k, m) => k + (m.tool_calls?.length || 0), 0), 0);
const models = [...new Set(good.map((ex) => (ex.model || "unknown").replace(/:.*/, "")))].join(", ") || "—";
console.log(`Examples: ${all.length} rated (${good.length} 👍, ${bad.length} 👎)${broken ? `, ${broken} unreadable lines skipped` : ""}`);
console.log(`👍 runs: ${toolCalls} tool calls in total, answered by: ${models}`);
console.log(`Wrote ${out}\n  train.jsonl  ${train.length}\n  val.jsonl    ${val.length}\n  bad.jsonl    ${bad.length}`);
if (good.length < 300) console.log(`\nAim for 300+ 👍 examples before the first PaperPilot-Coder training run (${300 - good.length} to go).`);
