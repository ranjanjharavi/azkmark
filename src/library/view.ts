import type { Bookmark } from "../bookmarks/model.js";
import type { Collection } from "../bookmarks/collections.js";
import type { LibraryFilters } from "./filters.js";
import { requireElement } from "../ui/dom.js";
import { bookmarkRow } from "./workspace/bookmark-row.js";
import { bookmarkDetails, bookmarkMetadata } from "./workspace/bookmark-details.js";
import { initializeNotesPanel } from "./workspace/notes-panel.js";
import { renderNoteIcons } from "../ui/markdown.js";
import { initializeBookmarkPreviews } from "./workspace/bookmark-preview.js";
import { initializeSavedDateRefresh } from "./saved-date-refresh.js";
import { createSavedDateFormatter } from "./saved-date.js";

interface LibraryViewState {
  library: readonly Bookmark[];
  collections: readonly Collection[];
  filters: LibraryFilters;
  matches: readonly Bookmark[];
  selectedBookmark: Bookmark | undefined;
  scopeSize: number;
  savingViewStatus: boolean;
  notice: string;
  now: number;
}

export function initializeLibraryView(onDateChange: (now: number) => void, refresh: () => Promise<void>) {
  const collectionEmpty = requireElement<HTMLElement>("#collection-empty");
  const collectionEmptyTitle = requireElement<HTMLHeadingElement>("#collection-empty-title");
  const collectionEmptyCopy = requireElement<HTMLParagraphElement>("#collection-empty-copy");
  const libraryHeadingElement = requireElement<HTMLHeadingElement>("#library-heading");
  const libraryTotalElement = requireElement<HTMLParagraphElement>("#library-total");
  const libraryStatusElement = requireElement<HTMLParagraphElement>("#library-status");
  const libraryControlsElement = requireElement<HTMLFormElement>("#library-controls");
  const libraryDisplayControlsElement = requireElement<HTMLDivElement>("#library-display-controls");
  const emptyStateElement = requireElement<HTMLElement>("#library-empty");
  const noMatchesElement = requireElement<HTMLElement>("#no-matches");
  const libraryErrorElement = requireElement<HTMLDivElement>("#library-error");
  const readErrorElement = requireElement<HTMLParagraphElement>("#read-error");
  const retryButtonElement = requireElement<HTMLButtonElement>("#retry");
  const workspaceElement = requireElement<HTMLDivElement>("#bookmark-workspace");
  const bookmarksListElement = requireElement<HTMLUListElement>("#bookmarks");
  const bookmarkDetailsElement = requireElement<HTMLElement>("#bookmark-details");
  const selectionFeedbackElement = requireElement<HTMLParagraphElement>("#selection-feedback");
  let renderedDetailsKey: string | undefined;
  let renderedDetailsUrl: string | undefined;
  const notesPanel = initializeNotesPanel(refresh);

  function sizeWorkspace(): void {
    if (workspaceElement.hidden) return;
    const main = workspaceElement.parentElement!;
    const bottomInset = [
      window.getComputedStyle(main).paddingBottom,
      window.getComputedStyle(document.body).paddingBottom,
      window.getComputedStyle(main.parentElement!).borderBottomWidth,
    ].reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
    const top = workspaceElement.getBoundingClientRect().top + window.scrollY;
    const height = `${Math.floor(window.innerHeight - top - bottomInset)}px`;
    if (workspaceElement.style.getPropertyValue("--workspace-height") !== height) {
      workspaceElement.style.setProperty("--workspace-height", height);
    }
  }

  const layoutObserver = new ResizeObserver(sizeWorkspace);
  const main = workspaceElement.parentElement!;
  for (const child of main.children) {
    if (child !== workspaceElement) layoutObserver.observe(child);
  }
  layoutObserver.observe(requireElement<HTMLElement>(".library-app-header"));
  window.addEventListener("resize", sizeWorkspace);

  function bookmarkCount(count: number): string {
    return `${count} ${count === 1 ? "bookmark" : "bookmarks"}`;
  }

  function renderBookmarkDetails(
    bookmark: Bookmark | undefined,
    dateFormat: Intl.ResolvedDateTimeFormatOptions | undefined,
    collections: readonly Collection[],
    savingViewStatus: boolean,
  ): void {
    const key = JSON.stringify([bookmark?.url, savingViewStatus, dateFormat]);
    if (bookmark && key === renderedDetailsKey) {
      return;
    }

    const scrollTop = bookmark?.url === renderedDetailsUrl ? bookmarkDetailsElement.scrollTop : 0;
    renderedDetailsUrl = bookmark?.url;
    bookmarkPreviews.clear();
    bookmarkDetailsElement.replaceChildren();
    renderedDetailsKey = undefined;
    if (!bookmark) {
      return;
    }

    const panel = notesPanel.render(bookmark, bookmarkMetadata(bookmark, collections));
    const details = bookmarkDetails(bookmark, collections, savingViewStatus, panel);
    bookmarkDetailsElement.appendChild(details);
    renderNoteIcons(details);
    bookmarkDetailsElement.scrollTop = scrollTop;
    renderedDetailsKey = key;
  }

  function render({
    library,
    collections,
    filters,
    matches,
    selectedBookmark,
    scopeSize,
    savingViewStatus,
    notice,
    now,
  }: LibraryViewState): void {
    const { collectionScope, selection } = filters;
    const rows = document.createDocumentFragment();
    let dateFormat: Intl.ResolvedDateTimeFormatOptions | undefined;
    if (matches.length > 0) {
      const dateFormatter = createSavedDateFormatter();
      dateFormat = dateFormatter.resolvedOptions();
      matches.forEach((bookmark) => {
        const row = bookmarkRow(bookmark, bookmark.url === selectedBookmark?.url, now, dateFormatter);
        rows.appendChild(row);
      });
    }
    bookmarksListElement.replaceChildren(rows);
    renderBookmarkDetails(selectedBookmark, dateFormat, collections, savingViewStatus);
    selectionFeedbackElement.textContent = "";

    const isEmpty = library.length === 0;
    const scopeEmpty = collectionScope !== "all" && scopeSize === 0;
    const hasNoMatches = scopeSize > 0 && matches.length === 0;
    const activeFilters = filters.activeCount;
    const filtered = collectionScope !== "all" || activeFilters > 0 || filters.query.trim() !== "";
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

    sizeWorkspace();
    bookmarkPreviews.observe();
    savedDateRefresh.update(!isEmpty, now);
  }

  function showLoading(hasLoaded: boolean): void {
    bookmarksListElement.setAttribute("aria-busy", "true");
    libraryStatusElement.textContent = hasLoaded ? "Updating bookmarks…" : "Loading your bookmarks…";
  }

  function showError(): void {
    renderedDetailsKey = undefined;
    renderedDetailsUrl = undefined;
    libraryTotalElement.hidden = true;
    bookmarkPreviews.clear();
    savedDateRefresh.update(false);
    libraryStatusElement.textContent = "";
    readErrorElement.textContent = "Couldn't load your bookmarks. Try again.";
    libraryErrorElement.hidden = false;
    emptyStateElement.hidden = true;
    collectionEmpty.hidden = true;
    noMatchesElement.hidden = true;
    workspaceElement.hidden = true;
    bookmarksListElement.replaceChildren();
    bookmarkDetailsElement.replaceChildren();
    selectionFeedbackElement.textContent = "";
    bookmarksListElement.setAttribute("aria-busy", "false");
  }

  const bookmarkPreviews = initializeBookmarkPreviews(bookmarkDetailsElement);
  const savedDateRefresh = initializeSavedDateRefresh((now) => {
    const reading = bookmarksListElement.getAttribute("aria-busy") === "true";
    const loadingStatus = libraryStatusElement.textContent;
    onDateChange(now);
    // A calendar-only render must not clear an in-flight storage read's feedback.
    if (reading) {
      bookmarksListElement.setAttribute("aria-busy", "true");
      libraryStatusElement.textContent = loadingStatus;
    }
  });

  function previousUrls(): string[] {
    const buttons = bookmarksListElement.querySelectorAll<HTMLButtonElement>(".bookmark-select");
    return Array.from(buttons, (button) => button.getAttribute("data-bookmark-url") ?? "");
  }

  function invalidateDetails(): void {
    renderedDetailsKey = undefined;
  }

  function announceSelection(bookmark: Bookmark): void {
    selectionFeedbackElement.textContent = `Selected “${bookmark.title}”.`;
  }

  return {
    render,
    showLoading,
    showError,
    previousUrls,
    invalidateDetails,
    announceSelection,
    elements: {
      libraryHeadingElement,
      retryButtonElement,
      bookmarksListElement,
      bookmarkDetailsElement,
      workspaceElement,
    },
  };
}
