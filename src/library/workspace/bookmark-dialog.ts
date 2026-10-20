import type { Bookmark } from "../../bookmarks/model.js";
import type { Collection } from "../../bookmarks/collections.js";
import { availableTags, sameTags } from "../../bookmarks/tags.js";
import { initializeTagInput } from "../../ui/tag-input.js";
import { collectionOptions } from "../../ui/collection-options.js";
import { requireElement } from "../../ui/dom.js";
import {
  deleteBookmark,
  InvalidStoredBookmarkError,
  StorageQuotaError,
  MissingCollectionError,
  updateBookmark
} from "../../bookmarks/storage.js";
import type { BookmarkChanges } from "../../bookmarks/storage.js";

export type ManagementMode = "edit" | "delete";

export interface ManagementAction {
  url: string;
  mode: ManagementMode;
}

interface ManagementCallbacks {
  getBookmarks: () => readonly Bookmark[] | undefined;
  getCollections: () => readonly Collection[];
  refresh: () => Promise<void>;
  restoreFocus: (action: ManagementAction) => void;
  showFeedback: (message: string) => void;
  clearFeedback: () => void;
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

export function initializeManagement({
  getBookmarks,
  getCollections,
  refresh,
  restoreFocus,
  showFeedback,
  clearFeedback
}: ManagementCallbacks): {
  open: (url: string, mode: ManagementMode) => void;
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
  const statusElement = requireElement<HTMLOutputElement>("#management-status");
  const cancelButtonElement = requireElement<HTMLButtonElement>("#management-cancel");
  const submitButtonElement = requireElement<HTMLButtonElement>("#management-submit");

  const tagInput = initializeTagInput("bookmark");
  let originalTags: readonly string[] = [];
  let action: ManagementAction | undefined;
  let originalTitle = "";
  let originalCollection = "";
  let submitting = false;
  let targetMissing = false;

  function open(url: string, mode: ManagementMode): void {
    const bookmarks = getBookmarks();
    if (!bookmarks || dialogElement.open || submitting) {
      return;
    }

    const bookmark = bookmarks.find((record) => record.url === url);
    if (!bookmark) {
      return;
    }

    action = { url, mode };
    targetMissing = false;
    clearFeedback();
    headingElement.textContent = mode === "edit" ? "Edit bookmark" : "Delete bookmark?";
    targetTitleElement.textContent = bookmark.title;
    targetTitleElement.hidden = mode === "edit";
    targetUrlElement.textContent = bookmark.url;
    originalTitle = bookmark.title;
    titleInputElement.value = originalTitle;
    originalTags = bookmark.tags?.slice() ?? [];
    tagInput.set(originalTags);
    tagInput.updateVocabulary(availableTags(bookmarks));
    tagInput.setDisabled(false);
    originalCollection = bookmark.collectionId ?? "";
    collectionOptions(collectionSelectElement, getCollections(), originalCollection);
    collectionSelectElement.disabled = false;
    titleInputElement.readOnly = false;
    titleInputElement.removeAttribute("aria-invalid");
    titleErrorElement.hidden = true;
    editFieldsElement.hidden = mode !== "edit";
    deleteCopyElement.hidden = mode !== "delete";
    deleteCopyElement.textContent = bookmark.notes?.length
      ? `This permanently deletes this bookmark and its ${bookmark.notes.length} notes. It can't be undone.`
      : "This permanently deletes this bookmark from your azkmark library. It can't be undone.";
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
      // Refresh choices only, never replace title, collection, or tag drafts.
      collectionOptions(collectionSelectElement, getCollections(), collectionSelectElement.value);
      tagInput.updateVocabulary(availableTags(getBookmarks() ?? []));
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

  function readChanges(): BookmarkChanges | undefined {
    const draftTitle = titleInputElement.value;
    const title = draftTitle.trim();
    if (!title) {
      titleErrorElement.hidden = false;
      titleInputElement.setAttribute("aria-invalid", "true");
      titleInputElement.focus();
      return;
    }

    const collection = collectionSelectElement.value;
    const collectionChanged = collection !== originalCollection;
    const collectionMissing = Boolean(collection) && !getCollections().some(({ id }) => id === collection);
    if (collectionChanged && collectionMissing) {
      errorElement.textContent = "This collection is no longer available. Choose another collection or Unsorted.";
      errorElement.hidden = false;
      collectionSelectElement.focus();
      return;
    }

    const tags = tagInput.read();
    if (!tags) {
      return;
    }

    return {
      title: draftTitle !== originalTitle ? title : undefined,
      collectionId: collectionChanged ? collection || null : undefined,
      tags: sameTags(tags, originalTags) ? undefined : tags
    };
  }

  function setSubmitting(next: boolean): void {
    submitting = next;
    tagInput.setDisabled(next);
    titleInputElement.readOnly = next;
    collectionSelectElement.disabled = next;
    cancelButtonElement.disabled = next;
    submitButtonElement.disabled = next || targetMissing;
    formElement.setAttribute("aria-busy", String(next));
  }

  async function persistAction(currentAction: ManagementAction, changes: BookmarkChanges): Promise<string | undefined> {
    const result =
      currentAction.mode === "edit"
        ? await updateBookmark(currentAction.url, changes)
        : await deleteBookmark(currentAction.url);
    if (result.status === "not-found") {
      showMissingTarget();
      await refresh();
      return;
    }
    if (currentAction.mode === "delete") return "Bookmark deleted.";
    if (result.status === "unchanged") return "No changes made. Kept the latest saved details.";
    return "Bookmark changes saved.";
  }

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!action || submitting || targetMissing) return;
    const currentAction = action;
    const changes = currentAction.mode === "edit" ? readChanges() : {};
    if (!changes) return;

    setSubmitting(true);
    errorElement.hidden = true;
    statusElement.textContent = currentAction.mode === "edit" ? "Saving changes…" : "Deleting bookmark…";

    try {
      const feedbackMessage = await persistAction(currentAction, changes);
      if (feedbackMessage === undefined) return;
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
      setSubmitting(false);
      statusElement.textContent = "";

      if (dialogElement.open) {
        const target = targetMissing ? cancelButtonElement : submitButtonElement;
        target.focus({ preventScroll: true });
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
    originalTags = [];
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
