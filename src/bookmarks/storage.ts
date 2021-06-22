import { createBookmark, isBookmark } from "./model.js";
import type { Bookmark } from "./model.js";
import { mergeBookmarks } from "./backup.js";
import { parseWebUrl } from "../urls.js";

const BOOKMARK_KEY_PREFIX = "azkmark:bookmark:";

export interface SaveBookmarkResult {
  status: "saved" | "already-saved";
  bookmark: Bookmark;
}

export type UpdateBookmarkTitleResult =
  | { status: "updated"; bookmark: Bookmark }
  | { status: "not-found" };

export type DeleteBookmarkResult =
  | { status: "deleted" }
  | { status: "not-found" };

export type ImportBookmarksResult =
  | { status: "imported"; added: number; skipped: number }
  | { status: "failed"; added: number; skipped: number; error: unknown };

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

function removeStorage(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
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
  // Read the current fields without rewriting the data or invoking property getters.
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const fields = Object.getOwnPropertyDescriptors(value);
    delete fields.tags;
    delete fields.viewed;
    value = Object.create(Object.getPrototypeOf(value), fields);
  }

  if (!isBookmark(value) || key !== BOOKMARK_KEY_PREFIX + value.url) {
    throw new InvalidStoredBookmarkError();
  }

  return createBookmark(value, value.savedAt);
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

export function watchBookmarks(onChange: () => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (Object.keys(changes).some((key) => key.startsWith(BOOKMARK_KEY_PREFIX))) {
      onChange();
    }
  });
}

export async function updateBookmarkTitle(
  url: string,
  title: string,
): Promise<UpdateBookmarkTitleResult> {
  const key = bookmarkKey(url);
  if (typeof title !== "string" || !title.trim()) {
    throw new TypeError("Enter a bookmark title.");
  }

  const nextTitle = title.trim();
  return navigator.locks.request(key, async (): Promise<UpdateBookmarkTitleResult> => {
    const existing = await readStoredBookmark(key);
    if (!existing) {
      return { status: "not-found" };
    }

    const updated = createBookmark({ ...existing, title: nextTitle }, existing.savedAt);
    await writeStorage({ [key]: updated });
    return { status: "updated", bookmark: updated };
  });
}

export async function deleteBookmark(url: string): Promise<DeleteBookmarkResult> {
  const key = bookmarkKey(url);
  return navigator.locks.request(key, async (): Promise<DeleteBookmarkResult> => {
    const existing = await readStoredBookmark(key);
    if (!existing) {
      return { status: "not-found" };
    }

    await removeStorage(key);
    return { status: "deleted" };
  });
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

export async function importBookmarkRecords(
  bookmarks: readonly Bookmark[],
): Promise<ImportBookmarksResult> {
  // Validate and de-duplicate the complete input before the first storage call.
  const incoming = mergeBookmarks([], bookmarks);
  let added = 0;
  let skipped = incoming.skipped;

  try {
    // Fail closed if any existing managed record is corrupt before importing.
    await readBookmarks();

    for (let index = 0; index < incoming.bookmarks.length; index++) {
      const result = await saveBookmark(incoming.bookmarks[index]);
      if (result.status === "saved") {
        added++;
      } else {
        skipped++;
      }
    }

    return { status: "imported", added, skipped };
  } catch (error) {
    // Per-record locks keep unrelated saves safe; later imports can retry partial progress.
    return { status: "failed", added, skipped, error };
  }
}
