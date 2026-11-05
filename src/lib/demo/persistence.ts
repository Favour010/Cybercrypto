/**
 * Browser persistence for the demo data layer: IndexedDB (no 5 MB limit),
 * one record for the state and one store for uploaded attachment files.
 * Falls back to memory when IndexedDB is unavailable (e.g. private windows).
 */
import { migrateState } from "./migrate";
import type { DemoState } from "./types";

const DB_NAME = "jobsync-demo";
const STATE_STORE = "state";
const FILE_STORE = "files";
const STATE_KEY = "current";

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryFiles = new Map<string, Blob>();

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
        t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction aborted"));
      }),
  );
}

export type PersistenceKind = "indexeddb" | "memory";

export async function probePersistence(): Promise<PersistenceKind> {
  try {
    await openDb();
    return "indexeddb";
  } catch {
    return "memory";
  }
}

export async function loadState(): Promise<DemoState | null> {
  try {
    const s = (await tx<unknown>(STATE_STORE, "readonly", (st) => st.get(STATE_KEY))) ?? null;
    return migrateState(s);
  } catch {
    return null;
  }
}

export async function saveState(state: DemoState): Promise<boolean> {
  try {
    await tx(STATE_STORE, "readwrite", (st) => st.put(state, STATE_KEY));
    return true;
  } catch {
    return false;
  }
}

export async function putFile(key: string, blob: Blob): Promise<void> {
  try {
    await tx(FILE_STORE, "readwrite", (st) => st.put(blob, key));
  } catch {
    memoryFiles.set(key, blob);
  }
}

export async function getFile(key: string): Promise<Blob | null> {
  if (memoryFiles.has(key)) return memoryFiles.get(key)!;
  try {
    return ((await tx<Blob>(FILE_STORE, "readonly", (st) => st.get(key))) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function deleteFiles(keys: string[]): Promise<void> {
  for (const k of keys) memoryFiles.delete(k);
  if (keys.length === 0) return;
  try {
    await tx(FILE_STORE, "readwrite", (st) => {
      for (const k of keys) st.delete(k);
    });
  } catch {
    // Nothing persisted to remove.
  }
}

export async function clearAll(): Promise<void> {
  memoryFiles.clear();
  try {
    await tx(STATE_STORE, "readwrite", (st) => st.clear());
    await tx(FILE_STORE, "readwrite", (st) => st.clear());
  } catch {
    // Memory-only session: nothing stored.
  }
}
