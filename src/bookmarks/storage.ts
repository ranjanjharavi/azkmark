import { createBookmark, isBookmark } from "./model.js";
import type { Bookmark } from "./model.js";
import { parseWebUrl } from "../urls.js";

const BOOKMARK_KEY_PREFIX = "azkmark:bookmark:";

export interface SaveBookmarkResult {
  status: "saved" | "already-saved";
  bookmark: Bookmark;
}

export class InvalidStoredBookmarkError extends TypeError {
  constructor() {
    super("Invalid stored bookmark.");
    this.name = "InvalidStoredBookmarkError";
  }
}

export class StorageQuotaError extends Error {
  constructor(message = "Bookmark storage quota exceeded.") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function storageError(message?: string): Error {
  const description = message || "Chrome storage operation failed.";
  return /quota/i.test(description) ? new StorageQuotaError(description) : new Error(description);
}

function readStorage(keys: string | null): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(storageError(error.message));
        return;
      }

      resolve(items);
    });
  });
}

function writeStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(storageError(error.message));
        return;
      }

      resolve();
    });
  });
}

function bookmarkKey(url: string): string {
  if (!parseWebUrl(url)) {
    throw new TypeError("Unsupported bookmark URL.");
  }

  return BOOKMARK_KEY_PREFIX + url;
}

function storedBookmark(key: string, value: unknown): Bookmark {
  if (!isBookmark(value) || key !== BOOKMARK_KEY_PREFIX + value.url) {
    throw new InvalidStoredBookmarkError();
  }

  return value;
}

async function readStoredBookmark(key: string): Promise<Bookmark | undefined> {
  const values = await readStorage(key);
  if (!hasOwn(values, key)) {
    return undefined;
  }

  return storedBookmark(key, values[key]);
}

export async function readBookmarks(): Promise<Bookmark[]> {
  const values = await readStorage(null);
  const bookmarks: Bookmark[] = [];

  for (const key of Object.keys(values)) {
    if (!key.startsWith(BOOKMARK_KEY_PREFIX)) {
      continue;
    }

    bookmarks.push(storedBookmark(key, values[key]));
  }

  return bookmarks;
}

export async function saveBookmark(bookmark: Bookmark): Promise<SaveBookmarkResult> {
  if (!isBookmark(bookmark)) {
    throw new TypeError("Invalid bookmark record.");
  }

  // Snapshot before waiting so caller changes cannot alter the key or record
  const record = createBookmark(bookmark, bookmark.savedAt);
  const key = bookmarkKey(record.url);

  return navigator.locks.request(key, async (): Promise<SaveBookmarkResult> => {
    const existing = await readStoredBookmark(key);
    if (existing) {
      return { status: "already-saved", bookmark: existing };
    }

    await writeStorage({ [key]: record });
    return { status: "saved", bookmark: record };
  });
}
