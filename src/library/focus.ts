import type { Bookmark } from "../bookmarks/model.js";
import type { ManagementAction, ManagementMode } from "./workspace/bookmark-dialog.js";

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

function focusBookmarkRow(list: HTMLUListElement, url: string | undefined): boolean {
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

function focusDetailAction(details: HTMLElement, url: string | undefined, action: BookmarkAction | undefined): boolean {
  const buttons = details.querySelectorAll<HTMLButtonElement>(".bookmark-action");
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    if (
      button.getAttribute("data-bookmark-url") === url &&
      button.getAttribute("data-action") === action &&
      !button.disabled
    ) {
      button.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

interface LibraryFocusElements {
  searchInputElement: HTMLInputElement;
  domainSelectElement: HTMLSelectElement;
  savedDateSelectElement: HTMLSelectElement;
  viewStatusSelectElement: HTMLSelectElement;
  tagSelect: HTMLSelectElement;
  sortSelectElement: HTMLSelectElement;
  toggleFiltersElement: HTMLButtonElement;
  resetFiltersButton: HTMLButtonElement;
  clearCollectionButton: HTMLButtonElement;
  collectionNavigationElement: HTMLElement;
  manageCollectionsButton: HTMLButtonElement;
  libraryHeadingElement: HTMLHeadingElement;
  retryButtonElement: HTMLButtonElement;
  bookmarksListElement: HTMLUListElement;
  bookmarkDetailsElement: HTMLElement;
}

interface LibraryFocusContext {
  library: readonly Bookmark[] | undefined;
  selectedUrl: string | undefined;
  collectionScope: string;
}

export function initializeLibraryFocus(elements: LibraryFocusElements, getContext: () => LibraryFocusContext) {
  const {
    searchInputElement,
    domainSelectElement,
    savedDateSelectElement,
    viewStatusSelectElement,
    tagSelect,
    sortSelectElement,
    toggleFiltersElement,
    resetFiltersButton,
    clearCollectionButton,
    collectionNavigationElement,
    manageCollectionsButton,
    libraryHeadingElement,
    retryButtonElement,
    bookmarksListElement,
    bookmarkDetailsElement
  } = elements;

  function captureFocus(): FocusSnapshot {
    const activeElement = document.activeElement;
    if (!activeElement) {
      return { target: "other" };
    }

    if (activeElement === searchInputElement) {
      return { target: "search" };
    }
    if (
      activeElement instanceof HTMLButtonElement &&
      collectionNavigationElement.contains(activeElement) &&
      activeElement.hasAttribute("value")
    ) {
      return { target: "collection", collectionScope: activeElement.value };
    }
    if (activeElement === manageCollectionsButton) {
      return { target: "manage-collections" };
    }
    if (activeElement === clearCollectionButton) {
      return { target: "reset" };
    }
    if (activeElement === domainSelectElement) {
      return { target: "domain" };
    }
    if (activeElement === savedDateSelectElement) {
      return { target: "saved-date" };
    }
    if (activeElement === viewStatusSelectElement) {
      return { target: "view-status" };
    }
    if (activeElement === tagSelect) {
      return { target: "tag" };
    }
    if (activeElement === sortSelectElement) {
      return { target: "sort" };
    }
    if (activeElement === toggleFiltersElement) {
      return { target: "filters" };
    }
    if (activeElement === resetFiltersButton) {
      return { target: "reset" };
    }
    if (activeElement === retryButtonElement) {
      return { target: "retry" };
    }
    const inList = bookmarksListElement.contains(activeElement);
    if (inList || bookmarkDetailsElement.contains(activeElement)) {
      const focus: FocusSnapshot = { target: inList ? "list" : "details" };
      if (activeElement instanceof HTMLButtonElement || activeElement instanceof HTMLAnchorElement) {
        focus.bookmarkUrl = activeElement.getAttribute("data-bookmark-url") || undefined;
        const mode = activeElement.getAttribute("data-action");
        if (mode === "viewed" || mode === "edit" || mode === "delete") {
          focus.bookmarkAction = mode;
        }
      }
      return focus;
    }

    return { target: "other" };
  }

  function focusHeading(): void {
    libraryHeadingElement.focus({ preventScroll: true });
  }

  function focusSelectedBookmark(): void {
    const { library, selectedUrl } = getContext();
    if (focusBookmarkRow(bookmarksListElement, selectedUrl)) {
      return;
    }
    if (library?.length) {
      searchInputElement.focus({ preventScroll: true });
    } else {
      focusHeading();
    }
  }

  function restoreFocus(focus: FocusSnapshot): void {
    const { library, selectedUrl, collectionScope } = getContext();
    const total = library?.length ?? 0;
    if (focus.target === "collection") {
      const buttons = collectionNavigationElement.querySelectorAll<HTMLButtonElement>("button[value]");
      let selectedButton: HTMLButtonElement | undefined;
      for (let index = 0; index < buttons.length; index++) {
        const button = buttons[index];
        if (button.disabled) {
          continue;
        }

        if (button.value === focus.collectionScope) {
          button.focus({ preventScroll: true });
          return;
        }

        if (button.value === collectionScope) {
          selectedButton = button;
        }
      }
      selectedButton?.focus({ preventScroll: true });
      return;
    }
    if (focus.target === "manage-collections") {
      manageCollectionsButton.focus({ preventScroll: true });
      return;
    }
    if (focus.target === "list" && focusBookmarkRow(bookmarksListElement, focus.bookmarkUrl)) {
      return;
    }
    if (focus.target === "details" && focus.bookmarkUrl === selectedUrl) {
      if (focusDetailAction(bookmarkDetailsElement, focus.bookmarkUrl, focus.bookmarkAction)) {
        return;
      }
      if (!focus.bookmarkAction) {
        const link = bookmarkDetailsElement.querySelector<HTMLAnchorElement>(".bookmark-open");
        if (link) {
          link.focus({ preventScroll: true });
          return;
        }
      }
    }
    if (focus.target === "list" || focus.target === "details") {
      focusSelectedBookmark();
      return;
    }

    const controlTargets = {
      search: searchInputElement,
      domain: domainSelectElement,
      "saved-date": savedDateSelectElement,
      "view-status": viewStatusSelectElement,
      tag: tagSelect,
      sort: sortSelectElement,
      filters: toggleFiltersElement
    };
    if (
      focus.target === "search" ||
      focus.target === "domain" ||
      focus.target === "saved-date" ||
      focus.target === "view-status" ||
      focus.target === "tag" ||
      focus.target === "sort" ||
      focus.target === "filters"
    ) {
      if (total > 0) {
        controlTargets[focus.target].focus({ preventScroll: true });
      } else {
        focusHeading();
      }
      return;
    }

    if (focus.target === "retry" || focus.target === "reset") {
      if (total > 0) {
        searchInputElement.focus({ preventScroll: true });
      } else {
        focusHeading();
      }
      return;
    }
  }

  function restoreManagementFocus(action: ManagementAction): void {
    const { library } = getContext();
    if (!library) {
      retryButtonElement.focus({ preventScroll: true });
      return;
    }

    if (focusDetailAction(bookmarkDetailsElement, action.url, action.mode)) {
      return;
    }
    focusSelectedBookmark();
  }

  function restoreAfterReadError(focus: FocusSnapshot): void {
    if (focus.target !== "other" && focus.target !== "retry") {
      retryButtonElement.focus({ preventScroll: true });
    }
  }

  function reset(): void {
    if (getContext().library?.length) {
      searchInputElement.focus({ preventScroll: true });
    } else {
      focusHeading();
    }
  }

  function afterViewedUpdate(
    button: HTMLButtonElement,
    url: string,
    wasFocused: boolean,
    previous: FocusSnapshot
  ): FocusSnapshot {
    const activeElement = document.activeElement;
    const recoverActionFocus =
      wasFocused &&
      (activeElement === button ||
        activeElement === document.body ||
        activeElement === libraryHeadingElement ||
        (activeElement instanceof HTMLButtonElement &&
          activeElement.getAttribute("data-bookmark-url") === url &&
          (activeElement.getAttribute("data-action") === "viewed" ||
            activeElement.classList.contains("bookmark-select"))));
    if (recoverActionFocus && !getContext().library) {
      retryButtonElement.focus({ preventScroll: true });
    }
    return recoverActionFocus ? previous : captureFocus();
  }

  return {
    capture: captureFocus,
    restore: restoreFocus,
    restoreManagement: restoreManagementFocus,
    restoreAfterReadError,
    reset,
    afterViewedUpdate
  };
}
