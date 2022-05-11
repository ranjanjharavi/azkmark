import { createBookmark } from "./bookmarks/model.js";
import {
  MissingCollectionError,
  readCollections,
  readLastCollection,
  StorageQuotaError,
  saveBookmark,
  watchBookmarks,
} from "./bookmarks/storage.js";
import type { Collection } from "./bookmarks/collections.js";
import { collectionOptions } from "./ui/collections.js";
import { requireElement } from "./ui/dom.js";
import { createRefreshScheduler } from "./library/refresh.js";
import { captureThumbnail } from "./metadata.js";
import { captureCurrentPage } from "./page-capture.js";
import type { CurrentPage } from "./page-capture.js";
import { openLibrary } from "./open-library.js";

const saveTo = requireElement<HTMLSelectElement>("#save-to");
const collectionError = requireElement<HTMLParagraphElement>("#save-to-error");
const openLibraryButton = document.querySelector<HTMLButtonElement>("#open-library");
const feedback = document.querySelector<HTMLParagraphElement>("#feedback");
const pageStatus = document.querySelector<HTMLParagraphElement>("#page-status");
const pageDetails = document.querySelector<HTMLElement>("#page-details");
const pageTitle = document.querySelector<HTMLTextAreaElement>("#page-title");
const pageUrl = document.querySelector<HTMLAnchorElement>("#page-url");
const pageImage = document.querySelector<HTMLImageElement>("#page-image");
const previewStatus = document.querySelector<HTMLParagraphElement>("#preview-status");
const saveForm = document.querySelector<HTMLFormElement>("#save-form");
const saveButton = document.querySelector<HTMLButtonElement>("#save");
const titleError = document.querySelector<HTMLParagraphElement>("#title-error");
const saveStatus = document.querySelector<HTMLParagraphElement>("#save-status");
const saveError = document.querySelector<HTMLParagraphElement>("#save-error");

if (
  !openLibraryButton
  || !feedback
  || !pageStatus
  || !pageDetails
  || !pageTitle
  || !pageUrl
  || !pageImage
  || !previewStatus
  || !saveForm
  || !saveButton
  || !titleError
  || !saveStatus
  || !saveError
) {
  throw new Error("The popup is missing a required control or page-preview element.");
}

const openLibraryButtonElement = openLibraryButton;
const feedbackElement = feedback;
const pageStatusElement = pageStatus;
const pageDetailsElement = pageDetails;
const pageTitleElement = pageTitle;
const pageUrlElement = pageUrl;
const pageImageElement = pageImage;
const previewStatusElement = previewStatus;
const saveFormElement = saveForm;
const saveButtonElement = saveButton;
const titleErrorElement = titleError;
const saveStatusElement = saveStatus;
const saveErrorElement = saveError;

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
    const bookmark = createBookmark({ url: page.url, title, thumbnailUrl, collectionId }, savedAt);
    const result = await saveBookmark(bookmark, true);

    completed = true;
    pageTitleElement.value = result.bookmark.title;
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
      saveButtonElement.textContent = "Save";
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
    pageUrlElement.textContent = result.page.url;
    pageUrlElement.href = result.page.url;
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

watchBookmarks(collectionRefresh.schedule);
void collectionRefresh.refresh();
initializePagePreview();
