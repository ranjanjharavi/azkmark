import type { Bookmark } from "../bookmarks/model.js";
import type { Collection } from "../bookmarks/collections.js";
import { bookmarkDomain } from "../bookmarks/domains.js";
import { bookmarkActions } from "./bookmark-actions.js";
import { bookmarkPreview } from "./bookmark-preview.js";
import { formatSavedDate } from "./saved-date.js";

function appendMetadata(list: HTMLDListElement, label: string, value: string | HTMLElement): void {
  const term = document.createElement("dt");
  term.textContent = label;

  const description = document.createElement("dd");
  if (typeof value === "string") {
    description.textContent = value;
  } else {
    description.appendChild(value);
  }

  list.appendChild(term);
  list.appendChild(description);
}

export function bookmarkDetails(
  bookmark: Bookmark,
  collections: readonly Collection[],
  savingViewStatus = false,
): HTMLDivElement {
  const details = document.createElement("div");
  details.className = "bookmark-detail-content";

  const header = document.createElement("header");
  header.className = "bookmark-detail-head";
  const domain = document.createElement("p");
  domain.className = "bookmark-domain";
  domain.textContent = bookmarkDomain(bookmark.url);
  header.appendChild(domain);

  const savedDate = formatSavedDate(bookmark.savedAt);
  const saved = document.createElement(savedDate.dateTime ? "time" : "span");
  saved.className = "bookmark-saved-date";
  saved.textContent = savedDate.full;
  if (savedDate.dateTime) {
    saved.setAttribute("datetime", savedDate.dateTime);
    saved.textContent = new Date(bookmark.savedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  header.appendChild(saved);
  details.appendChild(header);
  details.appendChild(bookmarkPreview(bookmark.url, bookmark.thumbnailUrl));

  const title = document.createElement("h2");
  title.className = "bookmark-detail-title";
  title.textContent = bookmark.title;
  details.appendChild(title);

  const url = document.createElement("p");
  url.className = "bookmark-url";
  url.textContent = bookmark.url;
  details.appendChild(url);

  const link = document.createElement("a");
  link.className = "bookmark-open";
  link.href = bookmark.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("data-bookmark-url", bookmark.url);
  link.textContent = "Open page ↗";
  details.appendChild(link);

  const metadata = document.createElement("dl");
  metadata.className = "bookmark-detail-metadata";
  if (bookmark.tags?.length) {
    const tags = document.createElement("ul");
    tags.className = "bookmark-tags";
    tags.setAttribute("aria-label", "Tags");
    bookmark.tags.forEach((tag) => {
      const label = document.createElement("li");
      label.textContent = tag;
      tags.appendChild(label);
    });
    appendMetadata(metadata, "Tags", tags);
  }
  const collectionName = collections.find(({ id }) => id === bookmark.collectionId)?.name ?? "Unsorted";
  appendMetadata(metadata, "Collection", collectionName);
  details.appendChild(metadata);
  details.appendChild(bookmarkActions(bookmark, savingViewStatus));
  return details;
}
