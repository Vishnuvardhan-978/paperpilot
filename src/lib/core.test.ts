import { describe, expect, it } from "vitest";
import { splitAnswerAndCitations } from "@/lib/citations";
import { quoteMatchRatio, scoreAnswerGroundedness } from "@/lib/groundedness";
import { diffStats, lineDiff } from "@/lib/line-diff";
import { applySearchReplace, planFileEdit } from "@/lib/apply-edit";
import { parseMediaRequest } from "@/lib/media-intent";
import { flashcardsFromAnswer } from "@/lib/study-pack";
import { parseQuiz, review } from "@/lib/learning";
import { findQuoteSpan } from "@/lib/quote-locate";
import { isSensitive } from "@/lib/parental";
import { applyStyle, detectStyle } from "@/lib/image-styles";
import { allowRequest } from "@/lib/api-limit";

const ANSWER = `Photosynthesis turns light into sugar.

KEY POINTS:
- Plants use chlorophyll
- Oxygen is released

ASK NEXT:
- What is chlorophyll?

CONFIDENCE: high

SOURCES:
- Bio.pdf: "plants capture light energy with chlorophyll"
- [Notes] oxygen is a by-product`;

describe("citations", () => {
  it("splits body, do-next, confidence and sources", () => {
    const r = splitAnswerAndCitations(ANSWER);
    expect(r.body).toBe("Photosynthesis turns light into sugar.");
    expect(r.confidence).toBe("high");
    expect(r.doNext?.keyPoints).toEqual(["Plants use chlorophyll", "Oxygen is released"]);
    expect(r.doNext?.askNext).toEqual(["What is chlorophyll?"]);
    expect(r.citations).toEqual([
      { document: "Bio.pdf", quote: "plants capture light energy with chlorophyll" },
      { document: "Notes", quote: "oxygen is a by-product" },
    ]);
  });

  it("handles plain answers", () => {
    const r = splitAnswerAndCitations("Just text.");
    expect(r).toMatchObject({ body: "Just text.", citations: [], doNext: null, confidence: null });
  });
});

describe("groundedness", () => {
  const corpus = "In the leaf, plants capture light energy with chlorophyll. Oxygen is a by-product of the process.";

  it("scores exact quotes as 1", () => {
    expect(quoteMatchRatio("plants capture light energy with chlorophyll", corpus)).toBe(1);
  });

  it("rejects short or unrelated quotes", () => {
    expect(quoteMatchRatio("leaf", corpus)).toBe(0);
    expect(quoteMatchRatio("quantum chromodynamics governs quarks strongly", corpus)).toBeLessThan(0.3);
  });

  it("rates a well-sourced answer high", () => {
    const g = scoreAnswerGroundedness(ANSWER, corpus);
    expect(g.level).toBe("high");
    expect(g.matched).toBe(2);
  });

  it("is unchecked without text and none without sources", () => {
    expect(scoreAnswerGroundedness(ANSWER, "").level).toBe("unchecked");
    expect(scoreAnswerGroundedness("No sources here.", corpus).level).toBe("none");
  });
});

