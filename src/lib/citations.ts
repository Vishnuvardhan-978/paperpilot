export type Citation = {
  document: string;
  quote: string;
};

export type DoNext = {
  keyPoints: string[];
  askNext: string[];
  actions: string[];
};

export type Confidence = "high" | "medium" | "low" | null;

function parseBulletBlock(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function cutSection(
  text: string,
  startRe: RegExp,
  endRes: RegExp[],
): { before: string; section: string; after: string } | null {
  const start = text.match(startRe);
  if (!start || start.index == null) return null;

  const from = start.index;
  const afterStart = from + start[0].length;
  let end = text.length;

  for (const er of endRes) {
    er.lastIndex = 0;
    const rest = text.slice(afterStart);
    const m = rest.match(er);
    if (m && m.index != null) {
      end = Math.min(end, afterStart + m.index);
    }
  }

  return {
    before: text.slice(0, from).trim(),
    section: text.slice(afterStart, end).trim(),
    after: text.slice(end).trim(),
  };
}

/** Split model answer into body + do-next + sources. */
export function splitAnswerAndCitations(raw: string): {
  body: string;
  citations: Citation[];
  doNext: DoNext | null;
  confidence: Confidence;
} {
  let working = raw.trim();
  const doNext: DoNext = { keyPoints: [], askNext: [], actions: [] };
  let confidence: Confidence = null;

  const confMatch = working.match(/\n?CONFIDENCE:\s*(high|medium|low)\s*/i);
  if (confMatch && confMatch.index != null) {
    confidence = confMatch[1].toLowerCase() as "high" | "medium" | "low";
    working = `${working.slice(0, confMatch.index)}\n${working.slice(confMatch.index + confMatch[0].length)}`.trim();
  }

  const sourcesMarker = /\n(?:---\s*)?\n?SOURCES:\s*\n/i;
  let sourcesBlock = "";
  const sourcesMatch = working.match(sourcesMarker);
  if (sourcesMatch && sourcesMatch.index != null) {
    sourcesBlock = working.slice(sourcesMatch.index + sourcesMatch[0].length).trim();
    working = working.slice(0, sourcesMatch.index).trim();
  }

  const keyCut = cutSection(working, /\n?KEY POINTS:\s*\n/i, [
    /\nASK NEXT:\s*\n/i,
    /\nACTIONS:\s*\n/i,
  ]);
  if (keyCut) {
    doNext.keyPoints = parseBulletBlock(keyCut.section);
    working = `${keyCut.before}\n${keyCut.after}`.trim();
  }

  const askCut = cutSection(working, /\n?ASK NEXT:\s*\n/i, [/\nACTIONS:\s*\n/i]);
  if (askCut) {
    doNext.askNext = parseBulletBlock(askCut.section);
    working = `${askCut.before}\n${askCut.after}`.trim();
  }

  const actCut = cutSection(working, /\n?ACTIONS:\s*\n/i, []);
  if (actCut) {
    doNext.actions = parseBulletBlock(actCut.section);
    working = `${actCut.before}\n${actCut.after}`.trim();
  }

  const citations: Citation[] = [];
  for (const line of sourcesBlock.split("\n")) {
    const cleaned = line.replace(/^[-*•]\s*/, "").trim();
    if (!cleaned) continue;

    const m1 = cleaned.match(/^(.+?):\s*[“"'](.+?)[”"']\s*$/);
    const m2 = cleaned.match(/^\[(.+?)\]\s*(.+)$/);
    if (m1) {
      citations.push({ document: m1[1].trim(), quote: m1[2].trim() });
    } else if (m2) {
      citations.push({ document: m2[1].trim(), quote: m2[2].trim() });
    } else {
      citations.push({ document: "Source", quote: cleaned });
    }
  }

  const hasDoNext =
    doNext.keyPoints.length > 0 || doNext.askNext.length > 0 || doNext.actions.length > 0;

  return {
    body: working.trim(),
    citations,
    doNext: hasDoNext ? doNext : null,
    confidence,
  };
}
