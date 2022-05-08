import type { Collection } from "../bookmarks/collections.js";

type CollectionSelectMode = "assignment" | "scope" | "management";

function collectionGroup(
  collections: readonly Collection[],
  prefix = "",
): HTMLOptGroupElement | undefined {
  if (collections.length === 0) {
    return undefined;
  }

  const group = document.createElement("optgroup");
  group.label = "Collections";
  const sorted = collections.slice().sort((left, right) => left.name.localeCompare(right.name));
  sorted.forEach(({ id, name }) => {
    group.appendChild(new Option(name, prefix + id));
  });
  return group;
}

export function collectionOptions(
  select: HTMLSelectElement,
  collections: readonly Collection[],
  selected = "",
  mode: CollectionSelectMode = "assignment",
): void {
  const options = document.createDocumentFragment();
  const prefix = mode === "scope" ? "collection:" : "";
  let defaultSelected: boolean;
  
  if (mode === "scope") {
    options.appendChild(new Option("All bookmarks", "all"));
    options.appendChild(new Option("Unsorted", "unsorted"));
    defaultSelected = selected === "all" || selected === "unsorted";
  } else {
    const defaultLabel = mode === "management" ? "New collection" : "Unsorted";
    options.appendChild(new Option(defaultLabel, ""));
    defaultSelected = selected === "";
  }

  const group = collectionGroup(collections, prefix);
  if (group) {
    options.appendChild(group);
  }
  const available = defaultSelected || collections.some(({ id }) => prefix + id === selected);
  if (!available) {
    const missing = new Option("Removed collection", selected);
    missing.disabled = true;
    options.appendChild(missing);
  }
  select.replaceChildren(options);
  select.value = selected;
}