describe("lineDiff", () => {
  it("finds added and removed lines", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc\nd");
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
    expect(d.filter((l) => l.type === "same").map((l) => l.text)).toEqual(["a", "c"]);
  });

  it("treats CRLF like LF", () => {
    expect(diffStats(lineDiff("a\r\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });
});

describe("apply-edit", () => {
  const file = "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n";

  it("applies SEARCH/REPLACE hunks", () => {
    const out = applySearchReplace(file, "<<<<<<< SEARCH\n  return 1;\n=======\n  return 42;\n>>>>>>> REPLACE");
    expect(out).toContain("return 42;");
    expect(out).toContain("return 2;");
  });

  it("returns null when the search text is missing", () => {
    expect(applySearchReplace(file, "<<<<<<< SEARCH\nnope\n=======\nx\n>>>>>>> REPLACE")).toBeNull();
  });

  it("plans a search-replace edit", () => {
    expect(planFileEdit(file, "<<<<<<< SEARCH\n  return 2;\n=======\n  return 3;\n>>>>>>> REPLACE").mode).toBe("search-replace");
  });

  it("refuses to wipe a long file with a tiny unrelated snippet", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const plan = planFileEdit(long, "totally\nnew");
    expect(plan.nextText).toBe(long);
    expect(plan.warning).toMatch(/Refused/);
  });

  it("writes new files whole", () => {
    expect(planFileEdit("", "hello")).toEqual({ nextText: "hello", mode: "full-replace" });
  });
});

describe("media intent", () => {
  it("parses slash commands", () => {
    expect(parseMediaRequest("/video sunrise over hills")).toEqual({ kind: "video", prompt: "sunrise over hills", aspect: "16:9" });
  });

  it("parses plain requests", () => {
    expect(parseMediaRequest("create an image of a cat in space")).toMatchObject({ kind: "image", prompt: "a cat in space" });
  });

  it("ignores plain requests in slash-only mode", () => {
    expect(parseMediaRequest("create an image component", true)).toBeNull();
  });
});

describe("study pack", () => {
  it("builds cards from key points and ask-next", () => {
    const cards = flashcardsFromAnswer(ANSWER, "Bio");
    expect(cards.map((c) => c.back)).toContain("Plants use chlorophyll");
    expect(cards.map((c) => c.front)).toContain("What is chlorophyll?");
  });
});

describe("spaced repetition", () => {
  const base = { id: "x", front: "f", back: "b", source: "s", lens: "study" as const, createdAt: 0, due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  const DAY = 86_400_000;

  it("grows intervals on good answers", () => {
    const one = review(base, "good", 0);
    const two = review(one, "good", one.due);
    const three = review(two, "good", two.due);
    expect([one.interval, two.interval]).toEqual([1, 6]);
    expect(three.interval).toBeGreaterThan(12);
    expect(three.due).toBe(two.due + three.interval * DAY);
  });

  it("resets on again and lowers ease", () => {
    const r = review({ ...base, reps: 3, interval: 20 }, "again", 0);
    expect(r).toMatchObject({ reps: 0, interval: 0, lapses: 1 });
    expect(r.ease).toBeLessThan(2.5);
    expect(r.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe("parseQuiz", () => {
  it("reads a JSON array inside prose and drops bad rows", () => {
    const qs = parseQuiz('Here you go:\n[{"q":"2+2?","choices":["3","4"],"answer":1},{"q":"bad","choices":["a"],"answer":0}]');
    expect(qs).toEqual([{ q: "2+2?", choices: ["3", "4"], answer: 1 }]);
  });

  it("returns [] for garbage", () => {
    expect(parseQuiz("no quiz")).toEqual([]);
  });
});

describe("findQuoteSpan", () => {
  const items = ["Chapter 2", "Plants capture light", " energy with chlorophyll.", "Then they rest."];

  it("finds an exact quote across items", () => {
    expect(findQuoteSpan(items, "capture light energy with chlorophyll")).toEqual({ items: [1, 2], score: 1 });
  });

  it("finds a paraphrased quote by word overlap", () => {
    const r = findQuoteSpan(items, "plants capture energy using chlorophyll");
    expect(r?.items).toContain(1);
    expect(r!.score).toBeGreaterThan(0.6);
  });

  it("returns null when nothing matches", () => {
    expect(findQuoteSpan(items, "quantum physics rules")).toBeNull();
  });
});

describe("parental", () => {
  it("flags sensitive questions", () => {
    expect(isSensitive("how do I buy a gun")).toBe(true);
    expect(isSensitive("why is the sky blue")).toBe(false);
  });
});

describe("image styles", () => {
  it("detects a style named in the request", () => {
    expect(detectStyle("an anime cat on a roof")).toBe("anime");
    expect(detectStyle("a watercolor of a harbor")).toBe("watercolor");
    expect(detectStyle("a cat")).toBe("none");
  });

  it("appends the style suffix once, without trailing punctuation", () => {
    expect(applyStyle("a fox.", "pixel")).toBe("a fox, pixel art, 32-bit, crisp pixels, limited palette");
    expect(applyStyle("a fox", "none")).toBe("a fox");
  });
});

describe("rate limit cost", () => {
  it("counts a batch as several requests", () => {
    const key = `t-${Math.random()}`;
    expect(allowRequest(key, 4, 60_000, 3).ok).toBe(true);
    expect(allowRequest(key, 4, 60_000, 2).ok).toBe(false);
    expect(allowRequest(key, 4, 60_000, 1).ok).toBe(true);
  });
});
