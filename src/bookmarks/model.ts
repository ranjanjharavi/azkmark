import { parseWebUrl } from "../urls.js";
import { isCollectionId, snapshotCollections } from "./collections.js";
import type { Collection } from "./collections.js";
import { isTags, snapshotTags } from "./tags.js";

export interface Bookmark {
  url: string;
  title: string;
  savedAt: number;
  thumbnailUrl?: string;
  viewed?: boolean;
  collectionId?: string;
  tags?: string[];
}

export interface LibraryData {
  bookmarks: Bookmark[];
  collections: Collection[];
}

export type BookmarkDetails = Pick<Bookmark, "url" | "title"> & {
  thumbnailUrl?: string | undefined;
  viewed?: boolean | undefined;
  collectionId?: string | undefined;
  tags?: readonly string[] | undefined;
};

const BOOKMARK_FIELDS = new Set([
  "url", "title", "savedAt", "thumbnailUrl", "viewed", "collectionId", "tags",
]);

export function isBookmark(value: unknown): value is Bookmark {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }

    const fields = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(fields)) {
      if (typeof key !== "string" || !BOOKMARK_FIELDS.has(key)) {
        return false;
      }

      const field = fields[key];
      if (!field.enumerable || !Object.hasOwn(field, "value")) {
        return false;
      }
    }

    if (
      !Object.hasOwn(fields, "url")
      || !Object.hasOwn(fields, "title")
      || !Object.hasOwn(fields, "savedAt")
    ) {
      return false;
    }

    const url: unknown = fields["url"].value;
    const title: unknown = fields["title"].value;
    const savedAt: unknown = fields["savedAt"].value;

    if (!parseWebUrl(url) || typeof title !== "string" || !title.trim()) {
      return false;
    }

    if (typeof savedAt !== "number" || !Number.isSafeInteger(savedAt) || savedAt < 0) {
      return false;
    }

    if (Object.hasOwn(fields, "viewed") && typeof fields["viewed"].value !== "boolean") {
      return false;
    }

    if (Object.hasOwn(fields, "collectionId") && !isCollectionId(fields["collectionId"].value)) {
      return false;
    }

    if (Object.hasOwn(fields, "tags") && !isTags(fields["tags"].value)) {
      return false;
    }

    if (!Object.hasOwn(fields, "thumbnailUrl")) return true;

    const thumbnail = parseWebUrl(fields["thumbnailUrl"].value);
    return Boolean(thumbnail && !thumbnail.username && !thumbnail.password);
  } catch {
    return false;
  }
}

export function createBookmark(details: BookmarkDetails, savedAt = Date.now()): Bookmark {
  const record = {
    url: details?.url,
    title: details?.title,
    savedAt,
    ...(details?.thumbnailUrl === undefined ? {} : { thumbnailUrl: details.thumbnailUrl }),
    ...(details?.viewed === undefined ? {} : { viewed: details.viewed }),
    ...(details?.collectionId === undefined ? {} : { collectionId: details.collectionId }),
    ...(details?.tags === undefined ? {} : { tags: snapshotTags(details.tags) }),
  };

  if (!isBookmark(record)) {
    throw new TypeError("Invalid bookmark details or save timestamp.");
  }

  return record;
}

export function snapshotBookmarks(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid bookmark collection.");
  }

  const records: Bookmark[] = [];
  for (let index = 0; index < value.length; index++) {
    const bookmark: unknown = value[index];
    if (!isBookmark(bookmark)) {
      throw new TypeError("Invalid bookmark collection.");
    }

    records.push(createBookmark(bookmark, bookmark.savedAt));
  }

  return records;
}

// Reference-only check for data already validated by the snapshot paths
export function validateCollectionReferences(
  bookmarks: readonly Bookmark[],
  collections: readonly Collection[],
): void {
  const ids = new Set(collections.map((collection) => collection.id));

  if (bookmarks.some((bookmark) => bookmark.collectionId !== undefined && !ids.has(bookmark.collectionId))) {
    throw new TypeError("Unknown bookmark collection.");
  }
}

export function snapshotLibrary(
  bookmarks: unknown,
  collections: unknown,
): LibraryData {
  const records = snapshotBookmarks(bookmarks);
  const definitions = snapshotCollections(collections);
  validateCollectionReferences(records, definitions);
  return { bookmarks: records, collections: definitions };
}

interface BookmarkDeduplicationResult {
  bookmarks: Bookmark[];
  skipped: number;
}

export function deduplicateBookmarks(incoming: readonly Bookmark[]): BookmarkDeduplicationResult {
  const records = snapshotBookmarks(incoming);
  const byUrl = new Map<string, Bookmark>();

  for (const bookmark of records) {
    if (byUrl.has(bookmark.url)) {
      continue;
    }
    
    byUrl.set(bookmark.url, bookmark);
  }

  return {
    bookmarks: Array.from(byUrl.values()),
    skipped: records.length - byUrl.size,
  };
}
