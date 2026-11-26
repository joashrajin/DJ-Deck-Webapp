/**
 * Browser-local IndexedDB persistence for user-imported audio files.
 * Audio stays 100% on the user's own device (never uploaded anywhere) and is
 * strictly opt-in via the "Remember on reload" preference.
 */

export interface StoredLocalTrackRecord {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  musicalKey: string;
  duration: number;
  crateIds: string[];
  favorite: boolean;
  addedAt: number;
  accentHex: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
}

const DB_NAME = 'dj_local_audio_store_v1';
const DB_VERSION = 1;
const STORE_NAME = 'local_tracks';

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function loadPersistedLocalTracks(): Promise<StoredLocalTrackRecord[]> {
  if (!isIndexedDbAvailable()) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const items = (req.result as StoredLocalTrackRecord[]) ?? [];
      items.sort((a, b) => b.addedAt - a.addedAt);
      resolve(items);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('Failed to read saved local tracks.'));
    };
  });
}

export async function savePersistedLocalTracks(
  records: StoredLocalTrackRecord[]
): Promise<void> {
  if (!isIndexedDbAvailable() || records.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const rec of records) {
      store.put(rec);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save local tracks to IndexedDB.'));
    };
  });
}

export async function updatePersistedTrackMeta(
  trackId: string,
  patch: Partial<Pick<StoredLocalTrackRecord, 'favorite' | 'crateIds'>>
): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(trackId);
    getReq.onsuccess = () => {
      const existing = getReq.result as StoredLocalTrackRecord | undefined;
      if (existing) {
        store.put({ ...existing, ...patch });
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to update saved track metadata.'));
    };
  });
}

export async function deletePersistedLocalTrack(trackId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(trackId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to delete saved local track.'));
    };
  });
}

export async function clearAllPersistedLocalTracks(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to clear saved local tracks.'));
    };
  });
}
