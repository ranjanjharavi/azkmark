import { groupBookmarks } from "./bookmarks/domains.js";
import type { Bookmark } from "./bookmarks/model.js";
import { filterBookmarks } from "./bookmarks/search.js";
import type { BookmarkSelection } from "./bookmarks/search.js";
import { readBookmarks, watchBookmarks } from "./bookmarks/storage.js";
import { bookmarkCard } from "./library/bookmark-card.js";

const libraryHeading = document.querySelector<HTMLHeadingElement>("#library-heading");
const libraryStatus = document.querySelector<HTMLParagraphElement>("#library-status");
const libraryControls = document.querySelector<HTMLFormElement>("#library-controls");
const searchInput = document.querySelector<HTMLInputElement>("#search");
const domainSelect = document.querySelector<HTMLSelectElement>("#domain");
const emptyState = document.querySelector<HTMLElement>("#library-empty");
const noMatches = document.querySelector<HTMLElement>("#no-matches");
const resetFilters = document.querySelector<HTMLButtonElement>("#reset-filters");
const libraryError = document.querySelector<HTMLDivElement>("#library-error");
const readError = document.querySelector<HTMLParagraphElement>("#read-error");
const retryButton = document.querySelector<HTMLButtonElement>("#retry");
const bookmarksList = document.querySelector<HTMLUListElement>("#bookmarks");

if (
  !libraryHeading
  || !libraryStatus
  || !libraryControls
  || !searchInput
  || !domainSelect
  || !emptyState
  || !noMatches
  || !resetFilters
  || !libraryError
  || !readError
  || !retryButton
  || !bookmarksList
) {
  throw new Error("The library is missing a required heading, control, or state.");
}

const libraryHeadingElement = libraryHeading;
const libraryStatusElement = libraryStatus;
const libraryControlsElement = libraryControls;
const searchInputElement = searchInput;
const domainSelectElement = domainSelect;
const emptyStateElement = emptyState;
const noMatchesElement = noMatches;
const resetFiltersButton = resetFilters;
const libraryErrorElement = libraryError;
const readErrorElement = readError;
const retryButtonElement = retryButton;
const bookmarksListElement = bookmarksList;

type FocusTarget = "list" | "search" | "domain" | "reset" | "retry" | "other";

interface FocusSnapshot {
  target: FocusTarget;
  bookmarkUrl?: string;
}

let library: Bookmark[] | undefined;
let selection: BookmarkSelection = { kind: "all" };
let revision = 0;
let hasLoaded = false;

function captureFocus(): FocusSnapshot {
  const activeElement = document.activeElement;
  if (!activeElement) {
    return { target: "other" };
  }

  if (activeElement === searchInputElement) {
    return { target: "search" };
  }
  if (activeElement === domainSelectElement) {
    return { target: "domain" };
  }
  if (activeElement === resetFiltersButton) {
    return { target: "reset" };
  }
  if (activeElement === retryButtonElement) {
    return { target: "retry" };
  }
  if (bookmarksListElement.contains(activeElement)) {
    if (activeElement instanceof HTMLAnchorElement) {
      return {
        target: "list",
        bookmarkUrl: activeElement.getAttribute("data-bookmark-url") || undefined,
      };
    }
    return { target: "list" };
  }

  return { target: "other" };
}

function focusHeading(): void {
  libraryHeadingElement.focus({ preventScroll: true });
}

