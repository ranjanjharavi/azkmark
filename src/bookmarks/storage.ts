import {
  createBookmark,
  deduplicateBookmarks,
  isBookmark,
  snapshotLibrary,
  validateCollectionReferences,
} from "./model.js";
import type { Bookmark, LibraryData } from "./model.js";
import {
  collectionNameKey,
  isCollectionId,
  mergeCollections,
  normalizeCollectionName,
  snapshotCollections,
} from "./collections.js";
import type { Collection } from "./collections.js";
import { sameTags, snapshotTags } from "./tags.js";
import { parseWebUrl } from "../shared/urls.js";

const BOOKMARK_KEY_PREFIX = "azkmark:bookmark:";
export const COLLECTIONS_KEY = "azkmark:collections";
export const LAST_COLLECTION_KEY = "azkmark:last-collection";

export interface SaveBookmarkResult {
  status: "saved" | "already-saved";
  bookmark: Bookmark;
}

export type UpdateBookmarkResult =
  | { status: "updated" | "unchanged"; bookmark: Bookmark }
  | { status: "not-found" };

export interface BookmarkChanges {
  title?: string | undefined;
  // Undefined preserves the current assignment; null explicitly means Unsorted.
  collectionId?: string | null | undefined;
  // Undefined preserves the latest tags; an empty array explicitly clears them.
  tags?: readonly string[] | undefined;
}

export type UpdateBookmarkViewedResult =
  | { status: "updated"; bookmark: Bookmark }
  | { status: "not-found" };

export type DeleteBookmarkResult =
  | { status: "deleted" }
  | { status: "not-found" };

export type ImportBookmarksResult =
  | { status: "imported"; added: number; skipped: number; collectionsAdded: number }
  | { status: "failed"; added: number; skipped: number; collectionsAdded: number; error: unknown };

export type DeleteCollectionResult =
  | { status: "deleted" | "not-found"; moved: number }
  | { status: "failed"; moved: number; error: unknown };

export class MissingCollectionError extends Error {
  constructor() {
    super("This collection is no longer available. Choose another collection or Unsorted.");
    this.name = "MissingCollectionError";
  }
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

function rethrowStorageError(cause: unknown): never {
  if (!(cause instanceof Error) || !cause.message) {
    throw new Error("Chrome storage operation failed.");
  }

  if (/quota/i.test(cause.message)) {
    throw new StorageQuotaError(cause.message);
  }
  throw cause;
}

function readStorage(keys: string | null): Promise<Record<string, unknown>> {
  return chrome.storage.local.get(keys).catch(rethrowStorageError);
}

function writeStorage(items: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(items).catch(rethrowStorageError);
}

function removeStorage(key: string): Promise<void> {
  return chrome.storage.local.remove(key).catch(rethrowStorageError);
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
    value = Object.create(Object.getPrototypeOf(value), fields);
  }

  if (!isBookmark(value) || key !== BOOKMARK_KEY_PREFIX + value.url) {
    throw new InvalidStoredBookmarkError();
  }

  return createBookmark(value, value.savedAt);
}

async function readStoredBookmark(key: string): Promise<Bookmark | undefined> {
  const values = await readStorage(key);
  if (!Object.hasOwn(values, key)) {
    return undefined;
  }

  const bookmark = storedBookmark(key, values[key]);
  if (bookmark.collectionId !== undefined) {
    // Callers hold the URL lock, definition reads must not acquire another lock
    const collections = await readCollections();

    if (!collections.some((collection) => collection.id === bookmark.collectionId)) {
      throw new InvalidStoredBookmarkError();
    }
  }

  return bookmark;
}

function storedCollections(value: unknown): Collection[] {
  try {
    return snapshotCollections(value);
  } catch {
    throw new InvalidStoredBookmarkError();
  }
}

export async function readCollections(): Promise<Collection[]> {
  const values = await readStorage(COLLECTIONS_KEY);
  return Object.hasOwn(values, COLLECTIONS_KEY) ? storedCollections(values[COLLECTIONS_KEY]) : [];
}

export async function readLastCollection(): Promise<string> {
  const values = await readStorage(LAST_COLLECTION_KEY);
  const id = values[LAST_COLLECTION_KEY];
  return isCollectionId(id) ? id : "";
}

export async function readLibrary(): Promise<LibraryData> {
  // Read definitions and members together, including valid partial collection moves.
  const values = await readStorage(null);
  const collections = Object.hasOwn(values, COLLECTIONS_KEY) ? storedCollections(values[COLLECTIONS_KEY]) : [];
  const bookmarks: Bookmark[] = [];
  for (const key of Object.keys(values)) {
    if (key.startsWith(BOOKMARK_KEY_PREFIX)) {
      bookmarks.push(storedBookmark(key, values[key]));
    }
  }

  try {
    validateCollectionReferences(bookmarks, collections);
    return { bookmarks, collections };
  } catch {
    throw new InvalidStoredBookmarkError();
  }
}

