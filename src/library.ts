import { readBookmarks, watchBookmarks } from "./bookmarks/storage.js";
import type { Bookmark } from "./bookmarks/model.js";
import { bookmarkCard } from "./library/bookmark-card.js";

const libraryHeading = document.querySelector<HTMLHeadingElement>("#library-heading");
const libraryStatus = document.querySelector<HTMLParagraphElement>("#library-status");
const emptyState = document.querySelector<HTMLElement>("#library-empty");
const libraryError = document.querySelector<HTMLDivElement>("#library-error");
const readError = document.querySelector<HTMLParagraphElement>("#read-error");
const retryButton = document.querySelector<HTMLButtonElement>("#retry");
const bookmarksList = document.querySelector<HTMLUListElement>("#bookmarks");

if (
  !libraryHeading
  || !libraryStatus
  || !emptyState
  || !libraryError
  || !readError
  || !retryButton
  || !bookmarksList
) {
  throw new Error("The library is missing a required heading, state, or bookmark list.");
}

const libraryHeadingElement = libraryHeading;
const libraryStatusElement = libraryStatus;
const emptyStateElement = emptyState;
const libraryErrorElement = libraryError;
const readErrorElement = readError;
const retryButtonElement = retryButton;
const bookmarksListElement = bookmarksList;

interface ListFocus {
  wasInList: boolean;
  bookmarkUrl?: string;
  wasOnRetry: boolean;
}

let revision = 0;
let hasLoaded = false;

function captureFocus(): ListFocus {
  const activeElement = document.activeElement;
  if (!activeElement) {
    return { wasInList: false, wasOnRetry: false };
  }

  const wasInList = bookmarksListElement.contains(activeElement);
  const wasOnRetry = activeElement === retryButtonElement;
  if (wasInList && activeElement instanceof HTMLAnchorElement) {
    return {
      wasInList: true,
      bookmarkUrl: activeElement.getAttribute("data-bookmark-url") || undefined,
      wasOnRetry,
    };
  }

  return { wasInList, wasOnRetry };
}

function focusHeading(): void {
  libraryHeadingElement.focus({ preventScroll: true });
}

function restoreFocus(focus: ListFocus): void {
  if (focus.wasInList) {
    if (focus.bookmarkUrl) {
      const links = bookmarksListElement.querySelectorAll<HTMLAnchorElement>(".bookmark-link");
      
      for (const element of links) {
        const link = element;
        if (link.getAttribute("data-bookmark-url") === focus.bookmarkUrl) {
          link.focus({ preventScroll: true });
          return;
        }
      }
    }

    focusHeading();
    return;
  }

  if (focus.wasOnRetry) {
    if (bookmarksListElement.hidden) {
      focusHeading();
      return;
    }

    const firstLink = bookmarksListElement.querySelector<HTMLAnchorElement>(".bookmark-link");
    if (firstLink) {
      firstLink.focus({ preventScroll: true });
    } else {
      focusHeading();
    }
  }
}

function renderBookmarks(bookmarks: Bookmark[], focus: ListFocus): void {
  const newestFirst = bookmarks.slice();
  newestFirst.sort((left, right) => {
    if (left.savedAt === right.savedAt) {
      return 0;
    }
    return left.savedAt > right.savedAt ? -1 : 1;
  });

  while (bookmarksListElement.firstChild) {
    bookmarksListElement.removeChild(bookmarksListElement.firstChild);
  }

  newestFirst.forEach((bookmark) => {
    bookmarksListElement.appendChild(bookmarkCard(bookmark));
  });

  const isEmpty = newestFirst.length === 0;
  bookmarksListElement.hidden = isEmpty;
  bookmarksListElement.setAttribute("aria-busy", "false");
  emptyStateElement.hidden = !isEmpty;
  libraryStatusElement.textContent = `${newestFirst.length} ${newestFirst.length === 1 ? "bookmark" : "bookmarks"}`;
  restoreFocus(focus);
}

async function refreshBookmarks(): Promise<void> {
  const currentRevision = ++revision;
  bookmarksListElement.setAttribute("aria-busy", "true");
  libraryStatusElement.textContent = hasLoaded ? "Updating bookmarks…" : "Loading your bookmarks…";

  try {
    const bookmarks = await readBookmarks();
    if (currentRevision !== revision) {
      return;
    }

    const focus = captureFocus();
    renderBookmarks(bookmarks, focus);
    libraryErrorElement.hidden = true;
    hasLoaded = true;
  } catch (error) {
    if (currentRevision !== revision) {
      return;
    }

    const focus = captureFocus();
    console.error("Could not read saved bookmarks.", error);
    libraryStatusElement.textContent = "Couldn't load your bookmarks.";
    readErrorElement.textContent = "Couldn't load your bookmarks. Check the extension and try again.";
    libraryErrorElement.hidden = false;
    emptyStateElement.hidden = true;
    bookmarksListElement.hidden = true;
    bookmarksListElement.setAttribute("aria-busy", "false");

    if (focus.wasInList) {
      focusHeading();
    }
  }
}

retryButtonElement.addEventListener("click", () => {
  void refreshBookmarks();
});

watchBookmarks(() => {
  void refreshBookmarks();
});

void refreshBookmarks();
