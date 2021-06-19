import type { Bookmark } from "../bookmarks/model.js";
import {
  deleteBookmark,
  InvalidStoredBookmarkError,
  StorageQuotaError,
  updateBookmarkTitle,
} from "../bookmarks/storage.js";

export type ManagementMode = "edit" | "delete";

export interface ManagementAction {
  url: string;
  mode: ManagementMode;
  index: number;
}

interface ManagementCallbacks {
  getBookmarks: () => readonly Bookmark[] | undefined;
  refresh: () => Promise<void>;
  restoreFocus: (action: ManagementAction) => void;
  showFeedback: (message: string) => void;
  clearFeedback: () => void;
}

export function initializeManagement({
  getBookmarks,
  refresh,
  restoreFocus,
  showFeedback,
  clearFeedback,
}: ManagementCallbacks): {
  open: (url: string, mode: ManagementMode, index: number) => void;
  updateTarget: () => void;
} {
  const dialog = document.querySelector<HTMLDialogElement>("#bookmark-dialog");
  const heading = document.querySelector<HTMLHeadingElement>("#management-heading");
  const targetTitle = document.querySelector<HTMLParagraphElement>("#management-target");
  const targetUrl = document.querySelector<HTMLParagraphElement>("#management-url");
  const form = document.querySelector<HTMLFormElement>("#management-form");
  const editFields = document.querySelector<HTMLElement>("#management-edit");
  const titleInput = document.querySelector<HTMLTextAreaElement>("#bookmark-title");
  const titleError = document.querySelector<HTMLParagraphElement>("#management-title-error");
  const deleteCopy = document.querySelector<HTMLParagraphElement>("#management-delete");
  const error = document.querySelector<HTMLParagraphElement>("#management-error");
  const status = document.querySelector<HTMLParagraphElement>("#management-status");
  const cancelButton = document.querySelector<HTMLButtonElement>("#management-cancel");
  const submitButton = document.querySelector<HTMLButtonElement>("#management-submit");

  if (
    !dialog
    || !heading
    || !targetTitle
    || !targetUrl
    || !form
    || !editFields
    || !titleInput
    || !titleError
    || !deleteCopy
    || !error
    || !status
    || !cancelButton
    || !submitButton
  ) {
    throw new Error("The bookmark management dialog is incomplete.");
  }

  const dialogElement = dialog;
  const headingElement = heading;
  const targetTitleElement = targetTitle;
  const targetUrlElement = targetUrl;
  const formElement = form;
  const editFieldsElement = editFields;
  const titleInputElement = titleInput;
  const titleErrorElement = titleError;
  const deleteCopyElement = deleteCopy;
  const errorElement = error;
  const statusElement = status;
  const cancelButtonElement = cancelButton;
  const submitButtonElement = submitButton;

  let action: ManagementAction | undefined;
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
    headingElement.textContent = mode === "edit" ? "Edit bookmark title" : "Delete bookmark?";
    targetTitleElement.textContent = bookmark.title;
    targetTitleElement.hidden = mode === "edit";
    targetUrlElement.textContent = bookmark.url;
    titleInputElement.value = bookmark.title;
    titleInputElement.readOnly = false;
    titleInputElement.removeAttribute("aria-invalid");
    titleErrorElement.hidden = true;
    editFieldsElement.hidden = mode !== "edit";
    deleteCopyElement.hidden = mode !== "delete";
    errorElement.hidden = true;
    statusElement.textContent = "";
    submitButtonElement.textContent = mode === "edit" ? "Save title" : "Delete bookmark";
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
    if (!dialogElement.open || !action || action.mode !== "delete" || targetMissing) {
      return;
    }

    const current = getBookmarks()?.find((bookmark) => bookmark.url === action?.url);
    if (!current) {
      showMissingTarget();
      return;
    }

    targetTitleElement.textContent = current.title;
  }

  function showMissingTarget(): void {
    targetMissing = true;
    cancelButtonElement.textContent = "Close";
    submitButtonElement.disabled = true;
    errorElement.textContent = "This bookmark is no longer saved. Close this dialog to continue.";
    errorElement.hidden = false;
  }

  function failureMessage(cause: unknown, mode: ManagementMode): string {
    if (cause instanceof InvalidStoredBookmarkError) {
      return "This bookmark's saved data is invalid. It hasn't been changed.";
    }
    if (cause instanceof StorageQuotaError) {
      return "Bookmark storage is full. Free some space, then try again.";
    }
    if (mode === "edit") {
      return "Couldn't save the title. Your draft is kept; try again.";
    }
    return "Couldn't delete the bookmark. No deletion was confirmed; try again.";
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!action || submitting || targetMissing) {
      return;
    }

    const currentAction = action;
    const title = titleInputElement.value.trim();
    if (currentAction.mode === "edit" && !title) {
      titleErrorElement.hidden = false;
      titleInputElement.setAttribute("aria-invalid", "true");
      titleInputElement.focus();
      return;
    }

    submitting = true;
    titleInputElement.readOnly = true;
    cancelButtonElement.disabled = true;
    submitButtonElement.disabled = true;
    formElement.setAttribute("aria-busy", "true");
    errorElement.hidden = true;
    statusElement.textContent = currentAction.mode === "edit" ? "Saving title…" : "Deleting bookmark…";

    try {
      if (currentAction.mode === "edit") {
        const result = await updateBookmarkTitle(currentAction.url, title);
        if (result.status === "not-found") {
          showMissingTarget();
          await refresh();
          return;
        }
      } else {
        const result = await deleteBookmark(currentAction.url);
        if (result.status === "not-found") {
          showMissingTarget();
          await refresh();
          return;
        }
      }

      await refresh();
      if (currentAction.mode === "edit") {
        showFeedback("Bookmark title saved.");
      } else {
        showFeedback("Bookmark deleted.");
      }
      dialogElement.close();
    } catch (cause) {
      errorElement.textContent = failureMessage(cause, currentAction.mode);
      errorElement.hidden = false;
    } finally {
      submitting = false;
      titleInputElement.readOnly = false;
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

  formElement.addEventListener("submit", (event) => {
    void submit(event);
  });

  return { open, updateTarget };
}
