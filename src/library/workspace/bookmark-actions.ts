import type { Bookmark } from "../../bookmarks/model.js";

type BookmarkAction = "viewed" | "edit" | "delete";

const ACTIONS: readonly BookmarkAction[] = ["viewed", "edit", "delete"];

// Detail actions share metadata for delegated clicks and URL-based focus recovery.
// Decorative icons are selected entirely by CSS tokens and these attributes.
export function bookmarkActions(bookmark: Bookmark, savingViewStatus = false): HTMLDivElement {
  const actions = document.createElement("div");
  actions.className = "bookmark-actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Bookmark actions");

  const managementActions = document.createElement("div");
  managementActions.className = "bookmark-action-group";

  ACTIONS.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-action";
    button.setAttribute("data-action", action);
    button.setAttribute("data-bookmark-url", bookmark.url);

    let label: string;
    switch (action) {
      case "viewed":
        label = bookmark.viewed ? "Mark not viewed" : "Mark viewed";
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
    button.textContent = label;
    button.setAttribute("aria-label", `${label}: ${bookmark.title}`);
    if (action === "viewed") {
      actions.appendChild(button);
    } else {
      managementActions.appendChild(button);
    }
  });

  actions.appendChild(managementActions);
  return actions;
}
