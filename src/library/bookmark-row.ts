import type { Bookmark } from "../bookmarks/model.js";
import { bookmarkDomain } from "../bookmarks/domains.js";

export function bookmarkRow(bookmark: Bookmark, selected: boolean): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "bookmark-row";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "bookmark-select";
  button.setAttribute("data-bookmark-url", bookmark.url);
  button.setAttribute("aria-pressed", String(selected));
  button.setAttribute("aria-controls", "bookmark-details");

  const domain = document.createElement("span");
  domain.className = "bookmark-domain";
  domain.textContent = bookmarkDomain(bookmark.url);

  const title = document.createElement("span");
  title.className = "bookmark-title";
  title.textContent = bookmark.title;

  const status = document.createElement("span");
  status.className = "bookmark-row-status";
  status.textContent = bookmark.viewed ? "Viewed" : "To view";

  button.appendChild(domain);
  button.appendChild(title);
  button.appendChild(status);
  row.appendChild(button);
  return row;
}
