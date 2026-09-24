import { splitAnswerAndCitations } from "@/lib/citations";
import { downloadText } from "@/lib/export";

export type Flashcard = {
  front: string;
  back: string;
};

function safeName(title: string) {
  return title.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "study-pack";
}

/** Build flashcards from KEY POINTS / ASK NEXT / quiz-style Q&A in an answer. */
export function flashcardsFromAnswer(answer: string, docName = "Document"): Flashcard[] {
  const { body, doNext } = splitAnswerAndCitations(answer);
  const cards: Flashcard[] = [];

  if (doNext?.keyPoints.length) {
    for (const point of doNext.keyPoints) {
      cards.push({
        front: `Remember from ${docName}:`,
        back: point,
      });
    }
  }

  if (doNext?.askNext.length) {
    for (const q of doNext.askNext) {
      cards.push({
        front: q,
        back: `(Open PaperPilot and ask this about ${docName})`,
      });
    }
  }

  // Quiz: lines like "1. Question?" followed later by ANSWER KEY
  const quizQ = body.match(/(?:^|\n)\s*\d+[.)]\s+(.+\?)\s*(?:\n|$)/g);
  const answerKey = body.match(/ANSWER KEY[\s\S]*$/i);
  if (quizQ && quizQ.length) {
    const answers = answerKey
      ? answerKey[0]
          .split("\n")
          .map((l) => l.replace(/^(?:ANSWER KEY:?|\d+[.)]\s*)/i, "").trim())
          .filter(Boolean)
      : [];
    quizQ.forEach((raw, i) => {
      const front = raw.replace(/^\s*\d+[.)]\s*/, "").trim();
      cards.push({
        front,
        back: answers[i] || "See answer key in the chat.",
      });
    });
  }

  // Dedupe by front
  const seen = new Set<string>();
  return cards.filter((c) => {
    const k = c.front.toLowerCase();
    if (seen.has(k) || !c.front.trim()) return false;
    seen.add(k);
    return true;
  });
}

export function flashcardsToAnkiTsv(cards: Flashcard[]) {
  return cards.map((c) => `${escapeTsv(c.front)}\t${escapeTsv(c.back)}`).join("\n");
}

function escapeTsv(s: string) {
  return s.replace(/\t/g, " ").replace(/\r?\n/g, " · ");
}

export function flashcardsToMarkdown(cards: Flashcard[], title: string) {
  const lines = [
    `# Study pack — ${title}`,
    "",
    `Exported from PaperPilot · ${new Date().toLocaleString()}`,
    "",
    `${cards.length} flashcards`,
    "",
  ];
  cards.forEach((c, i) => {
    lines.push(`## Card ${i + 1}`, "", `**Q:** ${c.front}`, "", `**A:** ${c.back}`, "");
  });
  return lines.join("\n");
}

export function exportStudyPackAnki(cards: Flashcard[], title: string) {
  if (!cards.length) return false;
  downloadText(
    `${safeName(title)}-anki.txt`,
    flashcardsToAnkiTsv(cards),
    "text/tab-separated-values;charset=utf-8",
  );
  return true;
}

export function exportStudyPackMarkdown(cards: Flashcard[], title: string) {
  if (!cards.length) return false;
  downloadText(
    `${safeName(title)}-study.md`,
    flashcardsToMarkdown(cards, title),
    "text/markdown;charset=utf-8",
  );
  return true;
}

export function studyNotesFromAnswer(answer: string, title: string) {
  const { body, doNext, citations } = splitAnswerAndCitations(answer);
  const lines = [
    `# Notes — ${title}`,
    "",
    `PaperPilot · ${new Date().toLocaleString()}`,
    "",
    "## Summary",
    "",
    body.trim() || "_No body_",
    "",
  ];
  if (doNext?.keyPoints.length) {
    lines.push("## Key points", "");
    for (const p of doNext.keyPoints) lines.push(`- ${p}`);
    lines.push("");
  }
  if (doNext?.actions.length) {
    lines.push("## Actions", "");
    for (const a of doNext.actions) lines.push(`- ${a}`);
    lines.push("");
  }
  if (citations.length) {
    lines.push("## Sources", "");
    for (const c of citations) {
      lines.push(`- **${c.document}:** “${c.quote}”`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function exportStudyNotes(answer: string, title: string) {
  downloadText(
    `${safeName(title)}-notes.md`,
    studyNotesFromAnswer(answer, title),
    "text/markdown;charset=utf-8",
  );
}
