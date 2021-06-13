import { parseWebUrl } from "../urls.js";

export interface Bookmark {
  url: string;
  title: string;
  savedAt: number;
  thumbnailUrl?: string;
}

export type BookmarkDetails = Pick<Bookmark, "url" | "title"> & {
  thumbnailUrl?: string | undefined;
};

const BOOKMARK_FIELDS = new Set(["url", "title", "savedAt", "thumbnailUrl"]);

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

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
      if (!field.enumerable || !hasOwn(field, "value")) {
        return false;
      }
    }

    if (!hasOwn(fields, "url") || !hasOwn(fields, "title") || !hasOwn(fields, "savedAt")) {
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

    if (!hasOwn(fields, "thumbnailUrl")) return true;

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
  };

  if (!isBookmark(record)) {
    throw new TypeError("Invalid bookmark details or save timestamp.");
  }

  return record;
}
