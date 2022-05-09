import type { Bookmark } from "../bookmarks/model.js";
import type { Collection } from "../bookmarks/collections.js";
import { collectionOptions } from "../ui/collections.js";
import { requireElement } from "../ui/dom.js";
import {
  deleteBookmark,
  InvalidStoredBookmarkError,
  StorageQuotaError,
  MissingCollectionError,
  updateBookmark,
} from "../bookmarks/storage.js";

export type ManagementMode = "edit" | "delete";

export interface ManagementAction {
  url: string;
  mode: ManagementMode;
  index: number;
}

interface ManagementCallbacks {
  getBookmarks: () => readonly Bookmark[] | undefined;
  getCollections: () => readonly Collection[];
  refresh: () => Promise<void>;
  restoreFocus: (action: ManagementAction) => void;
  showFeedback: (message: string) => void;
  clearFeedback: () => void;
}

export function initializeManagement({
  getBookmarks,
  getCollections,
  refresh,
  restoreFocus,
  showFeedback,
  clearFeedback,
}: ManagementCallbacks): {
  open: (url: string, mode: ManagementMode, index: number) => void;
  updateTarget: () => void;
} {
  const dialogElement = requireElement<HTMLDialogElement>("#bookmark-dialog");
  const headingElement = requireElement<HTMLHeadingElement>("#management-heading");
  const targetTitleElement = requireElement<HTMLParagraphElement>("#management-target");
  const targetUrlElement = requireElement<HTMLParagraphElement>("#management-url");
  const formElement = requireElement<HTMLFormElement>("#management-form");
  const editFieldsElement = requireElement<HTMLElement>("#management-edit");
  const titleInputElement = requireElement<HTMLTextAreaElement>("#bookmark-title");
  const titleErrorElement = requireElement<HTMLParagraphElement>("#management-title-error");
  const collectionSelectElement = requireElement<HTMLSelectElement>("#bookmark-collection");
  const deleteCopyElement = requireElement<HTMLParagraphElement>("#management-delete");
  const errorElement = requireElement<HTMLParagraphElement>("#management-error");
  const statusElement = requireElement<HTMLParagraphElement>("#management-status");
  const cancelButtonElement = requireElement<HTMLButtonElement>("#management-cancel");
  const submitButtonElement = requireElement<HTMLButtonElement>("#management-submit");

  let action: ManagementAction | undefined;
  let originalTitle = "";
  let originalCollection = "";
  let submitting = false;
  let targetMissing = false;

  function open(url: string, mode: ManagementMode, index: number): void {
    const bookmarks = getBookmarks();
    if (!bookmarks || dialogElement.open || submitting) {
      return;
    }

    const bookmark = bookmarks.find((record) => record.url === url);
    if (!bookmark) {
      return;
    }

    action = { url, mode, index };
    targetMissing = false;
    clearFeedback();
    headingElement.textContent = mode === "edit" ? "Edit bookmark" : "Delete bookmark?";
    targetTitleElement.textContent = bookmark.title;
    targetTitleElement.hidden = mode === "edit";
    targetUrlElement.textContent = bookmark.url;
    originalTitle = bookmark.title;
    titleInputElement.value = originalTitle;
    originalCollection = bookmark.collectionId ?? "";
    collectionOptions(collectionSelectElement, getCollections(), originalCollection);
    collectionSelectElement.disabled = false;
    titleInputElement.readOnly = false;
    titleInputElement.removeAttribute("aria-invalid");
    titleErrorElement.hidden = true;
    editFieldsElement.hidden = mode !== "edit";
    deleteCopyElement.hidden = mode !== "delete";
    errorElement.hidden = true;
    statusElement.textContent = "";
    submitButtonElement.textContent = mode === "edit" ? "Save changes" : "Delete bookmark";
    submitButtonElement.disabled = false;
    submitButtonElement.classList.remove("destructive");

    if (mode === "delete") {
      submitButtonElement.classList.add("destructive");
    }
    
    cancelButtonElement.textContent = "Cancel";
    cancelButtonElement.disabled = false;
    formElement.setAttribute("aria-busy", "false");

    dialogElement.showModal();
    
    if (mode === "edit") {
      titleInputElement.focus();
      titleInputElement.select();
    } else {
      cancelButtonElement.focus();
    }
  }

  function updateTarget(): void {
    if (!dialogElement.open || !action || targetMissing) {
      return;
    }

    const current = getBookmarks()?.find((bookmark) => bookmark.url === action?.url);
    if (!current) {
      showMissingTarget();
      return;
    }

    targetTitleElement.textContent = current.title;
    if (action.mode === "edit") {
      // Keep both drafts, including a removed assignment that needs a new choice.
      collectionOptions(collectionSelectElement, getCollections(), collectionSelectElement.value);
    }
  }

  function showMissingTarget(): void {
    const submitFocused = document.activeElement === submitButtonElement;
    targetMissing = true;
    cancelButtonElement.textContent = "Close";
    submitButtonElement.disabled = true;
    errorElement.textContent = "This bookmark is no longer saved. Close this dialog to continue.";
    errorElement.hidden = false;
    if (submitFocused && !submitting) {
      cancelButtonElement.focus({ preventScroll: true });
    }
  }

  function failureMessage(cause: unknown, mode: ManagementMode): string {
    if (cause instanceof MissingCollectionError) {
      return cause.message;
    }
    if (cause instanceof InvalidStoredBookmarkError) {
      return "This bookmark's saved data is invalid. It hasn't been changed.";
    }
    if (cause instanceof StorageQuotaError) {
      return "Bookmark storage is full. Free some space, then try again.";
    }
    if (mode === "edit") {
      return "Couldn't save changes. Your drafts are kept; try again.";
    }
    return "Couldn't delete the bookmark. No deletion was confirmed; try again.";
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!action || submitting || targetMissing) {
      return;
    }

    const currentAction = action;
    const draftTitle = titleInputElement.value;
    const title = draftTitle.trim();
    const titleChanged = draftTitle !== originalTitle;
    if (currentAction.mode === "edit" && !title) {
      titleErrorElement.hidden = false;
      titleInputElement.setAttribute("aria-invalid", "true");
      titleInputElement.focus();
      return;
    }

    const collection = collectionSelectElement.value;
    const collectionChanged = collection !== originalCollection;
    const collectionMissing = Boolean(collection) && !getCollections().some(({ id }) => id === collection);
    if (currentAction.mode === "edit" && collectionChanged && collectionMissing) {
      errorElement.textContent = "This collection is no longer available. Choose another collection or Unsorted.";
      errorElement.hidden = false;
      collectionSelectElement.focus();
      return;
    }

    submitting = true;
    titleInputElement.readOnly = true;
    collectionSelectElement.disabled = true;
    cancelButtonElement.disabled = true;
    submitButtonElement.disabled = true;
    formElement.setAttribute("aria-busy", "true");
    errorElement.hidden = true;
    statusElement.textContent = currentAction.mode === "edit" ? "Saving changes…" : "Deleting bookmark…";

    try {
      let feedbackMessage: string;
      if (currentAction.mode === "edit") {
        let collectionId: string | null | undefined;
        if (collectionChanged) {
          collectionId = collection || null;
        }
        const result = await updateBookmark(currentAction.url, {
          title: titleChanged ? title : undefined,
          collectionId,
        });
        if (result.status === "not-found") {
          showMissingTarget();
          await refresh();
          return;
        }
        feedbackMessage = result.status === "unchanged"
          ? "No changes made. Kept the latest saved details."
          : "Bookmark changes saved.";
      } else {
        const result = await deleteBookmark(currentAction.url);
        if (result.status === "not-found") {
          showMissingTarget();
          await refresh();
          return;
        }
        feedbackMessage = "Bookmark deleted.";
      }

      await refresh();
      showFeedback(feedbackMessage);
      dialogElement.close();
    } catch (cause) {
      if (cause instanceof MissingCollectionError) {
        await refresh();
      }
      if (!targetMissing) {
        errorElement.textContent = failureMessage(cause, currentAction.mode);
        errorElement.hidden = false;
      }
    } finally {
      submitting = false;
      titleInputElement.readOnly = false;
      collectionSelectElement.disabled = false;
      cancelButtonElement.disabled = false;
      submitButtonElement.disabled = targetMissing;
      formElement.setAttribute("aria-busy", "false");
      statusElement.textContent = "";

      if (dialogElement.open) {
        if (targetMissing) {
          cancelButtonElement.focus({ preventScroll: true });
        } else {
          submitButtonElement.focus({ preventScroll: true });
        }
      }
    }
  }

  dialogElement.addEventListener("close", () => {
    // Close events are queued; don't let an old close clear a newly opened dialog.
    if (dialogElement.open) {
      return;
    }

    const previousAction = action;
    action = undefined;
    originalTitle = "";
    originalCollection = "";
    if (previousAction) {
      restoreFocus(previousAction);
    }
  });

  dialogElement.addEventListener("cancel", (event) => {
    if (submitting) {
      event.preventDefault();
    }
  });

  cancelButtonElement.addEventListener("click", () => {
    if (!submitting) {
      dialogElement.close();
    }
  });

  titleInputElement.addEventListener("input", () => {
    titleErrorElement.hidden = true;
    titleInputElement.removeAttribute("aria-invalid");
    if (!targetMissing) {
      errorElement.hidden = true;
    }
  });

  collectionSelectElement.addEventListener("change", () => {
    if (!targetMissing) {
      errorElement.hidden = true;
    }
  });

  formElement.addEventListener("submit", (event) => {
    void submit(event);
  });

  return { open, updateTarget };
}
