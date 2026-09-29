/** Decide how to turn a model code block into the next file contents. */

export type ApplyPlan = {
  nextText: string;
  mode: "full-replace" | "snippet-merge" | "search-replace";
  warning?: string;
};

const SEARCH_REPLACE_RE =
  /<<<<<<<\s*SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>>\s*REPLACE/gi;

function norm(s: string) {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function linesOf(s: string) {
  return norm(s).replace(/\n$/, "").split("\n");
}

function trimTrailingEmpty(lines: string[]) {
  const out = [...lines];
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** Apply one or more SEARCH/REPLACE hunks. Returns null if none parsed. */
export function applySearchReplace(before: string, proposed: string): string | null {
  const src = norm(before);
  let out = src;
  let matched = 0;
  const re = new RegExp(SEARCH_REPLACE_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(proposed)) !== null) {
    const search = m[1].replace(/\n$/, "");
    const replace = m[2].replace(/\n$/, "");
    if (!search) continue;
    const idx = out.indexOf(search);
    if (idx < 0) {
      // Soft match: trim ends
      const soft = out.indexOf(search.trim());
      if (soft < 0) return null;
      out = out.slice(0, soft) + replace.trim() + out.slice(soft + search.trim().length);
    } else {
      out = out.slice(0, idx) + replace + out.slice(idx + search.length);
    }
    matched++;
  }
  return matched > 0 ? out : null;
}

/**
 * Merge a short snippet into a large file by anchoring on shared lines.
 * Returns null if we cannot find a confident place to splice.
 */
export function mergeSnippetIntoFile(before: string, snippet: string): string | null {
  const a = linesOf(before);
  const b = trimTrailingEmpty(linesOf(snippet));
  if (!a.length || b.length < 1) return null;
  if (b.length >= a.length * 0.55) return null;

  const firstIdx = b.findIndex((l) => l.trim().length > 0);
  const lastIdx = (() => {
    for (let i = b.length - 1; i >= 0; i--) if (b[i].trim()) return i;
    return -1;
  })();
  if (firstIdx < 0 || lastIdx < 0) return null;

  const first = b[firstIdx];
  const last = b[lastIdx];
  const firstTrim = first.trim();
  const lastTrim = last.trim();

  const starts: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === first || a[i].trim() === firstTrim) starts.push(i);
  }
  // CSS/JS: match on selector / signature prefix before "{"
  if (!starts.length && firstTrim.includes("{")) {
    const head = firstTrim.split("{")[0].trim();
    if (head.length >= 4) {
      for (let i = 0; i < a.length; i++) {
        if (a[i].trim().startsWith(head)) starts.push(i);
      }
    }
  }
  if (!starts.length) {
    // Try any distinctive non-empty proposed line as anchor
    for (const line of b) {
      const t = line.trim();
      if (t.length < 8) continue;
      for (let i = 0; i < a.length; i++) {
        if (a[i].trim() === t) starts.push(i);
      }
      if (starts.length) break;
    }
  }
  if (!starts.length) return null;

  let best: { start: number; end: number; score: number } | null = null;
  for (const start of starts) {
    let end = -1;
    for (let i = start; i < a.length; i++) {
      if (a[i] === last || a[i].trim() === lastTrim) end = i;
    }
    if (end < start) {
      // Window sized to snippet (+ a little slack for edited middle)
      end = Math.min(a.length - 1, start + Math.max(b.length - 1, Math.ceil(b.length * 1.4)));
    }
    // Prefer windows close to snippet length
    const span = end - start + 1;
    const score =
      1000 -
      Math.abs(span - b.length) * 3 -
      (starts.length > 1 ? start * 0.001 : 0) +
      (a[start] === first ? 5 : 0) +
      (a[end] === last ? 5 : 0);
    if (!best || score > best.score) best = { start, end, score };
  }
  if (!best) return null;

  // Avoid replacing almost the whole file with a tiny snippet
  if (best.end - best.start + 1 > Math.max(a.length * 0.5, b.length * 8)) return null;

  return [...a.slice(0, best.start), ...b, ...a.slice(best.end + 1)].join("\n");
}

function looksLikeFullFile(before: string, proposed: string) {
  const a = linesOf(before);
  const b = trimTrailingEmpty(linesOf(proposed));
  if (!before.trim()) return true;
  if (b.length >= Math.max(20, Math.floor(a.length * 0.55))) return true;

  // Same head + similar length → rewrite
  const aHead = a.find((l) => l.trim())?.trim() ?? "";
  const bHead = b.find((l) => l.trim())?.trim() ?? "";
  if (aHead && bHead && aHead === bHead && b.length >= a.length * 0.4) return true;
  return false;
}

/**
 * Build the file contents that should be written / diffed.
 * Prevents "delete entire file + add 9 lines" when the model returns a snippet.
 */
export function planFileEdit(before: string, proposed: string): ApplyPlan {
  const prev = norm(before);
  const next = norm(proposed);

  if (!next.trim()) {
    return { nextText: prev, mode: "full-replace", warning: "Empty proposal — nothing to apply." };
  }
  if (!prev.trim()) {
    return { nextText: next, mode: "full-replace" };
  }

  const viaSr = applySearchReplace(prev, next);
  if (viaSr != null) {
    return { nextText: viaSr, mode: "search-replace" };
  }

  if (looksLikeFullFile(prev, next)) {
    return { nextText: next, mode: "full-replace" };
  }

  const merged = mergeSnippetIntoFile(prev, next);
  if (merged != null) {
    return {
      nextText: merged,
      mode: "snippet-merge",
      warning: "Model returned a snippet — merged into the existing file (not a full rewrite).",
    };
  }

  // Refuse catastrophic wipe: keep original and surface a clear warning
  const aN = linesOf(prev).length;
  const bN = trimTrailingEmpty(linesOf(next)).length;
  if (bN < aN * 0.35) {
    return {
      nextText: prev,
      mode: "full-replace",
      warning:
        "Refused whole-file replace: model only returned a short snippet. Ask again for a SEARCH/REPLACE block or the full updated file.",
    };
  }

  return { nextText: next, mode: "full-replace" };
}
