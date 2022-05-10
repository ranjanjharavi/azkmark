import { groupBookmarks } from "./bookmarks/domains.js";
import type { Bookmark } from "./bookmarks/model.js";
import type { Collection } from "./bookmarks/collections.js";
import { collectionOptions } from "./ui/collections.js";
import { requireElement } from "./ui/dom.js";
import { initializeCollections } from "./library/collections.js";
import { filterBookmarks } from "./bookmarks/search.js";
import type {
  BookmarkSelection,
  BookmarkSort,
  SavedDateSelection,
  ViewStatusSelection,
} from "./bookmarks/search.js";
import {
  InvalidStoredBookmarkError,
  readLibrary,
  StorageQuotaError,
  updateBookmarkViewed,
  watchBookmarks,
} from "./bookmarks/storage.js";
import { bookmarkCard } from "./library/bookmark-card.js";
import type { BookmarkView } from "./library/bookmark-card.js";
import { initializeBookmarkPreviews } from "./library/bookmark-preview.js";
import { initializeExport } from "./library/export.js";
import { initializeImport } from "./library/import.js";
import { initializeManagement } from "./library/management.js";
import { createRefreshScheduler } from "./library/refresh.js";
import { initializeSavedDateRefresh } from "./library/saved-date-refresh.js";
import type { ManagementAction, ManagementMode } from "./library/management.js";

const collectionSelect = requireElement<HTMLSelectElement>("#collection");
const manageCollectionsButton = requireElement<HTMLButtonElement>("#manage-collections");
const collectionEmpty = requireElement<HTMLElement>("#collection-empty");
const collectionEmptyTitle = requireElement<HTMLHeadingElement>("#collection-empty-title");
const collectionEmptyCopy = requireElement<HTMLParagraphElement>("#collection-empty-copy");
const clearCollectionButton = requireElement<HTMLButtonElement>("#clear-collection");
const libraryHeading = document.querySelector<HTMLHeadingElement>("#library-heading");
const libraryStatus = document.querySelector<HTMLParagraphElement>("#library-status");
const libraryControls = document.querySelector<HTMLFormElement>("#library-controls");
const searchInput = document.querySelector<HTMLInputElement>("#search");
const domainSelect = document.querySelector<HTMLSelectElement>("#domain");
const savedDateSelect = document.querySelector<HTMLSelectElement>("#saved-date");
const viewStatusSelect = document.querySelector<HTMLSelectElement>("#view-status");
const sortSelect = document.querySelector<HTMLSelectElement>("#sort-by");
const cardsRadio = document.querySelector<HTMLInputElement>("#view-cards");
const listRadio = document.querySelector<HTMLInputElement>("#view-list");
const toggleFilters = document.querySelector<HTMLButtonElement>("#toggle-filters");
const filters = document.querySelector<HTMLDivElement>("#library-filters");
const filterCount = document.querySelector<HTMLSpanElement>("#filter-count");
const emptyState = document.querySelector<HTMLElement>("#library-empty");
const noMatches = document.querySelector<HTMLElement>("#no-matches");
const resetFilters = document.querySelector<HTMLButtonElement>("#reset-filters");
const managementFeedback = document.querySelector<HTMLParagraphElement>("#management-feedback");
const viewedFeedback = document.querySelector<HTMLParagraphElement>("#viewed-feedback");
const viewedError = document.querySelector<HTMLParagraphElement>("#viewed-error");
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
  || !savedDateSelect
  || !viewStatusSelect
  || !sortSelect
  || !cardsRadio
  || !listRadio
  || !toggleFilters
  || !filters
  || !filterCount
  || !emptyState
  || !noMatches
  || !resetFilters
  || !managementFeedback
  || !viewedFeedback
  || !viewedError
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
const savedDateSelectElement = savedDateSelect;
const viewStatusSelectElement = viewStatusSelect;
const sortSelectElement = sortSelect;
const cardsRadioElement = cardsRadio;
const listRadioElement = listRadio;
const toggleFiltersElement = toggleFilters;
const filtersElement = filters;
const filterCountElement = filterCount;
const emptyStateElement = emptyState;
const noMatchesElement = noMatches;
const resetFiltersButton = resetFilters;
const managementFeedbackElement = managementFeedback;
const viewedFeedbackElement = viewedFeedback;
const viewedErrorElement = viewedError;
const libraryErrorElement = libraryError;
const readErrorElement = readError;
const retryButtonElement = retryButton;
const bookmarksListElement = bookmarksList;