export function watchBookmarks(onChange: () => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (Object.keys(changes).some((key) => key.startsWith(BOOKMARK_KEY_PREFIX) || key === COLLECTIONS_KEY)) {
      onChange();
    }
  });
}

async function requireCollection(id: string | undefined): Promise<void> {
  if (id === undefined) {
    return;
  }

  const collections = await readCollections();
  if (!collections.some((collection) => collection.id === id)) {
    throw new MissingCollectionError();
  }
}

export async function updateBookmark(
  url: string,
  { title, collectionId, tags }: BookmarkChanges = {},
): Promise<UpdateBookmarkResult> {
  const key = bookmarkKey(url);
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    throw new TypeError("Enter a bookmark title.");
  }
  if (collectionId !== undefined && collectionId !== null && !isCollectionId(collectionId)) {
    throw new TypeError("Invalid collection ID.");
  }

  const submittedTitle = title?.trim();
  const submittedTags = tags === undefined ? undefined : snapshotTags(tags);
  const edit = () => navigator.locks.request(key, async (): Promise<UpdateBookmarkResult> => {
    const existing = await readStoredBookmark(key);
    if (!existing) {
      return { status: "not-found" };
    }

    // Untouched fields come from the fresh locked record, never editor snapshots.
    const nextTitle = submittedTitle ?? existing.title;
    let nextCollectionId = existing.collectionId;
    if (collectionId !== undefined) {
      nextCollectionId = collectionId ?? undefined;
    }

    let nextTags = existing.tags;
    if (submittedTags !== undefined) {
      nextTags = submittedTags.length > 0 ? submittedTags : undefined;
    }

    if (
      nextTitle === existing.title
      && nextCollectionId === existing.collectionId
      && sameTags(nextTags, existing.tags)
    ) {
      return { status: "unchanged", bookmark: existing };
    }

    if (collectionId !== undefined) {
      await requireCollection(nextCollectionId);
    }

    const updated = createBookmark({
      ...existing,
      title: nextTitle,
      collectionId: nextCollectionId,
      tags: nextTags,
    }, existing.savedAt);
    await writeStorage({ [key]: updated });
    return { status: "updated", bookmark: updated };
  });

  // Membership writes always acquire the collection lock before the URL lock.
  return collectionId === undefined ? edit() : navigator.locks.request(COLLECTIONS_KEY, edit);
}

