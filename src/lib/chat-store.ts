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
  sizeBytes?: number;
  charCount?: number;
  preview?: string;
  /** PDF bytes for in-app preview (IndexedDB structured clone) */
  pdfBytes?: ArrayBuffer;
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

export function normalizeSession(raw: ChatSession): ChatSession {
  const docs =
    raw.documents?.length
      ? raw.documents
      : raw.document
        ? [{ ...raw.document, id: raw.document.id || crypto.randomUUID() }]
        : [];

  return {
    ...raw,
    documents: docs.map((d) => ({
      ...d,
      id: d.id || crypto.randomUUID(),
    })),
    document: null,
  };
}

export function getDocuments(session: ChatSession): DocumentMeta[] {
  return normalizeSession(session).documents;
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
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
  return name.replace(/\.pdf$/i, "").slice(0, 48) || "Untitled PDF";
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
    .map(
      (d, i) =>
        `=== Document ${i + 1}: ${d.name} (${d.pages} pages) ===\n${d.text}`,
    )
    .join("\n\n")
    .slice(0, 100000);
}

export function documentNames(docs: DocumentMeta[]) {
  return docs.map((d) => d.name).join(", ") || "document.pdf";
}
