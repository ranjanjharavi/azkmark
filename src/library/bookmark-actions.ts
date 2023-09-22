import type { Bookmark } from "../bookmarks/model.js";

type BookmarkAction = "viewed" | "edit" | "delete";

const ACTIONS: readonly BookmarkAction[] = ["viewed", "edit", "delete"];

// Detail actions share metadata for delegated clicks and URL-based focus recovery.
// Decorative icons are selected entirely by CSS tokens and these attributes.
export function bookmarkActions(bookmark: Bookmark, savingViewStatus = false): HTMLDivElement {
  const actions = document.createElement("div");
  actions.className = "bookmark-actions";

  ACTIONS.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-action";
    button.setAttribute("data-action", action);
    button.setAttribute("data-bookmark-url", bookmark.url);

    let label: string;
    switch (action) {
      case "viewed":
        label = bookmark.viewed ? "Viewed. Mark to view" : "To view. Mark viewed";
        button.setAttribute("data-viewed", String(!bookmark.viewed));
        button.setAttribute("aria-pressed", String(Boolean(bookmark.viewed)));
        button.setAttribute("aria-busy", String(savingViewStatus));
        button.disabled = savingViewStatus;
        break;
      case "edit":
        label = "Edit bookmark";
        break;
      case "delete":
        label = "Delete bookmark";
        break;
    }
    button.setAttribute("aria-label", `${label}: ${bookmark.title}`);
    actions.appendChild(button);
  });

  return actions;
}
