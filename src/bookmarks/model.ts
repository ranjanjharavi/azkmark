import { parseWebUrl } from "../urls.js";
import { isCollectionId } from "./collections.js";

export interface Bookmark {
  url: string;
  title: string;
  savedAt: number;
  thumbnailUrl?: string;
  viewed?: boolean;
  collectionId?: string;
}

export type BookmarkDetails = Pick<Bookmark, "url" | "title"> & {
  thumbnailUrl?: string | undefined;
  viewed?: boolean | undefined;
  collectionId?: string | undefined;
};

const BOOKMARK_FIELDS = new Set(["url", "title", "savedAt", "thumbnailUrl", "viewed", "collectionId"]);

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
  };

  if (!isBookmark(record)) {
    throw new TypeError("Invalid bookmark details or save timestamp.");
  }

  return record;
}
