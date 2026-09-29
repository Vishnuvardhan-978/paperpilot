import { inferApplyPath, stripPathComment } from "@/lib/local-agent";

export type ProposedPatch = {
  path: string;
  text: string;
  lang: string;
};

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

/** Pull applyable file patches from an assistant markdown reply. */
export function extractProposedPatches(markdown: string): ProposedPatch[] {
  const out: ProposedPatch[] = [];
  if (!markdown.trim()) return out;
  let m: RegExpExecArray | null;
  const re = new RegExp(FENCE_RE);
  while ((m = re.exec(markdown)) !== null) {
    const meta = (m[1] || "").trim();
    const body = m[2] || "";
    const lang = meta.split(/\s+/)[0] || "txt";
    if (/^diff$/i.test(lang)) continue;
    const className = meta ? `language-${meta}` : undefined;
    const path = inferApplyPath(className, body, null);
    if (!path) continue;
    const text = stripPathComment(body);
    if (!text.trim()) continue;
    out.push({ path, text, lang });
  }
  return out;
}
