export type LensId = "kid" | "study" | "normal" | "proof" | "bridge";

export type AskIntent =
  | "ask"
  | "quiz"
  | "explain"
  | "claim"
  | "map"
  | "blind"
  | "conflict"
  | "teach";

export const LENSES: {
  id: LensId;
  label: string;
  short: string;
}[] = [
  { id: "kid", label: "Kid", short: "Simple & friendly" },
  { id: "study", label: "Study", short: "Learn & remember" },
  { id: "normal", label: "Normal", short: "Clear answers" },
  { id: "proof", label: "Proof", short: "Cite everything" },
  { id: "bridge", label: "Bridge", short: "Sources + world, labeled" },
];

export const LENS_CHIPS: Record<LensId, string[]> = {
  kid: [
    "Explain this like I'm 10",
    "What is this document about?",
    "Tell me the 3 most important things",
  ],
  study: [
    "Teach me the key ideas",
    "Make flashcards from this",
    "What should I revise first?",
  ],
  normal: [
    "Summarize this document",
    "What are the key points?",
    "List all important dates",
  ],
  proof: [
    "What can you prove from this document?",
    "List every claim with a source quote",
    "What is NOT supported by the text?",
  ],
  bridge: [
    "What does the source say — and what else should I know?",
    "Connect this document to real-world examples",
    "Where do the sources stop and world knowledge begin?",
  ],
};

export const QUIZ_PROMPT =
  "Create a short quiz from ONLY this document: 5 questions (mix of short answer and multiple choice). After each question, wait — actually list all questions first, then an ANSWER KEY section. Keep it fair and grounded in the text.";

export const EXPLAIN_PROMPT =
  "Explain this document simply for my current lens. Use short sections and concrete examples from the text only.";

export const DOC_MAP_PROMPT =
  "Create a Document Map of ONLY this source. Use markdown:\n## Overview (2 sentences)\n## Sections (bullets: section/topic → one-line what it covers)\n## Key terms (5–10 definitions grounded in the text)\n## Who should read this\nDo not invent sections that are not in the source.";

export const CLAIM_PROMPT_PREFIX =
  "CLAIM CHECK — Verify this claim against ONLY the attached sources. Use this exact structure:\n## Verdict: SUPPORTS | PARTIAL | CONTRADICTS | NOT FOUND\n## Why (short)\n## Evidence (quotes)\n## Gaps (what is missing)\n\nClaim: ";

export const BLIND_SPOT_PROMPT =
  "Find Blind Spots in these sources only. Structure:\n## Covered well\n## Thin or unclear\n## Missing (questions a careful reader would still have)\n## What to ask next\nStay honest — do not invent content that is not in the sources.";

export const CONFLICT_PROMPT =
  "Conflict scan across the attached documents only.\n## Confirmed conflicts (numbers, dates, names, clauses that disagree)\n## Possible conflicts (need human judgment)\n## Aligned facts\n## Open questions\nIf there is only one document, say so and list internal inconsistencies if any.";

export const TEACH_PROMPT =
  "Teach me this document as a short lesson for my active lens.\n## Learning goal\n## Lesson (3–6 short sections)\n## Check understanding (3 questions, then ANSWER KEY)\n## Practice action\nUse only facts from the sources.";

