import type { DocKind } from "@/lib/media";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type DocumentMeta = {
  id: string;
  name: string;
  pages: number;
  text: string;
  kind?: DocKind;
  mimeType?: string;
  sourceUrl?: string;
  sizeBytes?: number;
  charCount?: number;
  preview?: string;
  /** Binary for in-app preview (PDF/image) — IndexedDB structured clone */
  pdfBytes?: ArrayBuffer;
  fileBytes?: ArrayBuffer;
  /** True when text came from OCR rather than native extract */
  usedOcr?: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** @deprecated use documents */
  document?: DocumentMeta | null;
  documents: DocumentMeta[];
  messages: Message[];
};

const DB_NAME = "paperpilot";
const DB_VERSION = 2;
const STORE = "chats";
const ACTIVE_KEY = "paperpilot-active-chat";
const ONBOARD_KEY = "paperpilot-onboarded-v1";

export const MAX_DOCS = 3;

/** Works on HTTP LAN IPs where crypto.randomUUID is unavailable (non-secure context). */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open DB"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function normalizeDoc(d: DocumentMeta): DocumentMeta {
  const kind = d.kind || (d.sourceUrl ? "youtube" : "pdf");
  const fileBytes = d.fileBytes || d.pdfBytes;
  return {
    ...d,
    id: d.id || newId(),
    kind,
    fileBytes,
    pdfBytes: kind === "pdf" ? fileBytes || d.pdfBytes : d.pdfBytes,
  };
}

export function normalizeSession(raw: ChatSession): ChatSession {
  const docs =
    raw.documents?.length
      ? raw.documents
      : raw.document
        ? [raw.document]
        : [];

  return {
    ...raw,
    documents: docs.map(normalizeDoc),
    document: null,
  };
}

export function getDocuments(session: ChatSession): DocumentMeta[] {
  return normalizeSession(session).documents;
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    document: null,
    documents: [],
    messages: [],
  };
}

export async function listChats(): Promise<ChatSession[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const chats = await requestToPromise(store.getAll() as IDBRequest<ChatSession[]>);
  db.close();
  return chats
    .map(normalizeSession)
    .sort((a, b) => {
      const pin = Number(!!b.pinned) - Number(!!a.pinned);
      if (pin !== 0) return pin;
      return b.updatedAt - a.updatedAt;
    });
}

export async function getChat(id: string): Promise<ChatSession | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const chat = await requestToPromise(store.get(id) as IDBRequest<ChatSession | undefined>);
  db.close();
  return chat ? normalizeSession(chat) : null;
}

export async function saveChat(chat: ChatSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const normalized = normalizeSession({ ...chat, updatedAt: Date.now() });
  await requestToPromise(store.put(normalized));
  db.close();
}

export async function deleteChat(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  await requestToPromise(store.delete(id));
  db.close();

  if (getActiveChatId() === id) {
    clearActiveChatId();
  }
}

export function getActiveChatId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveChatId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function clearActiveChatId() {
  localStorage.removeItem(ACTIVE_KEY);
}

export function titleFromDocument(name: string) {
  return name
    .replace(/\.(pdf|docx?|txt|md|png|jpe?g|webp|gif)$/i, "")
    .slice(0, 48) || "Untitled";
}

export function hasSeenOnboarding() {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(ONBOARD_KEY) === "1";
}

export function markOnboardingSeen() {
  localStorage.setItem(ONBOARD_KEY, "1");
}

export function combinedDocumentText(docs: DocumentMeta[]) {
  return docs
    .map((d, i) => {
      const label =
        d.kind === "youtube"
          ? `=== Source ${i + 1}: ${d.name} (YouTube) ===\n${d.sourceUrl || ""}\n${d.text}`
          : `=== Document ${i + 1}: ${d.name} (${d.pages} page${d.pages === 1 ? "" : "s"}, ${d.kind || "pdf"}) ===\n${d.text}`;
      return label;
    })
    .join("\n\n")
    .slice(0, 100000);
}

/** Build a cross-chat corpus from every uploaded source in the library. */
export function buildLibraryCorpus(
  chats: ChatSession[],
  maxChars = 90000,
): { text: string; names: string[]; docCount: number } {
  const chunks: string[] = [];
  const names: string[] = [];
  let used = 0;
  let docCount = 0;

  for (const chat of chats) {
    const docs = getDocuments(chat);
    for (const d of docs) {
      if (!d.text?.trim() && d.kind !== "youtube") continue;
      docCount++;
      const header = `=== Library · chat "${chat.title}" · ${d.name} ===`;
      const body = (d.text || d.sourceUrl || "").slice(0, 12000);
      const piece = `${header}\n${body}`;
      if (used + piece.length > maxChars) {
        const room = maxChars - used;
        if (room > 400) {
          chunks.push(piece.slice(0, room));
          names.push(d.name);
        }
        return { text: chunks.join("\n\n"), names, docCount };
      }
      chunks.push(piece);
      names.push(d.name);
      used += piece.length + 2;
    }
  }

  return { text: chunks.join("\n\n"), names, docCount };
}

export function documentNames(docs: DocumentMeta[]) {
  return docs.map((d) => d.name).join(", ") || "document";
}

export function youtubeUrlsFromDocs(docs: DocumentMeta[]) {
  return docs
    .filter((d) => d.kind === "youtube" && d.sourceUrl)
    .map((d) => d.sourceUrl!) as string[];
}

export function docPreviewBytes(doc: DocumentMeta): ArrayBuffer | undefined {
  return doc.fileBytes || doc.pdfBytes;
}
