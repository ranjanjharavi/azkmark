import type { Collection } from "../bookmarks/collections.js";

function collectionGroup(collections: readonly Collection[]): HTMLOptGroupElement | undefined {
  if (collections.length === 0) {
    return undefined;
  }

  const group = document.createElement("optgroup");
  group.label = "Collections";
  const sorted = collections.slice().sort((left, right) => left.name.localeCompare(right.name));
  sorted.forEach(({ id, name }) => {
    group.appendChild(new Option(name, id));
  });
  return group;
}

export function collectionOptions(
  select: HTMLSelectElement,
  collections: readonly Collection[],
  selected = "",
): void {
  const options = document.createDocumentFragment();
  options.appendChild(new Option("Unsorted", ""));

  const group = collectionGroup(collections);
  if (group) {
    options.appendChild(group);
  }
  const available = selected === "" || collections.some(({ id }) => id === selected);
  if (!available) {
    const missing = new Option("Removed collection", selected);
    missing.disabled = true;
    options.appendChild(missing);
  }
  select.replaceChildren(options);
  select.value = selected;
}
