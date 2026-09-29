type FileSystemFileHandleLike = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
};

type FileSystemDirectoryHandleLike = {
  kind: "directory";
  name: string;
  values?: () => AsyncIterable<FileSystemEntryLike>;
  entries?: () => AsyncIterable<[string, FileSystemEntryLike]>;
};

type FileSystemEntryLike = FileSystemFileHandleLike | FileSystemDirectoryHandleLike;

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
};

export type WorkspaceSource = {
  name: string;
  text: string;
  fileCount: number;
  byteCount: number;
  skippedCount: number;
};

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
]);

const CODE_EXTENSIONS = new Set([
  ".css",
  ".env",
  ".go",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".scss",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".yaml",
  ".yml",
]);

const CODE_FILENAMES = new Set([
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "LICENSE",
  "Makefile",
  "README",
]);

const MAX_FILES = 90;
const MAX_TOTAL_CHARS = 100_000;
const MAX_FILE_BYTES = 220_000;
const MAX_DEPTH = 7;

function extensionOf(name: string) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function shouldReadFile(name: string) {
  if (CODE_FILENAMES.has(name)) return true;
  if (/\.(lock|map|min\.js)$/i.test(name)) return false;
  return CODE_EXTENSIONS.has(extensionOf(name));
}

function pathParts(relativePath: string) {
  return relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function shouldSkipPath(relativePath: string) {
  const parts = pathParts(relativePath);
  if (parts.length - 1 > MAX_DEPTH) return true;
  return parts.slice(0, -1).some(
    (part) => IGNORE_DIRS.has(part) || (part.startsWith(".") && part !== ".env.example"),
  );
}

async function directoryEntries(dir: FileSystemDirectoryHandleLike) {
  const out: FileSystemEntryLike[] = [];
  if (dir.values) {
    for await (const entry of dir.values()) out.push(entry);
  } else if (dir.entries) {
    for await (const [, entry] of dir.entries()) out.push(entry);
  }
  return out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function buildFromFiles(
  files: File[],
  fallbackName = "Workspace",
): Promise<WorkspaceSource> {
  const chunks: string[] = [];
  let usedChars = 0;
  let fileCount = 0;
  let byteCount = 0;
  let skippedCount = 0;
  let rootName = fallbackName;

  const sorted = [...files].sort((a, b) => {
    const ap = (a.webkitRelativePath || a.name).toLowerCase();
    const bp = (b.webkitRelativePath || b.name).toLowerCase();
    return ap.localeCompare(bp);
  });

  for (const file of sorted) {
    if (fileCount >= MAX_FILES || usedChars >= MAX_TOTAL_CHARS) {
      skippedCount++;
      continue;
    }

    const relative = file.webkitRelativePath || file.name;
    const parts = pathParts(relative);
    if (parts.length > 1) rootName = parts[0];

    if (shouldSkipPath(relative)) {
      skippedCount++;
      continue;
    }

    const baseName = parts[parts.length - 1] || file.name;
    if (!shouldReadFile(baseName)) {
      skippedCount++;
      continue;
    }

    if (file.size > MAX_FILE_BYTES) {
      skippedCount++;
      continue;
    }

    const text = await file.text();
    if (!text.trim()) continue;

    const displayPath = parts.length > 1 ? parts.slice(1).join("/") : baseName;
    const room = MAX_TOTAL_CHARS - usedChars;
    const body = text.slice(0, Math.max(0, room - displayPath.length - 40));
    if (!body.trim()) break;

    chunks.push(`--- file: ${displayPath} ---\n${body}`);
    usedChars += body.length + displayPath.length + 18;
    byteCount += file.size;
    fileCount++;
  }

  if (!fileCount) {
    throw new Error("No readable code/text files found in that folder.");
  }

  return {
    name: rootName || "Workspace",
    text: chunks.join("\n\n"),
    fileCount,
    byteCount,
    skippedCount,
  };
}

/** True when File System Access API works (Chrome/Edge on localhost or HTTPS). */
export function canUseDirectoryPicker() {
  if (typeof window === "undefined") return false;
  // showDirectoryPicker exists in Chrome but is blocked / missing on LAN HTTP
  if (!window.isSecureContext) return false;
  return typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === "function";
}

/** Build workspace corpus from a folder selected via <input webkitdirectory>. */
export async function workspaceFromFileList(list: FileList | File[]): Promise<WorkspaceSource> {
  const files = Array.from(list);
  if (!files.length) throw new Error("No files selected.");
  return buildFromFiles(files);
}

export async function pickWorkspaceSource(): Promise<WorkspaceSource> {
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) {
    throw new Error("NEEDS_FOLDER_INPUT");
  }

  let root: FileSystemDirectoryHandleLike;
  try {
    root = await picker();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("CANCELLED");
    }
    throw e;
  }

  const chunks: string[] = [];
  let usedChars = 0;
  let fileCount = 0;
  let byteCount = 0;
  let skippedCount = 0;

  async function walk(dir: FileSystemDirectoryHandleLike, prefix: string, depth: number) {
    if (depth > MAX_DEPTH || fileCount >= MAX_FILES || usedChars >= MAX_TOTAL_CHARS) return;

    for (const entry of await directoryEntries(dir)) {
      if (fileCount >= MAX_FILES || usedChars >= MAX_TOTAL_CHARS) return;

      if (entry.kind === "directory") {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          skippedCount++;
          continue;
        }
        await walk(entry, `${prefix}${entry.name}/`, depth + 1);
        continue;
      }

      const path = `${prefix}${entry.name}`;
      if (!shouldReadFile(entry.name)) {
        skippedCount++;
        continue;
      }

      const file = await entry.getFile();
      if (file.size > MAX_FILE_BYTES) {
        skippedCount++;
        continue;
      }

      const text = await file.text();
      if (!text.trim()) continue;

      const room = MAX_TOTAL_CHARS - usedChars;
      const body = text.slice(0, Math.max(0, room - path.length - 40));
      if (!body.trim()) return;

      chunks.push(`--- file: ${path} ---\n${body}`);
      usedChars += body.length + path.length + 18;
      byteCount += file.size;
      fileCount++;
    }
  }

  await walk(root, "", 0);

  if (!fileCount) {
    throw new Error("No readable code/text files found in that folder.");
  }

  return {
    name: root.name || "Workspace",
    text: chunks.join("\n\n"),
    fileCount,
    byteCount,
    skippedCount,
  };
}
