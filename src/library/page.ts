import type { Bookmark } from "../bookmarks/model.js";
import type { Collection } from "../bookmarks/collections.js";
import { filterBookmarks } from "../bookmarks/search.js";
import { readLibrary, watchBookmarks } from "../bookmarks/storage.js";
import { requireElement } from "../ui/dom.js";
import { createRefreshScheduler } from "../shared/refresh-scheduler.js";
import { initializeCollections } from "./collections/collection-manager.js";
import { initializeLibraryFilters, inCollectionScope } from "./filters.js";
import { initializeLibraryFocus } from "./focus.js";
import type { FocusSnapshot } from "./focus.js";
import { initializeExport } from "./io/export.js";
import { initializeImport } from "./io/import.js";
import { initializeLibraryView } from "./view.js";
import { initializeManagement } from "./workspace/bookmark-dialog.js";
import { reconcileSelection } from "./workspace/selection.js";
import { initializeViewedStatus } from "./workspace/viewed-status.js";

export function initializeLibrary(): void {
  let library: Bookmark[] | undefined;
  let collections: Collection[] = [];
  let selectedUrl: string | undefined;
  let hasLoaded = false;

  const filters = initializeLibraryFilters({
    onChange: () => render(),
    onReset: () => focus.reset(),
    isAvailable: () => library !== undefined,
  });
  const view = initializeLibraryView((now) => render("", focus.capture(), now), () => refresh());
  const focus = initializeLibraryFocus({ ...filters.elements, ...view.elements }, () => ({
    library,
    selectedUrl,
    collectionScope: filters.read().collectionScope,
  }));
  const { refresh, schedule } = createRefreshScheduler(readAndRenderBookmarks);
  const viewedStatus = initializeViewedStatus({
    refresh,
    render: (snapshot) => render("", snapshot),
    focus,
  });
  const managementFeedbackElement = requireElement<HTMLParagraphElement>("#management-feedback");

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
    refresh,
    showFeedback: showManagementFeedback,
    clearFeedback: clearManagementFeedback,
  });
  const management = initializeManagement({
    getBookmarks: () => library,
    getCollections: () => collections,
    refresh,
    restoreFocus: focus.restoreManagement,
    showFeedback: showManagementFeedback,
    clearFeedback: clearManagementFeedback,
  });

  function render(notice = "", snapshot?: FocusSnapshot, now = Date.now()): void {
    if (!library) {
      return;
    }
    const previousFocus = snapshot ?? focus.capture();
    const filterState = filters.render();
    const inScope = (bookmark: Bookmark) => inCollectionScope(bookmark, filterState.collectionScope);
    // Domain grouping uses the whole library before applying collection scope.
    const matches = filterBookmarks(library, { ...filterState, now }).filter(inScope);
    const selectedBookmark = reconcileSelection(matches, library, selectedUrl, view.previousUrls());
    selectedUrl = selectedBookmark?.url;
    const active = document.activeElement;
    const noteFocus = active instanceof HTMLElement && active.closest(".bookmark-notes") ? active : undefined;
    view.render({
      library,
      collections,
      filters: filterState,
      matches,
      selectedBookmark,
      scopeSize: library.filter(inScope).length,
      savingViewStatus: selectedBookmark !== undefined && viewedStatus.isPending(selectedBookmark.url),
      notice,
      now,
    });
    if (noteFocus?.isConnected) noteFocus.focus({ preventScroll: true });
    else focus.restore(previousFocus);
  }

  async function readAndRenderBookmarks(): Promise<void> {
    view.showLoading(hasLoaded);
    try {
      const data = await readLibrary();
      const previousFocus = focus.capture();
      library = data.bookmarks;
      collections = data.collections;
      // A fresh snapshot may change any detail field or its collection name.
      view.invalidateDetails();
      const notice = filters.update(library, collections);
      management.updateTarget();
      collectionManagement.update();
      filters.setDisabled(false);
      hasLoaded = true;
      render(notice, previousFocus);
    } catch (error) {
      const previousFocus = focus.capture();
      console.error("Could not read saved bookmarks.", error);
      library = undefined;
      selectedUrl = undefined;
      view.showError();
      filters.setDisabled(true);
      focus.restoreAfterReadError(previousFocus);
    }
  }

  initializeExport();
  initializeImport({ refresh });
  const backupDialogElement = requireElement<HTMLDialogElement>("#backup-dialog");
  const backupHelpButtonElement = requireElement<HTMLButtonElement>("#open-backup-help");
  backupHelpButtonElement.addEventListener("click", () => {
    backupDialogElement.showModal();
  });

  const { bookmarksListElement, bookmarkDetailsElement, workspaceElement, retryButtonElement } = view.elements;
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
    view.announceSelection(bookmark);
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
      void viewedStatus.update(button, url);
    } else if (mode === "edit" || mode === "delete") {
      management.open(url, mode);
    }
  });
  retryButtonElement.addEventListener("click", () => {
    void refresh();
  });

  watchBookmarks(schedule);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      schedule();
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      schedule();
    }
  });
  void refresh();
}
