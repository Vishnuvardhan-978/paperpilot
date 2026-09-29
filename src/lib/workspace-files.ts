export type WorkspaceFile = {
  path: string;
  content: string;
};

const FILE_HEADER = /^--- file: (.+?) ---$/;

/** Split indexed workspace text into path → content entries. */
export function parseWorkspaceFiles(text: string): WorkspaceFile[] {
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const files: WorkspaceFile[] = [];
  let currentPath: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!currentPath) return;
    files.push({ path: currentPath, content: buf.join("\n").trimEnd() });
    currentPath = null;
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(FILE_HEADER);
    if (m) {
      flush();
      currentPath = m[1].trim();
      continue;
    }
    if (currentPath) buf.push(line);
  }
  flush();
  return files;
}

export function workspaceFilePaths(text: string): string[] {
  return parseWorkspaceFiles(text).map((f) => f.path);
}

export function getWorkspaceFile(text: string, path: string): WorkspaceFile | null {
  const target = path.replace(/\\/g, "/").toLowerCase();
  return (
    parseWorkspaceFiles(text).find((f) => f.path.replace(/\\/g, "/").toLowerCase() === target) ||
    null
  );
}

/** Prefer the focused file near the top of the corpus for better answers. */
export function prioritizeWorkspaceFile(text: string, focusPath?: string | null): string {
  if (!focusPath) return text;
  const files = parseWorkspaceFiles(text);
  if (!files.length) return text;
  const key = focusPath.replace(/\\/g, "/").toLowerCase();
  const hit = files.find((f) => f.path.replace(/\\/g, "/").toLowerCase() === key);
  if (!hit) return text;
  const rest = files.filter((f) => f !== hit);
  const ordered = [hit, ...rest];
  return ordered.map((f) => `--- file: ${f.path} ---\n${f.content}`).join("\n\n");
}

/** Replace one file body inside an indexed workspace corpus. */
export function replaceWorkspaceFileContent(
  text: string,
  filePath: string,
  nextContent: string,
): string {
  const files = parseWorkspaceFiles(text);
  if (!files.length) {
    return `--- file: ${filePath} ---\n${nextContent}`;
  }
  const key = filePath.replace(/\\/g, "/").toLowerCase();
  let found = false;
  const next = files.map((f) => {
    if (f.path.replace(/\\/g, "/").toLowerCase() === key) {
      found = true;
      return { ...f, content: nextContent };
    }
    return f;
  });
  if (!found) next.push({ path: filePath, content: nextContent });
  return next.map((f) => `--- file: ${f.path} ---\n${f.content}`).join("\n\n");
}

export type TreeNode = {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: TreeNode[];
};

/** Build a nested file tree from flat workspace paths. */
export function buildWorkspaceTree(paths: string[]): TreeNode[] {
  type Mutable = { name: string; path: string; kind: "dir" | "file"; children?: Map<string, Mutable> };
  const root = new Map<string, Mutable>();

  for (const raw of paths) {
    const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
    let level = root;
    let prefix = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      prefix = prefix ? `${prefix}/${part}` : part;
      const isFile = i === parts.length - 1;
      let node = level.get(part);
      if (!node) {
        node = {
          name: part,
          path: prefix,
          kind: isFile ? "file" : "dir",
          children: isFile ? undefined : new Map(),
        };
        level.set(part, node);
      }
      if (!isFile) {
        if (!node.children) node.children = new Map();
        level = node.children;
      }
    }
  }

  const toArray = (map: Map<string, Mutable>): TreeNode[] =>
    [...map.values()]
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({
        name: n.name,
        path: n.path,
        kind: n.kind,
        children: n.children ? toArray(n.children) : undefined,
      }));

  return toArray(root);
}
