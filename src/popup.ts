import { createBookmark } from "./bookmarks/model.js";
import { StorageQuotaError, saveBookmark } from "./bookmarks/storage.js";
import { captureThumbnail } from "./metadata.js";
import { captureCurrentPage } from "./page-capture.js";
import type { CurrentPage } from "./page-capture.js";

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
  feedbackElement.textContent = "Could not open the library. Reload the extension and try again.";
  feedbackElement.hidden = false;
}

openLibraryButtonElement.addEventListener("click", () => {
  openLibraryButtonElement.disabled = true;
  feedbackElement.hidden = true;

  try {
    chrome.tabs.create({ url: chrome.runtime.getURL("library.html") }, () => {
      const lastError = chrome.runtime.lastError;

      if (lastError) {
        showLibraryError(lastError.message || "Unknown Chrome error");
      }

      openLibraryButtonElement.disabled = false;
    });
  } catch (error) {
    showLibraryError(error instanceof Error ? error.message : "Unknown error");
    openLibraryButtonElement.disabled = false;
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
  if (!currentPage || saving || completed) {
    return;
  }

  const title = pageTitleElement.value.trim();
  if (!title) {
    titleErrorElement.hidden = false;
    pageTitleElement.setAttribute("aria-invalid", "true");
    pageTitleElement.focus();
    return;
  }

  const page = currentPage;
  const restoreSaveFocus = document.activeElement === saveButtonElement;
  const savedAt = Date.now();
  saving = true;
  saveButtonElement.disabled = true;
  saveButtonElement.textContent = "Saving…";
  pageTitleElement.readOnly = true;
  saveFormElement.setAttribute("aria-busy", "true");
  titleErrorElement.hidden = true;
  saveErrorElement.hidden = true;
  saveStatusElement.textContent = "Saving…";

  try {
    // Wait only for bounded metadata capture, never for the image to load.
    const thumbnailUrl = await thumbnailReady;
    const bookmark = createBookmark({ url: page.url, title, thumbnailUrl }, savedAt);
    const result = await saveBookmark(bookmark);

    completed = true;
    pageTitleElement.value = result.bookmark.title;
    saveButtonElement.textContent = "Saved";
    saveStatusElement.textContent = result.status === "saved"
      ? "Saved."
      : "Already saved. Kept its saved details.";
  } catch (error) {
    saveStatusElement.textContent = "";
    saveErrorElement.textContent = error instanceof StorageQuotaError
      ? "Storage is full. This page wasn't saved."
      : "Couldn't save this page. Your changes are kept; try again.";
    saveErrorElement.hidden = false;
  } finally {
    saving = false;
    saveFormElement.setAttribute("aria-busy", "false");
    saveButtonElement.disabled = completed || !currentPage;
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
    saveButtonElement.disabled = false;

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

initializePagePreview();
