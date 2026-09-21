export type Citation = {
  document: string;
  quote: string;
};

/** Split model answer into body + optional sources block. */
export function splitAnswerAndCitations(raw: string): {
  body: string;
  citations: Citation[];
} {
  const marker = /\n(?:---\s*)?\n?SOURCES:\s*\n/i;
  const match = raw.match(marker);

  if (!match || match.index == null) {
    return { body: raw.trim(), citations: [] };
  }

  const body = raw.slice(0, match.index).trim();
  const sourcesBlock = raw.slice(match.index + match[0].length).trim();
  const citations: Citation[] = [];

  for (const line of sourcesBlock.split("\n")) {
    const cleaned = line.replace(/^[-*•]\s*/, "").trim();
    if (!cleaned) continue;

    // Formats: DocName: "quote"  OR  [DocName] quote
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

  return { body, citations };
}