export async function updateBookmarkViewed(
  url: string,
  viewed: boolean,
): Promise<UpdateBookmarkViewedResult> {
  const key = bookmarkKey(url);
  if (typeof viewed !== "boolean") {
    throw new TypeError("Invalid bookmark view status.");
  }

  return navigator.locks.request(key, async (): Promise<UpdateBookmarkViewedResult> => {
    const existing = await readStoredBookmark(key);
    if (!existing) {
      return { status: "not-found" };
    }

    if (Boolean(existing.viewed) === viewed) {
      return { status: "updated", bookmark: existing };
    }

    const updated = createBookmark({ ...existing, viewed }, existing.savedAt);
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

export async function saveBookmark(bookmark: Bookmark, rememberCollection = false): Promise<SaveBookmarkResult> {
  if (!isBookmark(bookmark)) {
    throw new TypeError("Invalid bookmark record.");
  }

  // Snapshot before waiting so caller changes cannot alter the key or record
  const record = createBookmark(bookmark, bookmark.savedAt);
  const save = () => saveRecord(record, rememberCollection);
  return record.collectionId === undefined ? save() : navigator.locks.request(COLLECTIONS_KEY, save);
}

function saveRecord(record: Bookmark, rememberCollection: boolean): Promise<SaveBookmarkResult> {
  const key = bookmarkKey(record.url);
  return navigator.locks.request(key, async (): Promise<SaveBookmarkResult> => {
    const existing = await readStoredBookmark(key);
    if (existing) {
      return { status: "already-saved", bookmark: existing };
    }

    await requireCollection(record.collectionId);
    const items: Record<string, unknown> = { [key]: record };
    if (rememberCollection) {
      items[LAST_COLLECTION_KEY] = record.collectionId ?? "";
    }
    await writeStorage(items);
    return { status: "saved", bookmark: record };
  });
}

export async function importBookmarkRecords(
  bookmarks: readonly Bookmark[],
  collections: readonly Collection[] = [],
): Promise<ImportBookmarksResult> {
  // Validate and snapshot the complete file before any storage access, including
  // references on duplicate records that will lose and empty collections
  const snapshot = snapshotLibrary(bookmarks, collections);
  const incoming = deduplicateBookmarks(snapshot.bookmarks);
  let added = 0;
  let skipped = incoming.skipped;
  let collectionsAdded = 0;

  async function importRecords(): Promise<ImportBookmarksResult> {
    // Reject an already-corrupt library, including unrelated managed records
    const current = await readLibrary();
    const definitions = mergeCollections(current.collections, snapshot.collections, () => crypto.randomUUID());
    const records = incoming.bookmarks.map((bookmark) => {
      if (bookmark.collectionId === undefined) {
        return bookmark;
      }

      const collectionId = definitions.mapping.get(bookmark.collectionId);
      if (collectionId === undefined) {
        throw new TypeError("Unknown bookmark collection.");
      }

      return createBookmark({ ...bookmark, collectionId }, bookmark.savedAt);
    });

    // Finish mapping before writing, preserve definitions even when every URL
    // already exists. Repeated imports need no definition write if names match
    if (definitions.added > 0) {
      await writeStorage({ [COLLECTIONS_KEY]: definitions.collections });
      collectionsAdded = definitions.added;
    }

    for (const record of records) {
      // The collection lock is already held when this file has definitions.
      // Acquire only the URL lock, and recheck duplicates against its fresh data
      const result = await saveRecord(record, false);
      if (result.status === "saved") {
        added++;
      } else {
        skipped++;
      }
    }
    return { status: "imported", added, skipped, collectionsAdded };
  }

  try {
    if (snapshot.collections.length > 0) {
      return await navigator.locks.request(COLLECTIONS_KEY, importRecords);
    }

    return await importRecords();
  } catch (error) {
    // Definitions precede members, so partial progress is valid and retryable.
    // Only acknowledged writes count, a retry checks storage again under locks
    return { status: "failed", added, skipped, collectionsAdded, error };
  }
}

export async function saveCollection(name: string, id?: string): Promise<Collection> {
  if (typeof name !== "string") {
    throw new TypeError("Enter a collection name of 1–100 characters.");
  }

  const normalized = normalizeCollectionName(name);
  if (!normalized || normalized.length > 100) {
    throw new TypeError("Enter a collection name of 1–100 characters.");
  }

  if (id !== undefined && !isCollectionId(id)) {
    throw new TypeError("Invalid collection ID.");
  }

  return navigator.locks.request(COLLECTIONS_KEY, async (): Promise<Collection> => {
    const collections = await readCollections();
    const current = id === undefined ? undefined : collections.find((collection) => collection.id === id);
    if (id !== undefined && !current) {
      throw new MissingCollectionError();
    }

    const nameKey = collectionNameKey(normalized);
    if (collections.some((collection) => collection.id !== id && collectionNameKey(collection.name) === nameKey)) {
      throw new TypeError("A collection with this name already exists.");
    }

    if (current?.name === normalized) {
      return current;
    }

    let collectionId = id ?? crypto.randomUUID();
    if (id === undefined) {
      while (collections.some((collection) => collection.id === collectionId)) {
        collectionId = crypto.randomUUID();
      }
    }

    const collection = { id: collectionId, name: normalized };
    const next = collections.map((item) => item.id === collectionId ? collection : item);
    if (!current) {
      next.push(collection);
    }

    await writeStorage({ [COLLECTIONS_KEY]: next });
    return collection;
  });
}

export async function deleteCollection(id: string): Promise<DeleteCollectionResult> {
  if (!isCollectionId(id)) {
    throw new TypeError("Invalid collection ID.");
  }

  return navigator.locks.request(COLLECTIONS_KEY, async (): Promise<DeleteCollectionResult> => {
    let moved = 0;
    try {
      const { bookmarks, collections } = await readLibrary();
      if (!collections.some((collection) => collection.id === id)) {
        return { status: "not-found", moved };
      }

      for (const bookmark of bookmarks) {
        if (bookmark.collectionId !== id) {
          continue;
        }

        const key = bookmarkKey(bookmark.url);
        const changed = await navigator.locks.request(key, async (): Promise<boolean> => {
          const current = await readStoredBookmark(key);

          if (!current || current.collectionId !== id) {
            return false;
          }

          const record = createBookmark({ ...current, collectionId: undefined }, current.savedAt);
          await writeStorage({ [key]: record });
          return true;
        });

        if (changed) {
          moved++;
        }
      }

      // Cross-key writes are not transactional. Keep the definition until all
      // members are confirmed Unsorted, a failed move remains valid and retryable.
      const remaining = collections.filter((collection) => collection.id !== id);
      await writeStorage({ [COLLECTIONS_KEY]: remaining });
      return { status: "deleted", moved };
    } catch (error) {
      return { status: "failed", moved, error };
    }
  });
}
