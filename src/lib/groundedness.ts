import type { Citation } from "@/lib/citations";
import { splitAnswerAndCitations } from "@/lib/citations";

export type GroundednessLevel = "high" | "medium" | "low" | "none" | "unchecked";

export type GroundednessResult = {
  score: number; // 0–100
  level: GroundednessLevel;
  matched: number;
  total: number;
  label: string;
  detail: string;
};

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best overlap of quote inside corpus (exact / near / token). */
export function quoteMatchRatio(quote: string, corpus: string): number {
  const q = normalize(quote);
  const c = normalize(corpus);
  if (!q || q.length < 8) return 0;
  if (c.includes(q)) return 1;

  // Sliding window for fuzzy substring (length ± 20%)
  const target = Math.min(q.length, 120);
  const window = Math.min(c.length, target + 40);
  if (window < 12) return 0;

  const qTokens = q.split(" ").filter((t) => t.length > 2);
  if (qTokens.length === 0) return 0;

  let best = 0;
  const step = Math.max(1, Math.floor(target / 8));
  for (let i = 0; i + target <= c.length; i += step) {
    const slice = c.slice(i, i + window);
    let hits = 0;
    for (const t of qTokens) {
      if (slice.includes(t)) hits++;
    }
    best = Math.max(best, hits / qTokens.length);
    if (best >= 0.95) break;
  }
  return best;
}

export function scoreCitations(
  citations: Citation[],
  documentText: string,
): GroundednessResult {
  const usable = citations.filter(
    (c) => c.document.toLowerCase() !== "none" && c.quote.trim().length >= 8,
  );

  if (!documentText.trim()) {
    return {
      score: 0,
      level: "unchecked",
      matched: 0,
      total: usable.length,
      label: "No text",
      detail: "Groundedness needs extracted document text.",
    };
  }

  if (usable.length === 0) {
    return {
      score: 0,
      level: "none",
      matched: 0,
      total: 0,
      label: "No sources",
      detail: "Answer had no verifiable source quotes.",
    };
  }

  let matched = 0;
  let sum = 0;
  for (const c of usable) {
    const r = quoteMatchRatio(c.quote, documentText);
    sum += r;
    if (r >= 0.55) matched++;
  }

  const score = Math.round((sum / usable.length) * 100);
  const level: GroundednessLevel =
    score >= 75 ? "high" : score >= 45 ? "medium" : "low";

  const labels: Record<GroundednessLevel, string> = {
    high: "Well grounded",
    medium: "Partly grounded",
    low: "Weak grounding",
    none: "No sources",
    unchecked: "Unchecked",
  };

  return {
    score,
    level,
    matched,
    total: usable.length,
    label: labels[level],
    detail: `${matched}/${usable.length} quotes found in your sources · ${score}%`,
  };
}

/** Score a full assistant message against document corpus. */
export function scoreAnswerGroundedness(
  answer: string,
  documentText: string,
): GroundednessResult {
  const { citations } = splitAnswerAndCitations(answer);
  return scoreCitations(citations, documentText);
}
