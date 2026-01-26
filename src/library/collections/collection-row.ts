import type { Collection } from "../../bookmarks/collections.js";

function collectionAction(action: "rename" | "delete", collection: Collection): HTMLButtonElement {
  const button = document.createElement("button");
  const label = action === "rename" ? "Rename" : "Delete";
  button.type = "button";
  button.className = "collection-row-action";
  button.dataset.collectionAction = action;
  button.title = label;
  button.setAttribute("aria-label", `${label} ${collection.name}`);
  return button;
}

export function collectionRow(collection: Collection, count: number, editing = false): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "collection-manager-row";
  row.dataset.collectionId = collection.id;

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "collection-row-summary";
  summary.dataset.collectionAction = "rename";
  summary.hidden = editing;
  const unit = count === 1 ? "bookmark" : "bookmarks";
  summary.setAttribute("aria-label", `Rename ${collection.name}, ${count} ${unit}`);

  const name = document.createElement("strong");
  name.textContent = collection.name;
  const size = document.createElement("span");
  size.className = "collection-row-count";
  size.textContent = `${count} ${unit}`;
  summary.appendChild(name);
  summary.appendChild(size);

  const actions = document.createElement("div");
  actions.className = "collection-row-actions";
  actions.hidden = editing;
  actions.appendChild(collectionAction("rename", collection));
  actions.appendChild(collectionAction("delete", collection));
  row.appendChild(summary);
  row.appendChild(actions);
  return row;
}
