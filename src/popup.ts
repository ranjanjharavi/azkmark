import { captureThumbnail } from "./metadata.js";
import { captureCurrentPage } from "./page-capture.js";

const openLibraryButton = document.querySelector<HTMLButtonElement>("#open-library");
const feedback = document.querySelector<HTMLParagraphElement>("#feedback");
const pageStatus = document.querySelector<HTMLParagraphElement>("#page-status");
const pageDetails = document.querySelector<HTMLElement>("#page-details");
const pageTitle = document.querySelector<HTMLHeadingElement>("#page-title");
const pageUrl = document.querySelector<HTMLAnchorElement>("#page-url");
const pageImage = document.querySelector<HTMLImageElement>("#page-image");
const previewStatus = document.querySelector<HTMLParagraphElement>("#preview-status");

if (!openLibraryButton || !feedback || !pageStatus || !pageDetails || !pageTitle || !pageUrl || !pageImage || !previewStatus) {
  throw new Error("The popup is missing a required control or page-preview element");
}

const openLibraryButtonElement = openLibraryButton;
const feedbackElement = feedback;
const pageStatusElement = pageStatus;
const pageDetailsElement = pageDetails;
const pageTitleElement = pageTitle;
const pageUrlElement = pageUrl;
const pageImageElement = pageImage;
const previewStatusElement = previewStatus;

let imageTimeout: number | undefined;

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
  if (!pageImageElement.getAttribute("src")) return;

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

function initializePagePreview(): void {
  captureCurrentPage((result) => {
    if (result.status !== "ready") {
      pageStatusElement.textContent = result.message;
      return;
    }

    pageTitleElement.textContent = result.page.title;
    pageUrlElement.textContent = result.page.url;
    pageUrlElement.href = result.page.url;
    pageDetailsElement.hidden = false;
    pageStatusElement.hidden = true;

    captureThumbnail(result.page, (thumbnailUrl) => {
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