export function lensSystemRules(lens: LensId): string {
  switch (lens) {
    case "kid":
      return `LENS: KID (for children and beginners)
- Use very simple words and short sentences.
- Be warm and encouraging. Use friendly examples.
- Avoid scary, legal, or graphic language. If content is sensitive, say "Ask a parent or teacher about this part."
- Prefer bullet points and tiny sections.
- If sources are attached: stay faithful to them. In Open Tutor: careful general knowledge only.`;
    case "study":
      return `LENS: STUDY (learning mode)
- Teach clearly: idea → why it matters → mini example.
- Use headings, bullets, and memory tips.
- Highlight definitions and must-remember facts.
- If sources are attached: ground in them. In Open Tutor: teach carefully and flag uncertainty.`;
    case "proof":
      return `LENS: PROOF (strict evidence)
- Every factual sentence must be supportable by the documents when sources exist.
- Prefer quotes and precise references by document name.
- If something is missing, say clearly: "Not found in the documents."
- Do not speculate or fill gaps from world knowledge when in Proof + docs/library.
- Open Tutor + Proof: label every claim as general knowledge and keep confidence low when unsure.`;
    case "bridge":
      return `LENS: BRIDGE (sources + world, always labeled)
- ALWAYS use two clear markdown sections when sources exist:
  ## From your sources
  ## Beyond the page (world context)
- Never mix unlabeled world knowledge into "From your sources".
- If something is only world knowledge, say so plainly.
- If sources are empty (Open Tutor), use ## Tutor answer and skip source sections.
- Be honest about uncertainty in world context.`;
    default:
      return `LENS: NORMAL
- Clear, helpful, concise answers.
- Prefer attached sources when present; otherwise tutor carefully with labeled general knowledge.`;
  }
}

export function isCasualTurn(question: string): boolean {
  const q = question.trim().toLowerCase().replace(/[!?.…]+$/g, "").trim();
  if (!q || q.length > 48) return false;
  if (
    /^(hi|hello|hey|yo|sup|hola|namaste|hai|good\s+(morning|evening|afternoon)|thanks|thank you|ty|ok|okay|bye|gm|gn)(\s+.*)?$/i.test(
      q,
    )
  ) {
    // "hi paper pilot" / "hello there" still casual
    return true;
  }
  return false;
}

/** Match answer length & structure to what the user actually asked. */
export function responseShapeInstructions(
  question: string,
  intent: AskIntent,
  scope: "docs" | "library" | "open",
): string {
  if (intent === "ask" && isCasualTurn(question)) {
    return `RESPONSE BUDGET — GREETING / SMALL TALK:
- Reply in 1–3 short friendly sentences only.
- Do NOT add KEY POINTS, ASK NEXT, ACTIONS, SOURCES, or CONFIDENCE.
- Do NOT write a long product pitch or capability list.`;
  }

  const words = question.trim().split(/\s+/).filter(Boolean).length;
  const simpleAsk = intent === "ask" && words > 0 && words <= 14;

  if (simpleAsk) {
    return `RESPONSE BUDGET — SIMPLE QUESTION:
- Match the question: short answer first (about 40–120 words).
- Prefer a clear paragraph or up to 4 bullets. No essays.
- Skip KEY POINTS / ASK NEXT / ACTIONS / SOURCES / CONFIDENCE unless the user asks for steps, a quiz, sources, or more detail.
- If a document is attached, answer from it briefly; say "not in the document" if missing.`;
  }

  if (intent !== "ask") {
    return `RESPONSE BUDGET — TASK (${intent.toUpperCase()}):
- Do the requested task thoroughly but still scannable.
- Include KEY POINTS / ASK NEXT / ACTIONS (2–3 bullets each) and SOURCES when useful.
- End with CONFIDENCE: high | medium | low before SOURCES when sources apply.`;
  }

  const kidNote =
    "Keep KEY POINTS and ASK NEXT concrete and useful.";

  return `RESPONSE BUDGET — SUBSTANTIVE QUESTION:
- Answer clearly first; depth should match the question (not a book chapter).
- After the main answer, add:

KEY POINTS:
- point 1
- point 2
- point 3

ASK NEXT:
- question 1
- question 2

ACTIONS:
- action 1
- action 2

Then:
CONFIDENCE: high | medium | low

SOURCES:
${
  scope === "open"
    ? `- World knowledge: "short note" (only if you used general knowledge)`
    : `- DocumentName: "short quote from the document"`
}

Rules:
- 2–3 bullets per section is enough (not more than 4).
- ${kidNote}
- Prefer shorter answers when the question is narrow.`;
}

export function doNextInstructions(lens: LensId): string {
  // Kept for callers; prefer responseShapeInstructions for asks.
  void lens;
  return responseShapeInstructions("Explain the main ideas in detail", "ask", "docs");
}
