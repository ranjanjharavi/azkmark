import type { Bookmark } from "../../bookmarks/model.js";
import { noteIcon } from "../../ui/markdown.js";

type BookmarkAction = "viewed" | "edit" | "delete";

const ACTIONS: readonly BookmarkAction[] = ["viewed", "edit", "delete"];

// Detail actions share metadata for delegated clicks and URL-based focus recovery.
export function bookmarkActions(bookmark: Bookmark, savingViewStatus = false): HTMLDivElement {
  const actions = document.createElement("div");
  actions.className = "bookmark-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Bookmark actions");

  ACTIONS.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-action";
    button.setAttribute("data-action", action);
    button.setAttribute("data-bookmark-url", bookmark.url);

    let label: string;
    switch (action) {
      case "viewed":
        label = bookmark.viewed ? "Mark to view" : "Mark viewed";
        button.setAttribute("aria-pressed", String(Boolean(bookmark.viewed)));
        button.setAttribute("data-viewed", String(!bookmark.viewed));
        button.classList.toggle("is-viewed", Boolean(bookmark.viewed));
        button.setAttribute("aria-busy", String(savingViewStatus));
        button.disabled = savingViewStatus;
        break;
      case "edit":
        label = "Edit";
        break;
      case "delete":
        label = "Delete";
        break;
    }
    const icons = { viewed: bookmark.viewed ? "eye-off" : "eye", edit: "pencil", delete: "trash-2" };
    button.appendChild(noteIcon(icons[action]));
    button.dataset.tooltip = label;
    button.setAttribute("aria-label", `${label}: ${bookmark.title}`);
    actions.appendChild(button);
  });

  return actions;
}
