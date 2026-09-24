/**
 * Smoke checks for Truth Tutor libs (no test runner).
 * Run: node scripts/smoke-truth.mjs
 */

function normalize(s) {
  return s.toLowerCase().replace(/[""']/g, "").replace(/\s+/g, " ").trim();
}

function quoteMatchRatio(quote, corpus) {
  const q = normalize(quote);
  const c = normalize(corpus);
  if (!q || q.length < 8) return 0;
  if (c.includes(q)) return 1;
  const qTokens = q.split(" ").filter((t) => t.length > 2);
  if (!qTokens.length) return 0;
  let hits = 0;
  for (const t of qTokens) if (c.includes(t)) hits++;
  return hits / qTokens.length;
}

function parseConfidence(raw) {
  const m = raw.match(/\n?CONFIDENCE:\s*(high|medium|low)\s*/i);
  return m ? m[1].toLowerCase() : null;
}

function parseKeyPoints(raw) {
  const m = raw.match(/KEY POINTS:\s*\n([\s\S]*?)(?:\nASK NEXT:|\nACTIONS:|\nCONFIDENCE:|\nSOURCES:|$)/i);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

const corpus =
  "The mitochondria is the powerhouse of the cell. Photosynthesis occurs in chloroplasts.";
const good = quoteMatchRatio("mitochondria is the powerhouse", corpus);
const bad = quoteMatchRatio("the moon is made of cheese entirely", corpus);

if (good < 0.55) {
  console.error("FAIL: expected good quote to match, got", good);
  process.exit(1);
}
if (bad > 0.4) {
  console.error("FAIL: expected bad quote to miss, got", bad);
  process.exit(1);
}

const sample = `Hello.

KEY POINTS:
- Point A
- Point B

ASK NEXT:
- What else?

ACTIONS:
- Read again

CONFIDENCE: high

SOURCES:
- bio.pdf: "mitochondria is the powerhouse"
`;

const conf = parseConfidence(sample);
const points = parseKeyPoints(sample);
if (conf !== "high") {
  console.error("FAIL: confidence parse", conf);
  process.exit(1);
}
if (points.length < 2) {
  console.error("FAIL: key points parse", points);
  process.exit(1);
}

console.log("smoke-truth: OK", {
  good: good.toFixed(2),
  bad: bad.toFixed(2),
  conf,
  keyPoints: points.length,
});
