import type { Collection } from "../bookmarks/collections.js";

function collectionButton(scope: string, label: string, selected: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "collection-tab";
  button.type = "button";
  button.value = scope;
  button.textContent = label;
  button.setAttribute("aria-pressed", String(scope === selected));
  button.setAttribute("aria-controls", "bookmarks");
  return button;
}

export function collectionButtons(collections: readonly Collection[], selected: string): DocumentFragment {
  const buttons = document.createDocumentFragment();
  buttons.appendChild(collectionButton("all", "All bookmarks", selected));

  const sorted = collections.slice().sort((left, right) => left.name.localeCompare(right.name));
  sorted.forEach(({ id, name }) => {
    buttons.appendChild(collectionButton(`collection:${id}`, name, selected));
  });

  buttons.appendChild(collectionButton("unsorted", "Unsorted", selected));
  return buttons;
}
