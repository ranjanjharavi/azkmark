import {
  InvalidStoredBookmarkError,
  StorageQuotaError,
  updateBookmarkViewed,
} from "../../bookmarks/storage.js";
import { requireElement } from "../../ui/dom.js";
import type { FocusSnapshot, initializeLibraryFocus } from "../focus.js";

interface ViewedStatusCallbacks {
  refresh: () => Promise<void>;
  render: (focus: FocusSnapshot) => void;
  focus: Pick<ReturnType<typeof initializeLibraryFocus>, "capture" | "afterViewedUpdate">;
}

export function initializeViewedStatus({ refresh, render, focus }: ViewedStatusCallbacks) {
  const viewedFeedbackElement = requireElement<HTMLParagraphElement>("#viewed-feedback");
  const viewedErrorElement = requireElement<HTMLParagraphElement>("#viewed-error");
  const pendingViewed = new Set<string>();

  async function setBookmarkViewed(button: HTMLButtonElement, url: string): Promise<void> {
    const targetStatus = button.getAttribute("data-viewed");
    if ((targetStatus !== "true" && targetStatus !== "false") || pendingViewed.has(url)) {
      return;
    }

    const previousFocus = focus.capture();
    const wasFocused = document.activeElement === button;
    const viewed = targetStatus === "true";
    pendingViewed.add(url);
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    viewedErrorElement.hidden = true;
    viewedFeedbackElement.textContent = "Saving status…";

    try {
      const result = await updateBookmarkViewed(url, viewed);
      await refresh();
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
      // Failed writes may keep this node instead of rebuilding its actions.
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
      render(focus.afterViewedUpdate(button, url, wasFocused, previousFocus));
    }
  }

  return {
    update: setBookmarkViewed,
    isPending: (url: string) => pendingViewed.has(url),
  };
}
