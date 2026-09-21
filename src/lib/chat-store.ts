export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type DocumentMeta = {
  name: string;
  pages: number;
  text: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  document: DocumentMeta | null;
  messages: Message[];
};

const DB_NAME = "paperpilot";
const DB_VERSION = 1;
const STORE = "chats";
const ACTIVE_KEY = "paperpilot-active-chat";

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

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    document: null,
    messages: [],
  };
}

export async function listChats(): Promise<ChatSession[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const chats = await requestToPromise(store.getAll() as IDBRequest<ChatSession[]>);
  db.close();
  return chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string): Promise<ChatSession | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const chat = await requestToPromise(store.get(id) as IDBRequest<ChatSession | undefined>);
  db.close();
  return chat ?? null;
}

export async function saveChat(chat: ChatSession): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  await requestToPromise(store.put({ ...chat, updatedAt: Date.now() }));
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
