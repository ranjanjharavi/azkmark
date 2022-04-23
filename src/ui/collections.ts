import type { Collection } from "../bookmarks/collections.js";

export function collectionGroup(
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
  defaultLabel = "Unsorted",
): void {
  const options = document.createDocumentFragment();
  options.appendChild(new Option(defaultLabel, ""));
  const group = collectionGroup(collections);
  if (group) {
    options.appendChild(group);
  }
  if (selected && !collections.some(({ id }) => id === selected)) {
    const missing = new Option("Removed collection — choose another", selected);
    missing.disabled = true;
    options.appendChild(missing);
  }
  select.replaceChildren(options);
  select.value = selected;
}
