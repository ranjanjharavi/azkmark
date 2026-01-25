import { createBookmark } from "./model.js";
import type { Bookmark } from "./model.js";
import { parseWebUrl } from "../shared/urls.js";

const NETSCAPE_BOOKMARK_MARKER = /^\s*<!DOCTYPE NETSCAPE-Bookmark-file-1\s*>/i;

export interface ChromeBookmarkParseResult {
  bookmarks: Bookmark[];
  skipped: number;
}

function savedAtFromAddDate(value: string | null, now: number): number {
  if (!value || !/^\d+$/.test(value)) {
    return now;
  }

  const seconds = Number(value);
  const milliseconds = seconds * 1000;
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(milliseconds)) {
    return now;
  }

  return milliseconds;
}

export function parseChromeBookmarks(html: string, now = Date.now()): ChromeBookmarkParseResult {
  if (typeof html !== "string" || !NETSCAPE_BOOKMARK_MARKER.test(html)) {
    throw new TypeError("Invalid Chrome bookmark export.");
  }

  // Template contents stay inert: imported markup is never attached to the live page.
  const template = document.createElement("template");
  template.innerHTML = html;
  if (!template.content.querySelector("dl")) {
    throw new TypeError("Invalid Chrome bookmark export.");
  }

  const bookmarks: Bookmark[] = [];
  let skipped = 0;
  const anchors = template.content.querySelectorAll<HTMLAnchorElement>("dl a[href]");

  anchors.forEach((anchor) => {
    const url = anchor.getAttribute("href");
    if (!url || !parseWebUrl(url)) {
      skipped++;
      return;
    }

    const title = anchor.textContent?.trim() || url;
    const savedAt = savedAtFromAddDate(anchor.getAttribute("add_date"), now);
    bookmarks.push(createBookmark({ url, title }, savedAt));
  });

  return { bookmarks, skipped };
}
