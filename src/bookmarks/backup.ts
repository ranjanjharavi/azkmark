import { createBookmark, isBookmark } from "./model.js";
import type { Bookmark } from "./model.js";

const BACKUP_FORMAT = "azkmark";
const BACKUP_VERSION = 2;

function snapshotBookmarks(value: unknown): Bookmark[] {
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

export function serializeBackup(bookmarks: readonly Bookmark[]): string {
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    bookmarks: snapshotBookmarks(bookmarks),
  };

  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export class UnsupportedBackupVersionError extends TypeError {
  constructor() {
    super("Unsupported backup version.");
    this.name = "UnsupportedBackupVersionError";
  }
}

export function parseBackup(json: string): Bookmark[] {
  if (typeof json !== "string") {
    throw new TypeError("Invalid bookmark backup.");
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new TypeError("Invalid bookmark backup.");
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid bookmark backup.");
  }

  const envelope = value as Record<string, unknown>;
  const keys = Object.keys(envelope);
  if (
    keys.length !== 3
    || !Object.hasOwn(envelope, "format")
    || !Object.hasOwn(envelope, "version")
    || !Object.hasOwn(envelope, "bookmarks")
    || envelope.format !== BACKUP_FORMAT
  ) {
    throw new TypeError("Invalid bookmark backup.");
  }

  if (envelope.version !== 1 && envelope.version !== BACKUP_VERSION) {
    throw new UnsupportedBackupVersionError();
  }

  const bookmarks = snapshotBookmarks(envelope.bookmarks);
  if (envelope.version === 1 && bookmarks.some((bookmark) => Object.hasOwn(bookmark, "viewed"))) {
    throw new TypeError("Invalid bookmark collection.");
  }

  return bookmarks;
}

export interface BookmarkMergeResult {
  bookmarks: Bookmark[];
  added: number;
  skipped: number;
}

export function mergeBookmarks(
  existing: readonly Bookmark[],
  incoming: readonly Bookmark[],
): BookmarkMergeResult {
  const savedBookmarks = snapshotBookmarks(existing);
  const incomingBookmarks = snapshotBookmarks(incoming);
  const merged = new Map<string, Bookmark>();

  for (let index = 0; index < savedBookmarks.length; index++) {
    const bookmark = savedBookmarks[index];
    if (merged.has(bookmark.url)) {
      throw new TypeError("Duplicate existing bookmark URL.");
    }
    merged.set(bookmark.url, bookmark);
  }

  let added = 0;
  for (let index = 0; index < incomingBookmarks.length; index++) {
    const bookmark = incomingBookmarks[index];
    if (merged.has(bookmark.url)) {
      continue;
    }
    merged.set(bookmark.url, bookmark);
    added++;
  }

  return {
    bookmarks: Array.from(merged.values()),
    added,
    skipped: incomingBookmarks.length - added,
  };
}
