import { snapshotLibrary } from "./model.js";
import type { Bookmark, LibraryData } from "./model.js";
import type { Collection } from "./collections.js";

const BACKUP_FORMAT = "azkmark";
const BACKUP_VERSION = 4;

type BackupVersion = 1 | 2 | 3 | 4;

interface BackupEnvelope {
  version: BackupVersion;
  bookmarks: unknown[];
  collections?: unknown;
}

function validateLegacyBookmarkFields(bookmarks: readonly unknown[], version: BackupVersion): void {
  if (version === BACKUP_VERSION) {
    return;
  }

  // Legacy fields must fail before the shared validator checks references
  for (const bookmark of bookmarks) {
    if (bookmark === null || typeof bookmark !== "object") {
      continue;
    }

    if (
      Object.hasOwn(bookmark, "notes") ||
      (version < 3 && (Object.hasOwn(bookmark, "collectionId") || Object.hasOwn(bookmark, "tags"))) ||
      (version === 1 && Object.hasOwn(bookmark, "viewed"))
    ) {
      throw new TypeError("Invalid bookmark collection.");
    }
  }
}

export function serializeBackup(bookmarks: readonly Bookmark[], collections: readonly Collection[] = []): string {
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    ...snapshotLibrary(bookmarks, collections)
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
    envelope.format !== BACKUP_FORMAT ||
    !Object.hasOwn(envelope, "format") ||
    !Object.hasOwn(envelope, "version") ||
    !Object.hasOwn(envelope, "bookmarks") ||
    !Array.isArray(envelope.bookmarks)
  ) {
    throw new TypeError("Invalid bookmark backup.");
  }

  if (version !== 1 && version !== 2 && version !== 3 && version !== BACKUP_VERSION) {
    throw new UnsupportedBackupVersionError();
  }

  const fields = version >= 3 ? ["format", "version", "bookmarks", "collections"] : ["format", "version", "bookmarks"];
  if (Object.keys(envelope).length !== fields.length || fields.some((field) => !Object.hasOwn(envelope, field))) {
    throw new TypeError("Invalid bookmark backup.");
  }

  return { version, bookmarks: envelope.bookmarks, collections: envelope.collections };
}

export function parseBackup(json: string): LibraryData {
  const envelope = parseEnvelope(json);
  validateLegacyBookmarkFields(envelope.bookmarks, envelope.version);

  const collections = envelope.version >= 3 ? envelope.collections : [];
  return snapshotLibrary(envelope.bookmarks, collections);
}
