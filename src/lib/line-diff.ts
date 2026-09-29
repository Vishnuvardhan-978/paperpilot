export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
  oldNo?: number;
  newNo?: number;
};

/** Simple line-level LCS diff for apply preview. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i], oldNo: oldNo++, newNo: newNo++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i], oldNo: oldNo++ });
      i++;
    } else {
      out.push({ type: "add", text: b[j], newNo: newNo++ });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++], oldNo: oldNo++ });
  while (j < m) out.push({ type: "add", text: b[j++], newNo: newNo++ });
  return out;
}

export function diffStats(lines: DiffLine[]) {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    if (l.type === "del") removed++;
  }
  return { added, removed };
}
