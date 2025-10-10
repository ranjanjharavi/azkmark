import { groupBookmarks } from "./bookmarks/domains.js";
import type { Bookmark } from "./bookmarks/model.js";
import type { Collection } from "./bookmarks/collections.js";
import { availableTags } from "./bookmarks/tags.js";
import { requireElement } from "./ui/dom.js";
import { collectionButtons } from "./library/collection-navigation.js";
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
import { bookmarkRow } from "./library/bookmark-row.js";
import { bookmarkDetails } from "./library/bookmark-details.js";
import { initializeBookmarkPreviews } from "./library/bookmark-preview.js";
import { initializeExport } from "./library/export.js";
import { initializeImport } from "./library/import.js";
import { initializeManagement } from "./library/management.js";
import { createRefreshScheduler } from "./library/refresh.js";
import { initializeSavedDateRefresh } from "./library/saved-date-refresh.js";
import { createSavedDateFormatter } from "./library/saved-date.js";
import { initializeSortPreference } from "./library/sort-preference.js";
import { reconcileSelection } from "./library/selection.js";
import { focusBookmarkRow, focusDetailAction } from "./library/focus.js";
import type { FocusSnapshot } from "./library/focus.js";
import type { ManagementAction } from "./library/management.js";

const backupHelpButtonElement = requireElement<HTMLButtonElement>("#open-backup-help");
const backupDialogElement = requireElement<HTMLDialogElement>("#backup-dialog");
const collectionNavigationElement = requireElement<HTMLElement>("#collection-navigation");
const manageCollectionsButton = requireElement<HTMLButtonElement>("#manage-collections");
const collectionEmpty = requireElement<HTMLElement>("#collection-empty");
const collectionEmptyTitle = requireElement<HTMLHeadingElement>("#collection-empty-title");
const collectionEmptyCopy = requireElement<HTMLParagraphElement>("#collection-empty-copy");
const clearCollectionButton = requireElement<HTMLButtonElement>("#clear-collection");
const tagSelect = requireElement<HTMLSelectElement>("#tag-filter");
const libraryHeadingElement = requireElement<HTMLHeadingElement>("#library-heading");
const libraryTotalElement = requireElement<HTMLParagraphElement>("#library-total");
const libraryStatusElement = requireElement<HTMLParagraphElement>("#library-status");
const libraryControlsElement = requireElement<HTMLFormElement>("#library-controls");
const libraryDisplayControlsElement = requireElement<HTMLDivElement>("#library-display-controls");
const searchInputElement = requireElement<HTMLInputElement>("#search");
const domainSelectElement = requireElement<HTMLSelectElement>("#domain");
const savedDateSelectElement = requireElement<HTMLSelectElement>("#saved-date");
const viewStatusSelectElement = requireElement<HTMLSelectElement>("#view-status");
const sortSelectElement = requireElement<HTMLSelectElement>("#sort-by");
const toggleFiltersElement = requireElement<HTMLButtonElement>("#toggle-filters");
const filtersElement = requireElement<HTMLDivElement>("#library-filters");
const filterCountElement = requireElement<HTMLSpanElement>("#filter-count");
const emptyStateElement = requireElement<HTMLElement>("#library-empty");
const noMatchesElement = requireElement<HTMLElement>("#no-matches");
const resetFiltersButton = requireElement<HTMLButtonElement>("#reset-filters");
const managementFeedbackElement = requireElement<HTMLParagraphElement>("#management-feedback");
const viewedFeedbackElement = requireElement<HTMLParagraphElement>("#viewed-feedback");
const viewedErrorElement = requireElement<HTMLParagraphElement>("#viewed-error");
const libraryErrorElement = requireElement<HTMLDivElement>("#library-error");
const readErrorElement = requireElement<HTMLParagraphElement>("#read-error");
const retryButtonElement = requireElement<HTMLButtonElement>("#retry");
const workspaceElement = requireElement<HTMLDivElement>("#bookmark-workspace");
const bookmarksListElement = requireElement<HTMLUListElement>("#bookmarks");
const bookmarkDetailsElement = requireElement<HTMLElement>("#bookmark-details");
const selectionFeedbackElement = requireElement<HTMLParagraphElement>("#selection-feedback");

