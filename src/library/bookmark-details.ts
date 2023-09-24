import type { Bookmark } from "../bookmarks/model.js";
import type { Collection } from "../bookmarks/collections.js";
import { bookmarkDomain } from "../bookmarks/domains.js";
import { bookmarkActions } from "./bookmark-actions.js";
import { bookmarkPreview } from "./bookmark-preview.js";

function appendMetadata(list: HTMLDListElement, label: string, value: string | HTMLTimeElement): void {
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

  const header = document.createElement("div");
  header.className = "bookmark-detail-head";
  const domain = document.createElement("p");
  domain.className = "bookmark-domain";
  domain.textContent = bookmarkDomain(bookmark.url);
  header.appendChild(domain);

  const context = document.createElement("span");
  context.className = "bookmark-reference-label";
  context.textContent = "Saved reference";
  header.appendChild(context);
  details.appendChild(header);

  if (bookmark.thumbnailUrl) {
    details.appendChild(bookmarkPreview(bookmark.thumbnailUrl));
  }

  const title = document.createElement("h2");
  title.className = "bookmark-detail-title";
  title.textContent = bookmark.title;
  details.appendChild(title);

  if (bookmark.tags?.length) {
    const tags = document.createElement("ul");
    tags.className = "bookmark-tags";
    tags.setAttribute("aria-label", "Tags");
    bookmark.tags.forEach((tag) => {
      const label = document.createElement("li");
      label.textContent = tag;
      tags.appendChild(label);
    });
    details.appendChild(tags);
  }

  const link = document.createElement("a");
  link.className = "bookmark-open";
  link.href = bookmark.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("data-bookmark-url", bookmark.url);
  link.textContent = "Open page ↗";
  details.appendChild(link);

  const url = document.createElement("p");
  url.className = "bookmark-url";
  url.textContent = bookmark.url;
  details.appendChild(url);

  const metadata = document.createElement("dl");
  metadata.className = "bookmark-detail-metadata";
  const collectionName = collections.find(({ id }) => id === bookmark.collectionId)?.name ?? "Unsorted";
  appendMetadata(metadata, "Collection", collectionName);

  const savedDate = new Date(bookmark.savedAt);
  let savedValue: string | HTMLTimeElement = `Timestamp ${bookmark.savedAt}`;
  
  if (!Number.isNaN(savedDate.getTime())) {
    const time = document.createElement("time");
    time.dateTime = savedDate.toISOString().replace(/^\+/, "");
    time.textContent = savedDate.toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    savedValue = time;
  }
  appendMetadata(metadata, "Saved", savedValue);
  appendMetadata(metadata, "Status", bookmark.viewed ? "Viewed" : "To view");
  details.appendChild(metadata);
  details.appendChild(bookmarkActions(bookmark, savingViewStatus));
  return details;
}
