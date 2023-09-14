import type { Collection } from "../bookmarks/collections.js";
import type { Bookmark } from "../bookmarks/model.js";
import { countCollectionBookmarks } from "./collection-counts.js";

function collectionButton(scope: string, label: string, count: number, selected: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "collection-tab";
  button.type = "button";
  button.value = scope;
  button.textContent = label;
  button.setAttribute("aria-label", `${label}, ${count} ${count === 1 ? "bookmark" : "bookmarks"}`);
  button.setAttribute("aria-pressed", String(scope === selected));
  button.setAttribute("aria-controls", "bookmarks");

  const countElement = document.createElement("span");
  countElement.className = "collection-count";
  countElement.textContent = String(count);
  button.appendChild(countElement);
  return button;
}

export function collectionButtons(
  collections: readonly Collection[],
  bookmarks: readonly Bookmark[],
  selected: string,
): DocumentFragment {
  const buttons = document.createDocumentFragment();
  const counts = countCollectionBookmarks(bookmarks);
  buttons.appendChild(collectionButton("all", "All bookmarks", bookmarks.length, selected));

  const sorted = collections.slice().sort((left, right) => left.name.localeCompare(right.name));
  sorted.forEach(({ id, name }) => {
    const count = counts.get(id) ?? 0;
    buttons.appendChild(collectionButton(`collection:${id}`, name, count, selected));
  });

  const unsortedCount = counts.get(undefined) ?? 0;
  buttons.appendChild(collectionButton("unsorted", "Unsorted", unsortedCount, selected));
  return buttons;
}