let library: Bookmark[] | undefined;
let collections: Collection[] = [];
let collectionScope = "all";
let selection: BookmarkSelection = { kind: "all" };
let viewStatusSelection: ViewStatusSelection = "all";
let tagSelection = "";
let sortOrder: BookmarkSort = "newest";
let selectedUrl: string | undefined;
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
  if (
    activeElement instanceof HTMLButtonElement
    && collectionNavigationElement.contains(activeElement)
    && activeElement.hasAttribute("value")
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
    filters: toggleFiltersElement,
  };
  if (
    focus.target === "search"
    || focus.target === "domain"
    || focus.target === "saved-date"
    || focus.target === "view-status"
    || focus.target === "tag"
    || focus.target === "sort"
    || focus.target === "filters"
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
  if (!library) {
    retryButtonElement.focus({ preventScroll: true });
    return;
  }

  if (focusDetailAction(bookmarkDetailsElement, action.url, action.mode)) {
    return;
  }
  focusSelectedBookmark();
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

function updateTagOptions(bookmarks: readonly Bookmark[]): void {
  const vocabulary = availableTags(bookmarks);
  const options = document.createDocumentFragment();
  options.appendChild(new Option("All tags", ""));

  if (vocabulary.length > 0) {
    const group = document.createElement("optgroup");
    group.label = "Tags";

    vocabulary.forEach((tag) => {
      group.appendChild(new Option(tag, tag));
    });
    options.appendChild(group);
  }

  // Keep a vanished selection explicit, rather than silently broadening results
  if (tagSelection && !vocabulary.includes(tagSelection)) {
    const missing = new Option(`${tagSelection} — no saved bookmarks`, tagSelection);
    missing.disabled = true;
    options.appendChild(missing);
  }
  
  tagSelect.replaceChildren(options);
  tagSelect.value = tagSelection;
}

function updateCollectionNavigation(bookmarks: readonly Bookmark[]): string {
  let notice = "";
  const selectedId = collectionScope.slice("collection:".length);
  if (collectionScope.startsWith("collection:") && !collections.some(({ id }) => id === selectedId)) {
    collectionScope = "all";
    notice = "Collection removed. Showing all bookmarks with the current search and filters.";
  }
  collectionNavigationElement.replaceChildren(
    collectionButtons(collections, bookmarks, collectionScope),
    manageCollectionsButton,
  );
  return notice;
}

function updateCollectionControls(disabled: boolean): void {
  const buttons = collectionNavigationElement.querySelectorAll<HTMLButtonElement>("button[value]");
  buttons.forEach((button) => {
    button.disabled = disabled;
    button.setAttribute("aria-pressed", String(button.value === collectionScope));
  });
  manageCollectionsButton.disabled = disabled;
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
    [tagSelect, tagSelection !== ""],
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

  updateCollectionControls(false);
  const savedDate = savedDateSelectElement.value as SavedDateSelection;
  const matches = filterBookmarks(library, {
    query: searchInputElement.value,
    selection,
    savedDate,
    viewStatus: viewStatusSelection,
    tag: tagSelection,
    sort: sortOrder,
    now,
  }).filter(inCollectionScope);
  // Domain grouping must use the whole library, never the collection subset.
  const scopeSize = library.filter(inCollectionScope).length;

  const previousUrls = Array.from(
    bookmarksListElement.querySelectorAll<HTMLButtonElement>(".bookmark-select"),
    (button) => button.getAttribute("data-bookmark-url") ?? "",
  );
  const selectedBookmark = reconcileSelection(matches, library, selectedUrl, previousUrls);
  selectedUrl = selectedBookmark?.url;
  const rows = document.createDocumentFragment();
  if (matches.length > 0) {
    const dateFormatter = createSavedDateFormatter();
    matches.forEach((bookmark) => {
      const row = bookmarkRow(bookmark, bookmark.url === selectedUrl, now, dateFormatter);
      rows.appendChild(row);
    });
  }
  bookmarkPreviews.clear();
  bookmarksListElement.replaceChildren(rows);
  bookmarkDetailsElement.replaceChildren();
  if (selectedBookmark) {
    const savingViewStatus = pendingViewed.has(selectedBookmark.url);
    const details = bookmarkDetails(selectedBookmark, collections, savingViewStatus);
    bookmarkDetailsElement.appendChild(details);
  }
  selectionFeedbackElement.textContent = "";

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
  const referenceLabel = library.length === 1 ? "saved reference" : "saved references";
  libraryTotalElement.textContent = `${library.length} ${referenceLabel}`;
  libraryTotalElement.hidden = false;
  let statusText = bookmarkCount(library.length);
  if (filtered) {
    statusText = `${matches.length} of ${library.length} bookmarks`;
  }
  if (notice) {
    statusText = `${notice} ${statusText}`;
  }
  libraryStatusElement.textContent = statusText;
  libraryControlsElement.hidden = isEmpty;
  libraryDisplayControlsElement.hidden = isEmpty;
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
  workspaceElement.hidden = matches.length === 0;
  bookmarksListElement.setAttribute("aria-busy", "false");
  libraryErrorElement.hidden = true;

  bookmarkPreviews.observe();
  savedDateRefresh.update(!isEmpty, now);
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
    const notices = [updateDomainOptions(library), updateCollectionNavigation(library)].filter(Boolean);
    updateTagOptions(library);
    management.updateTarget();
    collectionManagement.update();
    searchInputElement.disabled = false;
    domainSelectElement.disabled = false;
    savedDateSelectElement.disabled = false;
    viewStatusSelectElement.disabled = false;
    tagSelect.disabled = false;
    sortSelectElement.disabled = false;
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
    selectedUrl = undefined;
    libraryTotalElement.hidden = true;
    bookmarkPreviews.clear();
    savedDateRefresh.update(false);
    libraryStatusElement.textContent = "";
    readErrorElement.textContent = "Couldn't load your bookmarks. Try again.";
    libraryErrorElement.hidden = false;
    emptyStateElement.hidden = true;
    collectionEmpty.hidden = true;
    updateCollectionControls(true);
    noMatchesElement.hidden = true;
    workspaceElement.hidden = true;
    bookmarksListElement.replaceChildren();
    bookmarkDetailsElement.replaceChildren();
    selectionFeedbackElement.textContent = "";
    bookmarksListElement.setAttribute("aria-busy", "false");
    searchInputElement.disabled = true;
    domainSelectElement.disabled = true;
    savedDateSelectElement.disabled = true;
    viewStatusSelectElement.disabled = true;
    tagSelect.disabled = true;
    sortSelectElement.disabled = true;
    toggleFiltersElement.disabled = true;
    resetFiltersButton.disabled = true;

    if (
      focus.target === "list"
      || focus.target === "details"
      || focus.target === "search"
      || focus.target === "domain"
      || focus.target === "collection"
      || focus.target === "manage-collections"
      || focus.target === "saved-date"
      || focus.target === "view-status"
      || focus.target === "tag"
      || focus.target === "sort"
      || focus.target === "filters"
      || focus.target === "reset"
    ) {
      retryButtonElement.focus({ preventScroll: true });
    }
  }
}

