/** Lightweight workspace marker — paths only, content loaded via local agent. */

const HEADER = "=== Workspace direct ===";

export function encodeDirectWorkspace(opts: {
  root: string;
  name: string;
  paths: string[];
}) {
  return [
    HEADER,
    `root: ${opts.root}`,
    `name: ${opts.name}`,
    "--- paths ---",
    ...opts.paths,
  ].join("\n");
}

export function isDirectWorkspaceText(text: string | null | undefined) {
  return Boolean(text?.startsWith(HEADER));
}

export function parseDirectWorkspace(text: string): {
  root: string;
  name: string;
  paths: string[];
} | null {
  if (!isDirectWorkspaceText(text)) return null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let root = "";
  let name = "workspace";
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i] === "--- paths ---") {
      i++;
      break;
    }
    const rm = lines[i].match(/^root:\s*(.+)$/);
    if (rm) root = rm[1].trim();
    const nm = lines[i].match(/^name:\s*(.+)$/);
    if (nm) name = nm[1].trim();
  }
  const paths = lines.slice(i).map((l) => l.trim()).filter(Boolean);
  return { root, name, paths };
}

export function directWorkspaceHint(text: string) {
  const meta = parseDirectWorkspace(text);
  if (!meta) return text;
  const sample = meta.paths.slice(0, 120).join("\n");
  return `Direct workspace (Cursor-like). Root: ${meta.root}\nFiles are NOT uploaded — use local agent tools to read/search/edit.\nFile count: ${meta.paths.length}\nSample paths:\n${sample}`;
}
