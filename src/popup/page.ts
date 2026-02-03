import { createBookmark } from "../bookmarks/model.js";
import {
  MissingCollectionError,
  readCollections,
  readLastCollection,
  readLibrary,
  StorageQuotaError,
  saveBookmark,
  watchBookmarks,
} from "../bookmarks/storage.js";
import type { Collection } from "../bookmarks/collections.js";
import { availableTags } from "../bookmarks/tags.js";
import { initializeTagInput } from "../ui/tag-input.js";
import { collectionOptions } from "../ui/collection-options.js";
import { requireElement } from "../ui/dom.js";
import { createRefreshScheduler } from "../shared/refresh-scheduler.js";
import { captureThumbnail } from "./thumbnail.js";
import { captureCurrentPage } from "./page-capture.js";
import type { CurrentPage } from "./page-capture.js";
import { openLibrary } from "./open-library.js";

export function initializePopup(): void {
  const saveTo = requireElement<HTMLSelectElement>("#save-to");
  const collectionError = requireElement<HTMLParagraphElement>("#save-to-error");
  const openLibraryButtonElement = requireElement<HTMLButtonElement>("#open-library");
  const feedbackElement = requireElement<HTMLParagraphElement>("#feedback");
  const pageStatusElement = requireElement<HTMLParagraphElement>("#page-status");
  const pageDetailsElement = requireElement<HTMLElement>("#page-details");
  const pageTitleElement = requireElement<HTMLTextAreaElement>("#page-title");
  const pageUrlElement = requireElement<HTMLAnchorElement>("#page-url");
  const pageImageElement = requireElement<HTMLImageElement>("#page-image");
  const previewStatusElement = requireElement<HTMLParagraphElement>("#preview-status");
  const saveFormElement = requireElement<HTMLFormElement>("#save-form");
  const saveButtonElement = requireElement<HTMLButtonElement>("#save");
  const titleErrorElement = requireElement<HTMLParagraphElement>("#title-error");
  const saveStatusElement = requireElement<HTMLParagraphElement>("#save-status");
  const saveErrorElement = requireElement<HTMLParagraphElement>("#save-error");

  const tagInput = initializeTagInput("page");
  let currentPage: CurrentPage | undefined;
  let thumbnailReady: Promise<string | undefined> = Promise.resolve(undefined);
  let imageTimeout: number | undefined;
  let saving = false;
  let completed = false;
  let collectionsReady = false;
  let collectionsAvailable = false;
  let collections: Collection[] = [];

  function updateSaveControls(): void {
    saveButtonElement.disabled = completed || saving || !currentPage || !collectionsReady;
    saveTo.disabled = completed || saving || !collectionsAvailable;
    tagInput.setDisabled(completed || saving);
  }

  async function readSaveCollections(): Promise<void> {
    const initial = !collectionsReady;
    try {
      const [definitions, remembered] = await Promise.all([
        readCollections(),
        initial ? readLastCollection() : Promise.resolve(""),
      ]);
      collections = definitions;
      let selected = saveTo.value;
      if (initial) {
        selected = collections.some(({ id }) => id === remembered) ? remembered : "";
      }

      // A removed draft stays visible, rather than silently saving to Unsorted
      collectionOptions(saveTo, collections, selected);
      collectionsAvailable = true;
      collectionError.hidden = true;
    } catch {
      collectionsAvailable = false;
      collectionError.textContent = initial
        ? "Couldn't load collections. Saving to Unsorted is still available; reopen the popup to retry."
        : "Couldn't refresh collections. The current choice is kept; reopen the popup to retry.";
      collectionError.hidden = false;
    } finally {
      collectionsReady = true;
      updateSaveControls();
    }
  }

  const collectionRefresh = createRefreshScheduler(readSaveCollections);
  const tagVocabularyRefresh = createRefreshScheduler(async () => {
    try {
      const { bookmarks } = await readLibrary();
      tagInput.updateVocabulary(availableTags(bookmarks));
    } catch {
      // Suggestions are optional; manual tags and saving remain available.
    }
  });

  function clearImageTimeout(): void {
    if (imageTimeout !== undefined) {
      window.clearTimeout(imageTimeout);
      imageTimeout = undefined;
    }
  }

  function showNoThumbnail(): void {
    clearImageTimeout();
    pageImageElement.hidden = true;
    pageImageElement.removeAttribute("src");
    previewStatusElement.textContent = "No thumbnail available.";
    previewStatusElement.hidden = false;
  }

  pageImageElement.addEventListener("load", () => {
    if (!pageImageElement.getAttribute("src")) {
      return;
    }

    clearImageTimeout();
    pageImageElement.hidden = false;
    previewStatusElement.hidden = true;
  });
  pageImageElement.addEventListener("error", showNoThumbnail);

  function showLibraryError(message: string): void {
    console.error("Could not open the bookmark library.", message);
    feedbackElement.textContent = "Couldn't open the library. Try Open library again; reload the extension if the problem continues.";
    feedbackElement.hidden = false;
  }

  openLibraryButtonElement.addEventListener("click", async () => {
    if (openLibraryButtonElement.disabled) {
      return;
    }
    const restoreFocus = document.activeElement === openLibraryButtonElement;
    openLibraryButtonElement.disabled = true;
    openLibraryButtonElement.setAttribute("aria-busy", "true");
    feedbackElement.hidden = true;

    try {
      await openLibrary();
    } catch (error) {
      showLibraryError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      openLibraryButtonElement.disabled = false;
      openLibraryButtonElement.setAttribute("aria-busy", "false");
      if (restoreFocus && document.activeElement === document.body) {
        openLibraryButtonElement.focus({ preventScroll: true });
      }
    }
  });

  pageTitleElement.addEventListener("input", () => {
    if (saving || completed) {
      return;
    }

    titleErrorElement.hidden = true;
    pageTitleElement.removeAttribute("aria-invalid");
    saveErrorElement.hidden = true;
  });

  saveFormElement.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentPage || !collectionsReady || saving || completed) {
      return;
    }

    const title = pageTitleElement.value.trim();
    if (!title) {
      titleErrorElement.hidden = false;
      pageTitleElement.setAttribute("aria-invalid", "true");
      pageTitleElement.focus();
      return;
    }

    if (saveTo.selectedOptions[0]?.disabled) {
      saveErrorElement.textContent = "This collection is no longer available. Choose another collection or Unsorted.";
      saveErrorElement.hidden = false;
      saveTo.focus();
      return;
    }

    const tags = tagInput.read();
    if (!tags) {
      return;
    }

    const collectionId = saveTo.value || undefined;
    const page = currentPage;
    const restoreSaveFocus = document.activeElement === saveButtonElement;
    const savedAt = Date.now();
    saving = true;
    updateSaveControls();
    saveButtonElement.textContent = "Saving…";
    pageTitleElement.readOnly = true;
    saveFormElement.setAttribute("aria-busy", "true");
    titleErrorElement.hidden = true;
    saveErrorElement.hidden = true;
    saveStatusElement.textContent = "Saving…";

    try {
      // Wait only for bounded metadata capture, never for the image to load.
      const thumbnailUrl = await thumbnailReady;
      const bookmark = createBookmark({
        url: page.url,
        title,
        thumbnailUrl,
        collectionId,
        tags: tags.length > 0 ? tags : undefined,
      }, savedAt);
      const result = await saveBookmark(bookmark, true);

      completed = true;
      pageTitleElement.value = result.bookmark.title;
      tagInput.set(result.bookmark.tags ?? []);
      collectionOptions(saveTo, collections, result.bookmark.collectionId ?? "");
      saveButtonElement.textContent = "Saved";
      saveStatusElement.textContent = result.status === "saved"
        ? "Saved."
        : "Already saved. Kept its saved details.";
    } catch (error) {
      saveStatusElement.textContent = "";
      if (error instanceof MissingCollectionError) {
        saveErrorElement.textContent = error.message;
        await collectionRefresh.refresh();
      } else if (error instanceof StorageQuotaError) {
        saveErrorElement.textContent = "Storage is full. This page wasn't saved.";
      } else {
        saveErrorElement.textContent = "Couldn't save this page. Your changes are kept; try again.";
      }
      saveErrorElement.hidden = false;
    } finally {
      saving = false;
      saveFormElement.setAttribute("aria-busy", "false");
      updateSaveControls();
      pageTitleElement.readOnly = completed;

      if (!completed) {
        saveButtonElement.textContent = "Save bookmark";
      }

      // Disabling a focused submit can move Chrome's focus to BODY
      if (restoreSaveFocus && document.activeElement?.tagName === "BODY") {
        (completed ? openLibraryButtonElement : saveButtonElement).focus({ preventScroll: true });
      }
    }
  });

  function initializePagePreview(): void {
    captureCurrentPage((result) => {
      if (result.status !== "ready") {
        pageStatusElement.textContent = result.message;
        return;
      }

      currentPage = result.page;
      pageTitleElement.value = result.page.title;
      pageUrlElement.textContent = new URL(result.page.url).hostname;
      pageUrlElement.href = result.page.url;
      pageUrlElement.title = result.page.url;
      pageUrlElement.setAttribute("aria-label", `Open current page: ${result.page.url}`);
      pageDetailsElement.hidden = false;
      pageStatusElement.hidden = true;
      updateSaveControls();

      thumbnailReady = new Promise((resolve) => {
        captureThumbnail(result.page, resolve);
      });

      thumbnailReady.then((thumbnailUrl) => {
        if (!thumbnailUrl) {
          showNoThumbnail();
          return;
        }

        previewStatusElement.textContent = "Loading thumbnail…";
        imageTimeout = window.setTimeout(showNoThumbnail, 1500);
        pageImageElement.src = thumbnailUrl;
      });
    });
  }

  saveTo.addEventListener("change", () => {
    saveErrorElement.hidden = true;
  });

  watchBookmarks(() => {
    collectionRefresh.schedule();
    tagVocabularyRefresh.schedule();
  });
  void collectionRefresh.refresh();
  void tagVocabularyRefresh.refresh();
  initializePagePreview();
}