const bookmarkPreviews = initializeBookmarkPreviews(bookmarkDetailsElement);
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
  getBookmarks: () => library,
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

backupHelpButtonElement.addEventListener("click", () => {
  backupDialogElement.showModal();
});

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
        && (activeElement.getAttribute("data-action") === "viewed"
          || activeElement.classList.contains("bookmark-select")))
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

tagSelect.addEventListener("change", () => {
  tagSelection = tagSelect.value;
  render();
});

savedDateSelectElement.addEventListener("change", () => {
  render();
});

libraryControlsElement.addEventListener("submit", (event) => {
  event.preventDefault();
});

collectionNavigationElement.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !library) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button[value]");
  if (!button || button.disabled || !collectionNavigationElement.contains(button)) {
    return;
  }

  collectionScope = button.value;
  render();
});

function resetSelections(): void {
  collectionScope = "all";
  searchInputElement.value = "";
  selection = { kind: "all" };
  domainSelectElement.value = "all";
  savedDateSelectElement.value = "all";
  viewStatusSelection = "all";
  viewStatusSelectElement.value = "all";
  tagSelection = "";
  tagSelect.value = "";
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
  if (!(target instanceof Element) || !library) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button.bookmark-select");
  if (!button || button.disabled || !bookmarksListElement.contains(button)) {
    return;
  }

  const url = button.getAttribute("data-bookmark-url");
  const bookmark = library.find((record) => record.url === url);
  if (!bookmark || selectedUrl === bookmark.url) {
    return;
  }

  selectedUrl = bookmark.url;
  render();
  selectionFeedbackElement.textContent = `Selected “${bookmark.title}”.`;
});

bookmarkDetailsElement.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !library || workspaceElement.hidden) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("button.bookmark-action[data-action]");
  if (!button || button.disabled || !bookmarkDetailsElement.contains(button)) {
    return;
  }

  const url = button.getAttribute("data-bookmark-url");
  const mode = button.getAttribute("data-action");
  if (!url || url !== selectedUrl) {
    return;
  }

  if (mode === "viewed") {
    void setBookmarkViewed(button, url);
  } else if (mode === "edit" || mode === "delete") {
    management.open(url, mode);
  }
});

retryButtonElement.addEventListener("click", () => {
  void refreshBookmarks();
});

initializeSortPreference(sortSelectElement, (next) => {
  if (sortOrder !== next) {
    sortOrder = next;
    render();
  }
});

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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    scheduleBookmarkRefresh();
  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    scheduleBookmarkRefresh();
  }
});

void refreshBookmarks();
