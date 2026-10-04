/**
 * `ImageStore` on IndexedDB for the join page: image bytes and their metadata
 * in separate object stores, so listing what is kept never loads the images.
 * `AssetCache` validates what it reads back. Every failure (open blocked or
 * refused, quota on a write, an aborted transaction) rejects the call, which
 * the cache turns into its in-memory fallback; nothing here throws past that.
 */
import type { ImageStore, StoredEntry, StoredImage } from './AssetCache';

const DB_NAME = 'atlas-online-images';
const DB_VERSION = 1;
const IMAGES = 'images';
const ENTRIES = 'entries';
const OPEN_TIMEOUT_MS = 5000;

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = (): void => resolve();
    transaction.onerror = (): void => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = (): void => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = (): void => {
    const db = request.result;
    if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' });
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    };
    // A hung open (blocked, or a browser that never answers) must not hang the cache.
    const timer = window.setTimeout(() => fail(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS);
    request.onsuccess = (): void => {
      // Success after a failure was reported: nobody will use this connection.
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = (): void => fail(request.error ?? new Error('IndexedDB open failed'));
    request.onblocked = (): void => fail(new Error('IndexedDB open blocked'));
  });
}

/** Null when the browser has no IndexedDB or refuses to open it (some private windows, blocked storage). */
export async function openIndexedDbImageStore(): Promise<ImageStore | null> {
  let db: IDBDatabase;
  try {
    if (typeof indexedDB === 'undefined') return null;
    db = await openDatabase();
  } catch {
    return null;
  }
  // Another tab upgrading the database, or the browser closing it: let go, calls reject from here on.
  db.onversionchange = (): void => db.close();
  const write = async (work: (images: IDBObjectStore, entries: IDBObjectStore) => void): Promise<void> => {
    const transaction = db.transaction([IMAGES, ENTRIES], 'readwrite');
    const complete = finished(transaction);
    try {
      work(transaction.objectStore(IMAGES), transaction.objectStore(ENTRIES));
    } catch (error) {
      complete.catch(() => undefined);
      try { transaction.abort(); } catch { /* already finished */ }
      throw error;
    }
    await complete;
  };
  return {
    get: async (id: string): Promise<StoredImage | null> => {
      const value: unknown = await done(db.transaction(IMAGES, 'readonly').objectStore(IMAGES).get(id));
      return (value as StoredImage | undefined) ?? null;
    },
    put: (image: StoredImage, shownAt: number): Promise<void> => write((images, entries) => {
      images.put({ id: image.id, mime: image.mime, bytes: image.bytes });
      entries.put({ id: image.id, size: image.bytes.byteLength, shownAt });
    }),
    touch: (id: string, shownAt: number): Promise<void> => write((_images, entries) => {
      const request = entries.get(id);
      request.onsuccess = (): void => {
        const entry = request.result as StoredEntry | undefined;
        if (entry) entries.put({ ...entry, shownAt });
      };
    }),
    delete: (ids: readonly string[]): Promise<void> => write((images, entries) => {
      for (const id of ids) {
        images.delete(id);
        entries.delete(id);
      }
    }),
    entries: async (): Promise<StoredEntry[]> => {
      const values: unknown = await done(db.transaction(ENTRIES, 'readonly').objectStore(ENTRIES).getAll());
      return Array.isArray(values) ? (values as StoredEntry[]) : [];
    },
    clear: (): Promise<void> => write((images, entries) => {
      images.clear();
      entries.clear();
    }),
    close: (): void => db.close(),
  };
}
