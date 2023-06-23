import type { Bookmark } from "../bookmarks/model.js";
import { bookmarkDomain } from "../bookmarks/domains.js";
import { bookmarkActions } from "./bookmark-actions.js";
import { bookmarkPreview } from "./bookmark-preview.js";

export type BookmarkView = "cards" | "list";

export function bookmarkCard(
  bookmark: Bookmark,
  view: BookmarkView = "cards",
  savingViewStatus = false,
): HTMLLIElement {
  const card = document.createElement("li");
  card.className = "bookmark-card";

  const link = document.createElement("a");
  link.className = view === "cards" && bookmark.thumbnailUrl
    ? "bookmark-link"
    : "bookmark-link bookmark-link--text-only";

  link.href = bookmark.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("data-bookmark-url", bookmark.url);

  const title = document.createElement("h2");
  title.textContent = bookmark.title;

  const metadata = document.createElement("div");
  metadata.className = "bookmark-meta";

  const domain = document.createElement("p");
  domain.className = "bookmark-domain";
  domain.textContent = bookmarkDomain(bookmark.url);
  metadata.appendChild(domain);

  link.appendChild(title);
  link.appendChild(metadata);

  if (view === "cards" && bookmark.thumbnailUrl) {
    link.appendChild(bookmarkPreview(bookmark.thumbnailUrl));
  }

  if (bookmark.tags?.length) {
    const tags = document.createElement("ul");
    tags.className = "bookmark-tags";
    tags.setAttribute("aria-label", "Tags");
    bookmark.tags.forEach((tag) => {
      const label = document.createElement("li");
      label.textContent = tag;
      tags.appendChild(label);
    });
    link.appendChild(tags);
  }

  card.appendChild(link);
  card.appendChild(bookmarkActions(bookmark, savingViewStatus));
  return card;
}
