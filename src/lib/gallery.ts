/** Images made in the Image Studio, kept in this browser (IndexedDB: images are too big for localStorage). */

export type GalleryImage = {
  id: string;
  src: string;
  prompt: string;
  /** What the user typed, before style / enhancement. */
  idea: string;
  style: string;
  aspect: string;
  provider: string;
  seed?: number;
  favorite?: boolean;
  createdAt: number;
};

const DB = "paperpilot-gallery";
const STORE = "images";
const MAX_IMAGES = 300;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function listGallery(): Promise<GalleryImage[]> {
  const all = await run<GalleryImage[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveToGallery(images: GalleryImage[]) {
  for (const img of images) await run("readwrite", (s) => s.put(img));
  // Keep the newest; favorites are never trimmed.
  const all = await listGallery();
  const extra = all.filter((i) => !i.favorite).slice(MAX_IMAGES);
  for (const img of extra) await run("readwrite", (s) => s.delete(img.id));
}

export function updateGallery(img: GalleryImage) {
  return run("readwrite", (s) => s.put(img));
}

export function deleteFromGallery(id: string) {
  return run("readwrite", (s) => s.delete(id));
}

export function newImageId() {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
