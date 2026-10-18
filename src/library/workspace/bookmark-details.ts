import type { Bookmark } from "../../bookmarks/model.js";
import type { Collection } from "../../bookmarks/collections.js";
import { bookmarkDomain } from "../../bookmarks/domains.js";
import { bookmarkActions } from "./bookmark-actions.js";
import { bookmarkPreview } from "./bookmark-preview.js";
import { formatSavedDate } from "../saved-date.js";

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
  notesPanel?: HTMLElement,
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

  const link = document.createElement("a");
  link.className = "bookmark-open";
  link.href = bookmark.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.dataset.bookmarkUrl = bookmark.url;
  link.textContent = "Open page";
  const svgNamespace = "http://www.w3.org/2000/svg";
  const arrow = document.createElementNS(svgNamespace, "svg");
  arrow.classList.add("library-control-icon");
  arrow.setAttribute("viewBox", "0 0 24 24");
  arrow.setAttribute("aria-hidden", "true");
  arrow.setAttribute("focusable", "false");
  const arrowPath = document.createElementNS(svgNamespace, "path");
  arrowPath.setAttribute("d", "M7 17 17 7M7 7h10v10");
  arrow.appendChild(arrowPath);
  link.appendChild(arrow);
  const toolbar = document.createElement("div");
  toolbar.className = "bookmark-open-row";
  toolbar.append(link, bookmarkActions(bookmark, savingViewStatus));
  details.append(toolbar);
  details.append(notesPanel ?? bookmarkMetadata(bookmark, collections));
  return details;
}

export function bookmarkMetadata(bookmark: Bookmark, collections: readonly Collection[]): HTMLDListElement {
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
  appendMetadata(metadata, "URL", bookmark.url);
  return metadata;
}
