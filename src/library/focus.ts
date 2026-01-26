import type { ManagementMode } from "./workspace/bookmark-dialog.js";

type FocusTarget =
  | "list"
  | "details"
  | "search"
  | "domain"
  | "collection"
  | "manage-collections"
  | "saved-date"
  | "view-status"
  | "tag"
  | "sort"
  | "filters"
  | "reset"
  | "retry"
  | "other";
type BookmarkAction = ManagementMode | "viewed";

export interface FocusSnapshot {
  target: FocusTarget;
  collectionScope?: string;
  bookmarkUrl?: string;
  bookmarkAction?: BookmarkAction;
}

export function focusBookmarkRow(list: HTMLUListElement, url: string | undefined): boolean {
  const buttons = list.querySelectorAll<HTMLButtonElement>(".bookmark-select");
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    if (button.getAttribute("data-bookmark-url") === url) {
      button.focus({ preventScroll: true });

      const listBounds = list.getBoundingClientRect();
      const rowBounds = button.getBoundingClientRect();
      const listHeight = list.clientHeight;
      const visibleTop = listBounds.top + list.clientTop;
      const visibleBottom = visibleTop + listHeight;

      if (rowBounds.top <= visibleTop && rowBounds.bottom >= visibleBottom) {
        return true;
      }

      if (rowBounds.top < visibleTop || rowBounds.height > listHeight) {
        list.scrollTop += rowBounds.top - visibleTop;
      } else if (rowBounds.bottom > visibleBottom) {
        list.scrollTop += rowBounds.bottom - visibleBottom;
      }

      return true;
    }
  }
  
  return false;
}

export function focusDetailAction(
  details: HTMLElement,
  url: string | undefined,
  action: BookmarkAction | undefined,
): boolean {
  const buttons = details.querySelectorAll<HTMLButtonElement>(".bookmark-action");
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    if (
      button.getAttribute("data-bookmark-url") === url
      && button.getAttribute("data-action") === action
      && !button.disabled
    ) {
      button.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}
