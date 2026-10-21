/** Find which text items (e.g. pdf.js text runs on a page) hold a quoted passage. */

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[“”"'‘’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Exact match of the normalized quote (or its first 80 chars) gives score 1.
 * Otherwise the densest run of quote words, scored by how many quote words it covers.
 */
export function findQuoteSpan(items: string[], quote: string): { items: number[]; score: number } | null {
  const q = norm(quote);
  if (q.length < 6) return null;

  // Normalized page text with a map from each char back to its item.
  let text = "";
  const owner: number[] = [];
  items.forEach((raw, i) => {
    const t = norm(raw);
    if (!t) return;
    if (text) {
      text += " ";
      owner.push(i);
    }
    text += t;
    for (let k = 0; k < t.length; k++) owner.push(i);
  });
  if (!text) return null;

  const spanItems = (from: number, to: number) => [...new Set(owner.slice(from, to))];

  for (const needle of [q, q.slice(0, 80).trim()]) {
    const at = text.indexOf(needle);
    if (needle.length >= 6 && at >= 0) return { items: spanItems(at, at + needle.length), score: 1 };
  }

  const words = q.split(" ").filter((w) => w.length > 2);
  if (!words.length) return null;
  const wanted = new Set(words);
  const pageWords: { w: string; at: number }[] = [];
  for (const m of text.matchAll(/\S+/g)) pageWords.push({ w: m[0], at: m.index ?? 0 });

  const win = Math.max(words.length + 4, Math.ceil(words.length * 1.3));
  let best = { score: 0, from: 0, to: 0 };
  for (let i = 0; i < pageWords.length; i++) {
    const seen = new Set<string>();
    let last = i;
    for (let j = i; j < Math.min(pageWords.length, i + win); j++) {
      if (wanted.has(pageWords[j].w)) {
        seen.add(pageWords[j].w);
        last = j;
      }
    }
    const score = seen.size / wanted.size;
    if (score > best.score) best = { score, from: pageWords[i].at, to: pageWords[last].at + pageWords[last].w.length };
  }
  return best.score > 0 ? { items: spanItems(best.from, best.to), score: best.score } : null;
}