type FocusTarget =
  | "list"
  | "search"
  | "domain"
  | "collection"
  | "manage-collections"
  | "saved-date"
  | "view-status"
  | "sort"
  | "view-cards"
  | "view-list"
  | "filters"
  | "reset"
  | "retry"
  | "other";
type BookmarkAction = ManagementMode | "viewed";

interface FocusSnapshot {
  target: FocusTarget;
  bookmarkUrl?: string;
  bookmarkAction?: BookmarkAction;
}

let library: Bookmark[] | undefined;
let collections: Collection[] = [];
let collectionScope = "all";
let selection: BookmarkSelection = { kind: "all" };
let viewStatusSelection: ViewStatusSelection = "all";
let sortOrder: BookmarkSort = "newest";
let bookmarkView: BookmarkView = "cards";
const pendingViewed = new Set<string>();
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
  if (activeElement === collectionSelect) {
    return { target: "collection" };
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
  if (activeElement === sortSelectElement) {
    return { target: "sort" };
  }
  if (activeElement === cardsRadioElement) {
    return { target: "view-cards" };
  }
  if (activeElement === listRadioElement) {
    return { target: "view-list" };
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
  if (bookmarksListElement.contains(activeElement)) {
    if (activeElement instanceof HTMLAnchorElement) {
      return {
        target: "list",
        bookmarkUrl: activeElement.getAttribute("data-bookmark-url") || undefined,
      };
    }
    if (activeElement instanceof HTMLButtonElement) {
      const mode = activeElement.getAttribute("data-action");
      if (mode === "viewed" || mode === "edit" || mode === "delete") {
        return {
          target: "list",
          bookmarkUrl: activeElement.getAttribute("data-bookmark-url") || undefined,
          bookmarkAction: mode,
        };
      }
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
  if (focus.target === "collection") {
    collectionSelect.focus({ preventScroll: true });
    return;
  }
  if (focus.target === "manage-collections") {
    manageCollectionsButton.focus({ preventScroll: true });
    return;
  }
  if (focus.target === "list") {
    if (focus.bookmarkUrl && focus.bookmarkAction) {
      const actions = bookmarksListElement.querySelectorAll<HTMLButtonElement>(".bookmark-action");
      for (let index = 0; index < actions.length; index++) {
        const button = actions[index];
        if (
          button.getAttribute("data-bookmark-url") === focus.bookmarkUrl
          && button.getAttribute("data-action") === focus.bookmarkAction
        ) {
          button.focus({ preventScroll: true });
          return;
        }
      }
    }

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

  if (focus.target === "saved-date") {
    if (total > 0) {
      savedDateSelectElement.focus({ preventScroll: true });
    } else {
      focusHeading();
    }
    return;
  }

  if (focus.target === "view-status") {
    if (total > 0) {
      viewStatusSelectElement.focus({ preventScroll: true });
    } else {
      focusHeading();
    }
    return;
  }

  if (focus.target === "sort") {
    if (total > 0) {
      sortSelectElement.focus({ preventScroll: true });
    } else {
      focusHeading();
    }
    return;
  }

  const displayTarget = {
    "view-cards": cardsRadioElement,
    "view-list": listRadioElement,
    filters: toggleFiltersElement,
  };
  if (focus.target === "view-cards" || focus.target === "view-list" || focus.target === "filters") {
    if (total > 0) {
      displayTarget[focus.target].focus({ preventScroll: true });
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

function restoreManagementFocus(action: ManagementAction): void {
  if (!library) {
    retryButtonElement.focus({ preventScroll: true });
    return;
  }

  const buttons = bookmarksListElement.querySelectorAll<HTMLButtonElement>(".bookmark-action");
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    if (
      button.getAttribute("data-bookmark-url") === action.url
      && button.getAttribute("data-action") === action.mode
    ) {
      button.focus({ preventScroll: true });
      return;
    }
  }

  if (library.length === 0) {
    focusHeading();
    return;
  }

  const links = bookmarksListElement.querySelectorAll<HTMLAnchorElement>(".bookmark-link");
  if (links.length === 0) {
    searchInputElement.focus({ preventScroll: true });
    return;
  }

  const nearbyIndex = Math.min(action.index, links.length - 1);
  links[nearbyIndex].focus({ preventScroll: true });
}

function updateDomainOptions(bookmarks: readonly Bookmark[]): string {
  const groups = groupBookmarks(bookmarks);
  let notice = "";

  if (selection.kind === "domain" && !groups.domains.has(selection.domain)) {
    selection = { kind: "all" };
    notice = "Domain group no longer available. Showing all domains; other filters kept.";
  }

  const options = document.createDocumentFragment();
  options.appendChild(new Option(`All bookmarks (${bookmarks.length})`, "all"));
  options.appendChild(new Option(`General (${groups.general.length})`, "general"));
  const domains = Array.from(groups.domains.keys()).sort();
  domains.forEach((domain) => {
    const members = groups.domains.get(domain) ?? [];
    options.appendChild(new Option(`${domain} (${members.length})`, `domain:${domain}`));
  });

  domainSelectElement.replaceChildren(options);
  domainSelectElement.value = selection.kind === "domain"
    ? `domain:${selection.domain}`
    : selection.kind;

  return notice;
}

function updateCollectionOptions(): string {
  let notice = "";
  const selectedId = collectionScope.slice("collection:".length);
  if (collectionScope.startsWith("collection:") && !collections.some(({ id }) => id === selectedId)) {
    collectionScope = "all";
    notice = "Collection removed. Showing all bookmarks with the current search and filters.";
  }
  collectionOptions(collectionSelect, collections, collectionScope, "scope");
  return notice;
}

function inCollectionScope(bookmark: Bookmark): boolean {
  if (collectionScope === "all") {
    return true;
  }
  if (collectionScope === "unsorted") {
    return bookmark.collectionId === undefined;
  }
  return bookmark.collectionId === collectionScope.slice("collection:".length);
}

function bookmarkCount(count: number): string {
  return `${count} ${count === 1 ? "bookmark" : "bookmarks"}`;
}

function updateFilterControls(savedDate: SavedDateSelection): number {
  const states: readonly [HTMLSelectElement, boolean][] = [
    [domainSelectElement, selection.kind !== "all"],
    [savedDateSelectElement, savedDate !== "all"],
    [viewStatusSelectElement, viewStatusSelection !== "all"],
  ];
  let active = 0;
  states.forEach(([control, selected]) => {
    control.setAttribute("data-active", String(selected));
    if (selected) {
      active++;
    }
  });
  filterCountElement.textContent = String(active);
  filterCountElement.hidden = active === 0;
  toggleFiltersElement.setAttribute("aria-label", active ? `Filters, ${active} active` : "Filters");
  toggleFiltersElement.setAttribute("data-active", String(active > 0));
  return active;
}

function render(notice = "", focus: FocusSnapshot = captureFocus(), now = Date.now()): void {
  if (!library) {
    return;
  }

  const savedDate = savedDateSelectElement.value as SavedDateSelection;
  const matches = filterBookmarks(library, {
    query: searchInputElement.value,
    selection,
    savedDate,
    viewStatus: viewStatusSelection,
    sort: sortOrder,
    now,
  }).filter(inCollectionScope);
  // Domain grouping must use the whole library, never the collection subset.
  const scopeSize = library.filter(inCollectionScope).length;

  const rows = document.createDocumentFragment();
  matches.forEach((bookmark) => {
    rows.appendChild(bookmarkCard(bookmark, bookmarkView, pendingViewed.has(bookmark.url)));
  });
  bookmarkPreviews.clear();
  bookmarksListElement.replaceChildren(rows);

  const isEmpty = library.length === 0;
  const scopeEmpty = collectionScope !== "all" && scopeSize === 0;
  const hasNoMatches = scopeSize > 0 && matches.length === 0;
  const activeFilters = updateFilterControls(savedDate);
  const filtered = collectionScope !== "all" || activeFilters > 0 || searchInputElement.value.trim() !== "";
  let heading: string;
  if (collectionScope === "unsorted") {
    heading = "Unsorted";
  } else if (collectionScope.startsWith("collection:")) {
    const selectedId = collectionScope.slice("collection:".length);
    heading = collections.find(({ id }) => id === selectedId)?.name ?? "All bookmarks";
  } else if (selection.kind === "all") {
    heading = "All bookmarks";
  } else if (selection.kind === "general") {
    heading = "General";
  } else {
    heading = selection.domain;
  }

  libraryHeadingElement.textContent = heading;
  let statusText = bookmarkCount(library.length);
  if (filtered) {
    statusText = `${matches.length} of ${library.length} bookmarks`;
  }
  if (notice) {
    statusText = `${notice} ${statusText}`;
  }
  libraryStatusElement.textContent = statusText;
  libraryControlsElement.hidden = isEmpty;
  emptyStateElement.hidden = !isEmpty || collectionScope !== "all";
  collectionEmpty.hidden = !scopeEmpty;
  collectionEmptyTitle.textContent = collectionScope === "unsorted"
    ? "No unsorted bookmarks"
    : "No bookmarks in this collection";
  let emptyCopy = "Save a page to this collection, or use the pen action to move a saved bookmark here.";
  if (collectionScope === "unsorted") {
    emptyCopy = isEmpty
      ? "Choose Unsorted in the popup's Save to control to save a page outside a collection."
      : "All saved bookmarks are in collections. Choose Unsorted when saving or editing a bookmark to move it here.";
  }
  collectionEmptyCopy.textContent = emptyCopy;
  noMatchesElement.hidden = !hasNoMatches;
  bookmarksListElement.hidden = matches.length === 0;
  bookmarksListElement.setAttribute("aria-busy", "false");
  libraryErrorElement.hidden = true;

  bookmarkPreviews.observe();
  savedDateRefresh.update(isEmpty ? "all" : savedDate, now);
  restoreFocus(focus);
}

async function readAndRenderBookmarks(): Promise<void> {
  const currentRevision = ++revision;
  bookmarksListElement.setAttribute("aria-busy", "true");
  libraryStatusElement.textContent = hasLoaded ? "Updating bookmarks…" : "Loading your bookmarks…";

  try {
    const data = await readLibrary();
    if (currentRevision !== revision) {
      return;
    }

    const focus = captureFocus();
    library = data.bookmarks;
    collections = data.collections;
    const notices = [updateDomainOptions(library), updateCollectionOptions()].filter(Boolean);
    management.updateTarget();
    collectionManagement.update();
    collectionSelect.disabled = false;
    manageCollectionsButton.disabled = false;
    searchInputElement.disabled = false;
    domainSelectElement.disabled = false;
    savedDateSelectElement.disabled = false;
    viewStatusSelectElement.disabled = false;
    sortSelectElement.disabled = false;
    cardsRadioElement.disabled = false;
    listRadioElement.disabled = false;
    toggleFiltersElement.disabled = false;
    resetFiltersButton.disabled = false;
    hasLoaded = true;
    render(notices.join(" "), focus);
  } catch (error) {
    if (currentRevision !== revision) {
      return;
    }

    const focus = captureFocus();
    console.error("Could not read saved bookmarks.", error);
    library = undefined;
    bookmarkPreviews.clear();
    savedDateRefresh.update("all");
    libraryStatusElement.textContent = "Couldn't load your bookmarks.";
    readErrorElement.textContent = "Couldn't load your bookmarks. Try again.";
    libraryErrorElement.hidden = false;
    emptyStateElement.hidden = true;
    collectionEmpty.hidden = true;
    collectionSelect.disabled = true;
    manageCollectionsButton.disabled = true;
    noMatchesElement.hidden = true;
    bookmarksListElement.hidden = true;
    bookmarksListElement.setAttribute("aria-busy", "false");
    searchInputElement.disabled = true;
    domainSelectElement.disabled = true;
    savedDateSelectElement.disabled = true;
    viewStatusSelectElement.disabled = true;
    sortSelectElement.disabled = true;
    cardsRadioElement.disabled = true;
    listRadioElement.disabled = true;
    toggleFiltersElement.disabled = true;
    resetFiltersButton.disabled = true;

    if (
      focus.target === "list"
      || focus.target === "search"
      || focus.target === "domain"
      || focus.target === "collection"
      || focus.target === "manage-collections"
      || focus.target === "saved-date"
      || focus.target === "view-status"
      || focus.target === "sort"
      || focus.target === "view-cards"
      || focus.target === "view-list"
      || focus.target === "filters"
      || focus.target === "reset"
    ) {
      retryButtonElement.focus({ preventScroll: true });
    }
  }
}

const bookmarkPreviews = initializeBookmarkPreviews(bookmarksListElement);
const { refresh: refreshBookmarks, schedule: scheduleBookmarkRefresh } = createRefreshScheduler(readAndRenderBookmarks);

const savedDateRefresh = initializeSavedDateRefresh((now) => {
  const reading = bookmarksListElement.getAttribute("aria-busy") === "true";
  const loadingStatus = libraryStatusElement.textContent;
  render("", captureFocus(), now);
  // A calendar-only render must not clear an in-flight storage read's feedback
  if (reading) {
    bookmarksListElement.setAttribute("aria-busy", "true");
    libraryStatusElement.textContent = loadingStatus;
  }
});

function showManagementFeedback(message: string): void {
  managementFeedbackElement.textContent = message;
  managementFeedbackElement.hidden = false;
}

function clearManagementFeedback(): void {
  managementFeedbackElement.textContent = "";
  managementFeedbackElement.hidden = true;
}

const collectionManagement = initializeCollections({
  getCollections: () => library ? collections : undefined,
  refresh: refreshBookmarks,
  showFeedback: showManagementFeedback,
  clearFeedback: clearManagementFeedback,
});

const management = initializeManagement({
  getBookmarks: () => library,
  getCollections: () => collections,

  refresh: refreshBookmarks,
  restoreFocus: restoreManagementFocus,

  showFeedback: showManagementFeedback,
  clearFeedback: clearManagementFeedback,
});

initializeExport();
initializeImport({ refresh: refreshBookmarks });

async function setBookmarkViewed(button: HTMLButtonElement, url: string): Promise<void> {
  const targetStatus = button.getAttribute("data-viewed");
  if ((targetStatus !== "true" && targetStatus !== "false") || pendingViewed.has(url)) {
    return;
  }

  const focus = captureFocus();
  const wasFocused = document.activeElement === button;
  const viewed = targetStatus === "true";
  pendingViewed.add(url);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  viewedErrorElement.hidden = true;
  viewedFeedbackElement.textContent = "Saving status…";

  try {
    const result = await updateBookmarkViewed(url, viewed);
    await refreshBookmarks();
    if (result.status === "not-found") {
      viewedFeedbackElement.textContent = "";
      viewedErrorElement.textContent = "This bookmark is no longer saved. The library has been refreshed.";
      viewedErrorElement.hidden = false;
    } else {
      viewedFeedbackElement.textContent = `Marked “${result.bookmark.title}” as ${viewed ? "Viewed" : "To view"}.`;
    }
  } catch (cause) {
    viewedFeedbackElement.textContent = "";
    if (cause instanceof InvalidStoredBookmarkError) {
      viewedErrorElement.textContent = "This bookmark's saved data is invalid. Its status hasn't been changed.";
    } else if (cause instanceof StorageQuotaError) {
      viewedErrorElement.textContent = "Storage is full. Export a backup, free some space, then use the status button to retry.";
    } else {
      viewedErrorElement.textContent = "Couldn't save status. No change was confirmed; use the status button to retry.";
    }
    viewedErrorElement.hidden = false;
  } finally {
    pendingViewed.delete(url);
    const activeElement = document.activeElement;
    const recoverActionFocus = wasFocused && (
      activeElement === button
      || activeElement === document.body
      || activeElement === libraryHeadingElement
      || (activeElement instanceof HTMLButtonElement
        && activeElement.getAttribute("data-bookmark-url") === url
        && activeElement.getAttribute("data-action") === "viewed")
    );
    render("", recoverActionFocus ? focus : captureFocus());
    if (recoverActionFocus && !library) {
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

viewStatusSelectElement.addEventListener("change", () => {
  const value = viewStatusSelectElement.value;
  viewStatusSelection = value === "to-view" || value === "viewed" ? value : "all";
  viewStatusSelectElement.value = viewStatusSelection;
  render();
});

savedDateSelectElement.addEventListener("change", () => {
  render();
});

libraryControlsElement.addEventListener("submit", (event) => {
  event.preventDefault();
});

collectionSelect.addEventListener("change", () => {
  collectionScope = collectionSelect.value;
  render();
});

function resetSelections(): void {
  collectionScope = "all";
  collectionSelect.value = "all";
  searchInputElement.value = "";
  selection = { kind: "all" };
  domainSelectElement.value = "all";
  savedDateSelectElement.value = "all";
  viewStatusSelection = "all";
  viewStatusSelectElement.value = "all";
  render();
  if (library?.length) {
    searchInputElement.focus({ preventScroll: true });
  } else {
    focusHeading();
  }
}

resetFiltersButton.addEventListener("click", resetSelections);
clearCollectionButton.addEventListener("click", resetSelections);

bookmarksListElement.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button.bookmark-action[data-action]");
  if (!button || button.disabled || !bookmarksListElement.contains(button)) {
    return;
  }

  const url = button.getAttribute("data-bookmark-url");
  const mode = button.getAttribute("data-action");
  if (!url) {
    return;
  }

  let cardIndex = 0;
  for (let index = 0; index < bookmarksListElement.children.length; index++) {
    if (bookmarksListElement.children[index].contains(button)) {
      cardIndex = index;
      break;
    }
  }

  if (mode === "viewed") {
    void setBookmarkViewed(button, url);
  } else if (mode === "edit" || mode === "delete") {
    management.open(url, mode, cardIndex);
  }
});

retryButtonElement.addEventListener("click", () => {
  void refreshBookmarks();
});

window.azkmarkLibraryPreference<BookmarkSort>({
  key: "azkmark.library.sort",
  fallback: "newest",
  values: ["oldest", "title-asc", "title-desc"],
  apply: (next) => {
    if (sortOrder !== next) {
      sortOrder = next;
      render();
    }
  },
})([sortSelectElement]);

window.azkmarkLibraryPreference<BookmarkView>({
  key: "azkmark.library.view",
  fallback: "cards",
  values: ["list"],
  apply: (next) => {
    if (bookmarkView !== next) {
      bookmarkView = next;
      bookmarksListElement.setAttribute("data-view", next);
      render();
    }
  },
})([cardsRadioElement, listRadioElement]);

function setFiltersOpen(open: boolean): void {
  if (!open && filtersElement.contains(document.activeElement)) {
    toggleFiltersElement.focus({ preventScroll: true });
  }
  filtersElement.hidden = !open;
  toggleFiltersElement.setAttribute("aria-expanded", String(open));
}

toggleFiltersElement.addEventListener("click", () => {
  setFiltersOpen(filtersElement.hidden);
});

libraryControlsElement.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !filtersElement.hidden && filtersElement.contains(document.activeElement)) {
    event.preventDefault();
    setFiltersOpen(false);
  }
});

watchBookmarks(scheduleBookmarkRefresh);

void refreshBookmarks();
