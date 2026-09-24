export type DocKind = "pdf" | "image" | "text" | "docx" | "youtube";

export const ACCEPTED_FILE_TYPES =
  "application/pdf,.pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif,text/plain,.txt,.md,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

export const MAX_UPLOAD_LABEL = "10MB";

export function detectDocKind(file: { name: string; type: string }): DocKind | null {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();

  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif)$/i.test(name)
  ) {
    return "image";
  }
  if (
    type === "text/plain" ||
    type === "text/markdown" ||
    name.endsWith(".txt") ||
    name.endsWith(".md")
  ) {
    return "text";
  }
  if (
    type.includes("wordprocessingml") ||
    name.endsWith(".docx")
  ) {
    return "docx";
  }
  return null;
}

export function mimeForFile(file: { name: string; type: string }, kind: DocKind): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (kind === "pdf") return "application/pdf";
  if (kind === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (kind === "text") {
    return name.endsWith(".md") ? "text/markdown" : "text/plain";
  }
  if (kind === "image") {
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".webp")) return "image/webp";
    if (name.endsWith(".gif")) return "image/gif";
    return "image/jpeg";
  }
  return "application/octet-stream";
}

/** Normalize to a canonical watch URL, or null if not a public YouTube link. */
export function parseYouTubeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let id: string | null = null;

  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || null;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/shorts/")) {
      id = url.pathname.split("/")[2] || null;
    } else if (url.pathname.startsWith("/embed/")) {
      id = url.pathname.split("/")[2] || null;
    } else if (url.pathname.startsWith("/live/")) {
      id = url.pathname.split("/")[2] || null;
    }
  }

  if (!id || !/^[\w-]{6,}$/.test(id)) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youtubeIdFromUrl(url: string): string | null {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) return null;
  try {
    return new URL(parsed).searchParams.get("v");
  } catch {
    return null;
  }
}

export function kindLabel(kind?: DocKind): string {
  switch (kind) {
    case "image":
      return "Image";
    case "text":
      return "Text";
    case "docx":
      return "Word";
    case "youtube":
      return "YouTube";
    case "pdf":
    default:
      return "PDF";
  }
}
