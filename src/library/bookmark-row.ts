import type { Bookmark } from "../bookmarks/model.js";
import { bookmarkDomain } from "../bookmarks/domains.js";
import { formatSavedDate } from "./saved-date.js";

export function bookmarkRow(
  bookmark: Bookmark,
  selected: boolean,
  now: number,
  dateFormatter: Intl.DateTimeFormat,
): HTMLLIElement {
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

  const savedDate = formatSavedDate(bookmark.savedAt, now, dateFormatter);
  const age = document.createElement(savedDate.dateTime ? "time" : "span");
  age.className = "bookmark-row-age";
  age.textContent = savedDate.age;
  age.title = savedDate.full;
  if (savedDate.dateTime) {
    age.setAttribute("datetime", savedDate.dateTime);
  }

  const metadata = document.createElement("span");
  metadata.className = "bookmark-row-meta";
  metadata.appendChild(status);
  metadata.appendChild(age);

  button.appendChild(domain);
  button.appendChild(title);
  button.appendChild(metadata);
  row.appendChild(button);
  return row;
}
