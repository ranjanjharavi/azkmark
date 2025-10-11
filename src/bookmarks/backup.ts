import { createBookmark, isBookmark } from "./model.js";
import type { Bookmark } from "./model.js";
import { snapshotCollections } from "./collections.js";
import type { Collection } from "./collections.js";

const BACKUP_FORMAT = "azkmark";
const BACKUP_VERSION = 3;

type BackupVersion = 1 | 2 | 3;

export interface LibraryData {
  bookmarks: Bookmark[];
  collections: Collection[];
}

interface BackupEnvelope {
  version: BackupVersion;
  bookmarks: unknown;
  collections?: unknown;
}

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

function snapshotBackupBookmarks(value: unknown, version: BackupVersion): Bookmark[] {
  const bookmarks = snapshotBookmarks(value);

  if (version !== BACKUP_VERSION && bookmarks.some((bookmark) => (
    Object.hasOwn(bookmark, "collectionId")
    || Object.hasOwn(bookmark, "tags")
    || (version === 1 && Object.hasOwn(bookmark, "viewed"))
  ))) {
    throw new TypeError("Invalid bookmark collection.");
  }
  
  return bookmarks;
}

export function snapshotLibrary(
  bookmarks: readonly Bookmark[],
  collections: readonly Collection[],
): LibraryData {
  const records = snapshotBookmarks(bookmarks);
  const definitions = snapshotCollections(collections);
  const ids = new Set(definitions.map((collection) => collection.id));
  
  if (records.some((bookmark) => bookmark.collectionId !== undefined && !ids.has(bookmark.collectionId))) {
    throw new TypeError("Unknown bookmark collection.");
  }
  
  return { bookmarks: records, collections: definitions };
}

export function serializeBackup(
  bookmarks: readonly Bookmark[],
  collections: readonly Collection[] = [],
): string {
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    ...snapshotLibrary(bookmarks, collections),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export class UnsupportedBackupVersionError extends TypeError {
  constructor() {
    super("Unsupported backup version.");
    this.name = "UnsupportedBackupVersionError";
  }
}

function parseEnvelope(json: string): BackupEnvelope {
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
  const version = envelope.version;
  if (
    envelope.format !== BACKUP_FORMAT
    || !Object.hasOwn(envelope, "format")
    || !Object.hasOwn(envelope, "version")
    || !Object.hasOwn(envelope, "bookmarks")
    || !Array.isArray(envelope.bookmarks)
  ) {
    throw new TypeError("Invalid bookmark backup.");
  }

  if (version !== 1 && version !== 2 && version !== BACKUP_VERSION) {
    throw new UnsupportedBackupVersionError();
  }

  const fields = version === BACKUP_VERSION
    ? ["format", "version", "bookmarks", "collections"]
    : ["format", "version", "bookmarks"];
  if (
    Object.keys(envelope).length !== fields.length
    || fields.some((field) => !Object.hasOwn(envelope, field))
  ) {
    throw new TypeError("Invalid bookmark backup.");
  }

  return { version, bookmarks: envelope.bookmarks, collections: envelope.collections };
}

export function parseBackup(json: string): LibraryData {
  const envelope = parseEnvelope(json);
  const bookmarks = snapshotBackupBookmarks(envelope.bookmarks, envelope.version);

  const collections = envelope.version === BACKUP_VERSION
    ? snapshotCollections(envelope.collections)
    : [];
  return snapshotLibrary(bookmarks, collections);
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
