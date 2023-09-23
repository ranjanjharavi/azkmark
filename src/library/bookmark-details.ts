import type { Bookmark } from "../bookmarks/model.js";
import { bookmarkDomain } from "../bookmarks/domains.js";
import { bookmarkActions } from "./bookmark-actions.js";
import { bookmarkPreview } from "./bookmark-preview.js";

export function bookmarkDetails(bookmark: Bookmark, savingViewStatus = false): HTMLDivElement {
  const details = document.createElement("div");
  details.className = "bookmark-detail-content";

  const domain = document.createElement("p");
  domain.className = "bookmark-domain";
  domain.textContent = bookmarkDomain(bookmark.url);
  details.appendChild(domain);

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
  details.appendChild(bookmarkActions(bookmark, savingViewStatus));
  return details;
}
