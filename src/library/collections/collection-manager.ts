import type { Bookmark } from "../../bookmarks/model.js";
import type { Collection } from "../../bookmarks/collections.js";
import {
  deleteCollection,
  InvalidStoredBookmarkError,
  MissingCollectionError,
  saveCollection,
  StorageQuotaError,
} from "../../bookmarks/storage.js";
import { requireElement } from "../../ui/dom.js";
import { countCollectionBookmarks } from "./collection-counts.js";
import { collectionRow } from "./collection-row.js";

interface CollectionCallbacks {
  getBookmarks: () => readonly Bookmark[] | undefined;
  getCollections: () => readonly Collection[] | undefined;
  refresh: () => Promise<void>;
  showFeedback: (message: string) => void;
  clearFeedback: () => void;
}

export function initializeCollections({
  getBookmarks,
  getCollections,
  refresh,
  showFeedback,
  clearFeedback,
}: CollectionCallbacks): { update: () => void } {
  const open = requireElement<HTMLButtonElement>("#manage-collections");
  const dialog = requireElement<HTMLDialogElement>("#collection-dialog");
  const list = requireElement<HTMLUListElement>("#collection-manager-list");
  const total = requireElement<HTMLParagraphElement>("#collection-total");
  const empty = requireElement<HTMLParagraphElement>("#collection-manager-empty");
  const unsorted = requireElement<HTMLParagraphElement>("#collection-unsorted");
  const form = requireElement<HTMLFormElement>("#collection-form");
  const name = requireElement<HTMLInputElement>("#collection-name");
  const error = requireElement<HTMLParagraphElement>("#collection-error");
  const status = requireElement<HTMLOutputElement>("#collection-status");
  const close = requireElement<HTMLButtonElement>("#collection-cancel");
  const renameForm = requireElement<HTMLFormElement>("#collection-rename-form");
  const renameName = requireElement<HTMLInputElement>("#collection-rename-name");
  const renameError = requireElement<HTMLParagraphElement>("#collection-rename-error");
  const renameSave = requireElement<HTMLButtonElement>("#collection-rename-save");
  const renameCancel = requireElement<HTMLButtonElement>("#collection-rename-cancel");
  const deleteDialog = requireElement<HTMLDialogElement>("#collection-delete-dialog");
  const deleteHeading = requireElement<HTMLHeadingElement>("#collection-delete-heading");
  const deleteForm = requireElement<HTMLFormElement>("#collection-delete-form");
  const confirm = requireElement<HTMLParagraphElement>("#collection-confirm");
  const deleteError = requireElement<HTMLParagraphElement>("#collection-delete-error");
  const deleteStatus = requireElement<HTMLOutputElement>("#collection-delete-status");
  const deleteCancel = requireElement<HTMLButtonElement>("#collection-delete-cancel");
  const deleteSubmit = requireElement<HTMLButtonElement>("#collection-delete-submit");
  const retry = requireElement<HTMLButtonElement>("#retry");
  let editing: Collection | undefined;
  let deleting: Collection | undefined;
  let missingEdit = false;
  let missingDelete = false;
  let busy = false;

  function focusRow(id: string | undefined, action: "rename" | "delete", options: FocusOptions = {}): void {
    const buttons = list.querySelectorAll<HTMLButtonElement>("button[data-collection-action]");
    for (const button of buttons) {
      const row = button.closest<HTMLLIElement>("li[data-collection-id]");
      if (
        row?.dataset.collectionId !== id
        || button.dataset.collectionAction !== action
        || button.disabled
        || button.closest("[hidden]")
      ) {
        continue;
      }
      button.focus(options);
      return;
    }
    name.focus(options);
  }

  function setBusy(next: boolean): void {
    busy = next;
    name.readOnly = next;
    renameName.readOnly = next;
    dialog.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = next;
    });
    renameSave.disabled = next || missingEdit;
    deleteSubmit.disabled = next || missingDelete;
    deleteCancel.disabled = next;
    deleteCancel.textContent = missingDelete ? "Close" : "Keep collection";
    for (const target of [form, renameForm, deleteForm]) {
      target.setAttribute("aria-busy", String(next));
    }
  }

  function renderRows(collections: readonly Collection[], counts: ReadonlyMap<string | undefined, number>): void {
    const active = document.activeElement;
    const inEditor = active instanceof HTMLElement && renameForm.contains(active);
    const row = active instanceof Element ? active.closest<HTMLLIElement>("li[data-collection-id]") : null;
    const action = active instanceof HTMLButtonElement ? active.dataset.collectionAction : undefined;
    const scrollTop = list.scrollTop;
    const start = renameName.selectionStart;
    const end = renameName.selectionEnd;
    const direction = renameName.selectionDirection;
    const sorted = collections.slice().sort((left, right) => left.name.localeCompare(right.name));
    // Retain the editor and draft even if another tab removes its collection
    if (editing && missingEdit) {
      sorted.push(editing);
    }
    const rows = document.createDocumentFragment();
    renameForm.hidden = !editing;
    sorted.forEach((collection) => {
      const isEditing = editing?.id === collection.id;
      const item = collectionRow(collection, counts.get(collection.id) ?? 0, isEditing);
      if (isEditing) {
        item.appendChild(renameForm);
      }
      rows.appendChild(item);
    });
    list.replaceChildren(rows);
    list.scrollTop = scrollTop;
    if (inEditor && active.isConnected) {
      active.focus({ preventScroll: true });
      if (active === renameName && start !== null && end !== null) {
        renameName.setSelectionRange(start, end, direction ?? "none");
      }
    } else if (row && (action === "rename" || action === "delete")) {
      focusRow(row.dataset.collectionId, action, { preventScroll: true });
    }
  }

  function showMissingRename(): void {
    renameError.textContent = "This collection was removed. The name draft is kept. Cancel to continue.";
    renameError.hidden = false;
    if (document.activeElement === renameSave) {
      renameCancel.focus();
    }
  }

  function updateDeleteConfirmation(collections: readonly Collection[], counts: ReadonlyMap<string | undefined, number>, wasMissing: boolean): void {
    if (!deleting) return;
    const current = collections.find(({ id }) => id === deleting?.id) ?? deleting;
    deleteHeading.textContent = "Delete “" + current.name + "”?";
    const members = counts.get(deleting.id) ?? 0;
    const memberUnit = members === 1 ? "bookmark" : "bookmarks";
    confirm.textContent = members + " " + memberUnit + " will move to Unsorted. No bookmarks will be deleted.";
    if (missingDelete && !wasMissing) {
      const previous = deleteError.hidden ? "" : deleteError.textContent + " ";
      deleteError.textContent = previous + "This collection was removed. Close this confirmation to continue.";
      deleteError.hidden = false;
    } else if (!missingDelete && wasMissing) {
      deleteError.hidden = true;
    }
  }

  function update(): void {
    if (!dialog.open || busy) {
      return;
    }
    renameForm.hidden = !editing;
    const collections = getCollections();
    const bookmarks = getBookmarks();
    if (!collections || !bookmarks) {
      return;
    }
    const wasMissingEdit = missingEdit;
    const wasMissingDelete = missingDelete;
    missingEdit = Boolean(editing && !collections.some(({ id }) => id === editing?.id));
    missingDelete = Boolean(deleting && !collections.some(({ id }) => id === deleting?.id));
    const counts = countCollectionBookmarks(bookmarks);
    renderRows(collections, counts);
    const unit = collections.length === 1 ? "collection" : "collections";
    total.textContent = collections.length + " " + unit;
    empty.hidden = collections.length > 0 || Boolean(editing);
    const count = counts.get(undefined) ?? 0;
    unsorted.textContent = count + (count === 1 ? " bookmark in Unsorted" : " bookmarks in Unsorted");
    if (missingEdit && !wasMissingEdit) {
      showMissingRename();
    } else if (!missingEdit && wasMissingEdit) {
      renameError.hidden = true;
    }
    updateDeleteConfirmation(collections, counts, wasMissingDelete);
    setBusy(false);
  }

  open.addEventListener("click", () => {
    if (!getCollections() || !getBookmarks() || dialog.open || busy) {
      return;
    }
    editing = undefined;
    missingEdit = false;
    name.value = "";
    name.removeAttribute("aria-invalid");
    error.hidden = true;
    status.textContent = "";
    clearFeedback();
    dialog.showModal();
    update();
    const first = list.querySelector<HTMLButtonElement>("button");
    if (first) {
      first.focus();
    } else {
      name.focus();
    }
  });

  list.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || busy) {
      return;
    }
    const button = event.target.closest<HTMLButtonElement>("button[data-collection-action]");
    const row = button?.closest<HTMLLIElement>("li[data-collection-id]");
    const collection = getCollections()?.find(({ id }) => id === row?.dataset.collectionId);
    if (!button || !collection) {
      return;
    }
    if (button.dataset.collectionAction === "rename") {
      editing = collection;
      missingEdit = false;
      renameName.value = collection.name;
      renameName.removeAttribute("aria-invalid");
      renameError.hidden = true;
      status.textContent = "";
      update();
      renameName.focus();
      renameName.select();
    } else if (button.dataset.collectionAction === "delete") {
      deleting = collection;
      missingDelete = false;
      deleteError.hidden = true;
      deleteStatus.textContent = "";
      update();
      deleteDialog.showModal();
      deleteCancel.focus();
    }
  });

  renameCancel.addEventListener("click", () => {
    if (busy) {
      return;
    }
    const id = editing?.id;
    editing = undefined;
    missingEdit = false;
    if (!getCollections() || !getBookmarks()) {
      dialog.close();
      return;
    }
    update();
    focusRow(id, "rename");
  });

  name.addEventListener("input", () => {
    name.removeAttribute("aria-invalid");
    error.hidden = true;
  });
  renameName.addEventListener("input", () => {
    renameName.removeAttribute("aria-invalid");
    if (!missingEdit) {
      renameError.hidden = true;
    }
  });
  close.addEventListener("click", () => {
    if (!busy) {
      dialog.close();
    }
  });
  deleteCancel.addEventListener("click", () => {
    if (!busy) {
      deleteDialog.close();
    }
  });
  for (const target of [dialog, deleteDialog]) {
    target.addEventListener("cancel", (event) => {
      if (busy) {
        event.preventDefault();
      }
    });
  }
  dialog.addEventListener("close", () => {
    if (!dialog.open) {
      (open.disabled ? retry : open).focus({ preventScroll: true });
    }
  });
  deleteDialog.addEventListener("close", () => {
    if (deleteDialog.open) {
      return;
    }
    const id = deleting?.id;
    deleting = undefined;
    missingDelete = false;
    if (dialog.open) {
      focusRow(id, "delete");
    }
  });

  function showSaveFailure(cause: unknown, input: HTMLInputElement, fieldError: HTMLParagraphElement): void {
    if (cause instanceof MissingCollectionError) {
      missingEdit = true;
      showMissingRename();
    } else if (cause instanceof InvalidStoredBookmarkError) {
      fieldError.textContent = "Some saved data is invalid. No collection change was confirmed.";
    } else if (cause instanceof StorageQuotaError) {
      fieldError.textContent = "Storage is full. Free some space, then retry. Drafts are kept.";
    } else if (cause instanceof TypeError) {
      fieldError.textContent = cause.message;
      input.setAttribute("aria-invalid", "true");
    } else {
      fieldError.textContent = "Couldn't save the collection. The name draft is kept. Try again.";
    }
    fieldError.hidden = false;
  }

  function restoreNameFocus(input: HTMLInputElement, target: Collection | undefined, saved: Collection | undefined): void {
    if (!dialog.open || deleteDialog.open) return;
    if (saved && target) {
      focusRow(saved.id, "rename");
    } else if (missingEdit && target) {
      renameCancel.focus({ preventScroll: true });
    } else {
      input.focus({ preventScroll: true });
    }
  }

  async function saveName(input: HTMLInputElement, target?: Collection): Promise<void> {
    if (busy || deleteDialog.open || (target && missingEdit)) {
      return;
    }
    // Snapshot identity and draft before storage or live refreshes can run.
    const id = target?.id;
    const draft = input.value;
    const fieldError = target ? renameError : error;
    let saved: Collection | undefined;
    setBusy(true);
    fieldError.hidden = true;
    status.textContent = "Saving collection…";
    try {
      const result = await saveCollection(draft, id);
      await refresh();
      saved = result;
      if (target) {
        editing = undefined;
        missingEdit = false;
      } else {
        name.value = "";
      }
      status.textContent = "Collection “" + saved.name + "” saved.";
      showFeedback(status.textContent);
      if (!getCollections() || !getBookmarks()) {
        dialog.close();
      }
    } catch (cause) {
      await refresh();
      showSaveFailure(cause, input, fieldError);
    } finally {
      setBusy(false);
      update();
      if (!saved) {
        status.textContent = "";
      }
      restoreNameFocus(input, target, saved);
    }
  }

  async function removeCollection(): Promise<void> {
    if (busy || missingDelete || !deleting) {
      return;
    }
    const id = deleting.id;
    setBusy(true);
    deleteError.hidden = true;
    deleteStatus.textContent = "Deleting collection…";
    try {
      const result = await deleteCollection(id);
      await refresh();
      const count = result.moved + (result.moved === 1 ? " bookmark moved" : " bookmarks moved");
      if (result.status === "failed") {
        let recovery = "Try again to finish deleting. The collection is kept until all moves succeed.";
        if (result.error instanceof StorageQuotaError) {
          recovery = "Storage is full. Free some space, then retry to finish deleting.";
        } else if (result.error instanceof InvalidStoredBookmarkError) {
          recovery = "Some saved data is invalid. The collection has not been removed.";
        }
        deleteError.textContent = "Couldn't finish deleting. " + count + " to Unsorted in this attempt. " + recovery;
        deleteError.hidden = false;
        return;
      }
      if (editing?.id === id) {
        editing = undefined;
        missingEdit = false;
      }
      status.textContent = result.status === "not-found"
        ? "Collection was already removed. The library has been refreshed."
        : "Collection deleted. " + count + " to Unsorted.";
      showFeedback(status.textContent);
      deleteDialog.close();
      if (!getCollections() || !getBookmarks()) {
        dialog.close();
      }
    } catch (cause) {
      await refresh();
      if (cause instanceof InvalidStoredBookmarkError) {
        deleteError.textContent = "Some saved data is invalid. No collection change was confirmed.";
      } else if (cause instanceof StorageQuotaError) {
        deleteError.textContent = "Storage is full. Free some space, then retry to finish deleting.";
      } else {
        deleteError.textContent = "Couldn't finish deleting. The library has been refreshed. Retry to finish.";
      }
      deleteError.hidden = false;
    } finally {
      setBusy(false);
      update();
      deleteStatus.textContent = "";
      if (deleteDialog.open) {
        deleteCancel.focus({ preventScroll: true });
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveName(name);
  });
  renameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (editing) {
      void saveName(renameName, editing);
    }
  });
  deleteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void removeCollection();
  });
  return { update };
}
