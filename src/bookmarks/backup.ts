import { createBookmark, isBookmark } from "./model.js";
import type { Bookmark } from "./model.js";

const BACKUP_FORMAT = "azkmark";
const BACKUP_VERSION = 1;

function snapshotBookmarks(value: readonly Bookmark[]): Bookmark[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid bookmark collection.");
  }

  const records: Bookmark[] = [];
  for (let index = 0; index < value.length; index++) {
    const bookmark = value[index];
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