function restoreFocus(focus: FocusSnapshot): void {
  const total = library?.length ?? 0;
  if (focus.target === "list") {
    if (focus.bookmarkUrl) {
      const links = bookmarksListElement.querySelectorAll<HTMLAnchorElement>(".bookmark-link");
      for (let index = 0; index < links.length; index++) {
        const link = links[index];
        if (link.getAttribute("data-bookmark-url") === focus.bookmarkUrl) {
          link.focus({ preventScroll: true });
          return;
        }
      }
    }

    const firstLink = bookmarksListElement.querySelector<HTMLAnchorElement>(".bookmark-link");
    if (firstLink) {
      firstLink.focus({ preventScroll: true });
    } else if (total > 0) {
      searchInputElement.focus({ preventScroll: true });
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

  if (total === 0 && (focus.target === "search" || focus.target === "domain")) {
    focusHeading();
  } else if (focus.target === "search") {
    searchInputElement.focus({ preventScroll: true });
  } else if (focus.target === "domain") {
    domainSelectElement.focus({ preventScroll: true });
  }
}

function updateDomainOptions(bookmarks: readonly Bookmark[]): string {
  const groups = groupBookmarks(bookmarks);
  let notice = "";

  if (selection.kind === "domain" && !groups.domains.has(selection.domain)) {
    selection = { kind: "all" };
    notice = "Domain group no longer available. Showing All bookmarks, search kept.";
  }

  const options = [
    new Option(`All bookmarks (${bookmarks.length})`, "all"),
    new Option(`General (${groups.general.length})`, "general"),
  ];
  const domains = Array.from(groups.domains.keys()).sort();
  domains.forEach((domain) => {
    const members = groups.domains.get(domain) ?? [];
    options.push(new Option(`${domain} (${members.length})`, `domain:${domain}`));
  });

  while (domainSelectElement.firstChild) {
    domainSelectElement.removeChild(domainSelectElement.firstChild);
  }
  options.forEach((option) => {
    domainSelectElement.appendChild(option);
  });
  domainSelectElement.value = selection.kind === "domain"
    ? `domain:${selection.domain}`
    : selection.kind;

  return notice;
}

function bookmarkCount(count: number): string {
  return `${count} ${count === 1 ? "bookmark" : "bookmarks"}`;
}

function render(notice = "", focus: FocusSnapshot = captureFocus()): void {
  if (!library) {
    return;
  }

  const matches = filterBookmarks(library, {
    query: searchInputElement.value,
    selection,
  });

  while (bookmarksListElement.firstChild) {
    bookmarksListElement.removeChild(bookmarksListElement.firstChild);
  }
  matches.forEach((bookmark) => {
    bookmarksListElement.appendChild(bookmarkCard(bookmark));
  });

  const isEmpty = library.length === 0;
  const hasNoMatches = !isEmpty && matches.length === 0;
  const filtered = selection.kind !== "all" || searchInputElement.value.trim() !== "";
  let heading: string;
  if (selection.kind === "all") {
    heading = "All bookmarks";
  } else if (selection.kind === "general") {
    heading = "General";
  } else {
    heading = selection.domain;
  }

  libraryHeadingElement.textContent = heading;
  libraryHeadingElement.title = heading;
  let statusText = bookmarkCount(library.length);
  if (filtered) {
    statusText = `${matches.length} of ${library.length} bookmarks`;
  }
  if (notice) {
    statusText = `${notice} ${statusText}`;
  }
  libraryStatusElement.textContent = statusText;
  libraryControlsElement.hidden = isEmpty;
  emptyStateElement.hidden = !isEmpty;
  noMatchesElement.hidden = !hasNoMatches;
  bookmarksListElement.hidden = matches.length === 0;
  bookmarksListElement.setAttribute("aria-busy", "false");
  libraryErrorElement.hidden = true;

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
    library = bookmarks;
    const notice = updateDomainOptions(bookmarks);
    searchInputElement.disabled = false;
    domainSelectElement.disabled = false;
    resetFiltersButton.disabled = false;
    hasLoaded = true;
    render(notice, focus);
  } catch (error) {
    if (currentRevision !== revision) {
      return;
    }

    const focus = captureFocus();
    console.error("Could not read saved bookmarks.", error);
    library = undefined;
    libraryStatusElement.textContent = "Couldn't load your bookmarks.";
    readErrorElement.textContent = "Couldn't load your bookmarks. Your saved data wasn't changed. Try again.";
    libraryErrorElement.hidden = false;
    emptyStateElement.hidden = true;
    noMatchesElement.hidden = true;
    bookmarksListElement.hidden = true;
    bookmarksListElement.setAttribute("aria-busy", "false");
    searchInputElement.disabled = true;
    domainSelectElement.disabled = true;
    resetFiltersButton.disabled = true;

    if (
      focus.target === "list"
      || focus.target === "search"
      || focus.target === "domain"
      || focus.target === "reset"
    ) {
      retryButtonElement.focus({ preventScroll: true });
    }
  }
}

searchInputElement.addEventListener("input", () => {
  render();
});

domainSelectElement.addEventListener("change", () => {
  const value = domainSelectElement.value;
  if (value.startsWith("domain:")) {
    selection = { kind: "domain", domain: value.slice("domain:".length) };
  } else if (value === "general") {
    selection = { kind: "general" };
  } else {
    selection = { kind: "all" };
  }
  render();
});

libraryControlsElement.addEventListener("submit", (event) => {
  event.preventDefault();
});

resetFiltersButton.addEventListener("click", () => {
  searchInputElement.value = "";
  selection = { kind: "all" };
  domainSelectElement.value = "all";
  render();
  searchInputElement.focus({ preventScroll: true });
});

retryButtonElement.addEventListener("click", () => {
  void refreshBookmarks();
});

watchBookmarks(() => {
  void refreshBookmarks();
});
void refreshBookmarks();
