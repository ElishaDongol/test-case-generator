"use client";

/**
 * IndexedDB-backed storage for screen images.
 * Stores full base64 images per screen ID, separate from localStorage
 * to avoid the ~5 MB localStorage size limit.
 */

const DB_NAME = "testcraft_images";
const DB_VERSION = 1;
const STORE_NAME = "screen_images";

export interface StoredImage {
  base64: string;
  mediaType: string;
  preview: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save images for a screen */
export async function saveScreenImages(screenId: string, images: StoredImage[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(images, screenId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load images for a screen */
export async function loadScreenImages(screenId: string): Promise<StoredImage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(screenId);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

/** Delete images for a screen */
export async function deleteScreenImages(screenId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(screenId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
