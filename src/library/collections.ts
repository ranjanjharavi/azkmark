import type { Collection } from "../bookmarks/collections.js";
import {
  deleteCollection,
  InvalidStoredBookmarkError,
  MissingCollectionError,
  saveCollection,
  StorageQuotaError,
} from "../bookmarks/storage.js";
import { collectionOptions } from "../ui/collections.js";
import { requireElement } from "../ui/dom.js";

interface CollectionCallbacks {
  getCollections: () => readonly Collection[] | undefined;
  refresh: () => Promise<void>;
  showFeedback: (message: string) => void;
  clearFeedback: () => void;
}

export function initializeCollections({ getCollections, refresh, showFeedback, clearFeedback }: CollectionCallbacks): {
  update: () => void;
} {
  const open = requireElement<HTMLButtonElement>("#manage-collections");
  const dialog = requireElement<HTMLDialogElement>("#collection-dialog");
  const form = requireElement<HTMLFormElement>("#collection-form");
  const edit = requireElement<HTMLElement>("#collection-edit");
  const select = requireElement<HTMLSelectElement>("#collection-edit-id");
  const name = requireElement<HTMLInputElement>("#collection-name");
  const confirm = requireElement<HTMLParagraphElement>("#collection-confirm");
  const error = requireElement<HTMLParagraphElement>("#collection-error");
  const status = requireElement<HTMLParagraphElement>("#collection-status");
  const cancel = requireElement<HTMLButtonElement>("#collection-cancel");
  const remove = requireElement<HTMLButtonElement>("#collection-delete");
  const submit = requireElement<HTMLButtonElement>("#collection-submit");
  const retry = requireElement<HTMLButtonElement>("#retry");
  let busy = false;
  let deleting = false;
  let missing = false;

  function selectedCollection(): Collection | undefined {
    return getCollections()?.find(({ id }) => id === select.value);
  }

  function reset(): void {
    deleting = false;
    missing = false;
    edit.hidden = false;
    confirm.hidden = true;
    error.hidden = true;
    status.textContent = "";
    name.value = selectedCollection()?.name ?? "";
    name.removeAttribute("aria-invalid");
    remove.hidden = !select.value;
    submit.disabled = false;
    submit.textContent = select.value ? "Save name" : "Create collection";
    submit.classList.remove("destructive");
    cancel.textContent = "Cancel";
  }

  function update(): void {
    const collections = getCollections();
    if (!collections) {
      return;
    }

    const selected = dialog.open ? select.value : "";
    collectionOptions(select, collections, selected, "management");
    
    // Updating definitions never replaces an open name draft or deletion error
    if (!dialog.open || busy) {
      return;
    }

    missing = Boolean(selected) && !selectedCollection();
    if (missing) {
      showMissingCollection();
      return;
    }
    submit.disabled = false;
    remove.disabled = false;
    cancel.textContent = "Cancel";
    if (deleting) {
      updateConfirmation();
    }
  }

  function showMissingCollection(): void {
    const actionFocused = document.activeElement === submit || document.activeElement === remove;
    missing = true;
    cancel.textContent = "Close";
    submit.disabled = true;
    remove.disabled = true;
    error.textContent = deleting
      ? "This collection was already removed. Close this dialog to continue."
      : "This collection was removed. Choose another collection or New collection; the name draft is kept until the choice changes.";
    error.hidden = false;
    if (!busy && (deleting || actionFocused)) {
      (deleting ? cancel : select).focus({ preventScroll: true });
    }
  }

  function updateConfirmation(): void {
    const label = selectedCollection()?.name ?? name.value;
    confirm.textContent = `Delete “${label}”? The collection will be removed, but its bookmarks will stay saved and move to Unsorted.`;
  }

  function setBusy(next: boolean): void {
    busy = next;
    name.readOnly = next;
    select.disabled = next;
    cancel.disabled = next;
    remove.disabled = next || missing;
    submit.disabled = next || missing;
    form.setAttribute("aria-busy", String(next));
  }

  open.addEventListener("click", () => {
    if (!getCollections() || dialog.open || busy) {
      return;
    }
    update();
    reset();
    setBusy(false);
    clearFeedback();
    dialog.showModal();
    name.focus();
  });

  select.addEventListener("change", () => {
    reset();
    setBusy(false);
    name.focus();
  });

  name.addEventListener("input", () => {
    name.removeAttribute("aria-invalid");
    if (!busy && !missing) {
      error.hidden = true;
    }
  });

  remove.addEventListener("click", () => {
    if (busy || missing || !select.value) {
      return;
    }

    deleting = true;
    edit.hidden = true;
    remove.hidden = true;
    error.hidden = true;
    updateConfirmation();
    confirm.hidden = false;
    submit.textContent = "Delete collection";
    submit.classList.add("destructive");
    cancel.focus();
  });
  
  cancel.addEventListener("click", () => {
    if (!busy) {
      dialog.close();
    }
  });

  dialog.addEventListener("cancel", (event) => {
    if (busy) {
      event.preventDefault();
    }
  });

  dialog.addEventListener("close", () => {
    if (!dialog.open) {
      (open.disabled ? retry : open).focus({ preventScroll: true });
    }
  });

  async function save(event: Event): Promise<void> {
    event.preventDefault();
    if (busy || missing) {
      return;
    }

    // Snapshot the target and draft before waiting; live reads may change options
    const id = select.value;
    const draft = name.value;
    setBusy(true);
    error.hidden = true;
    status.textContent = deleting ? "Deleting collection…" : "Saving collection…";
    try {
      let message: string;
      if (deleting) {
        const result = await deleteCollection(id);
        const count = `${result.moved} ${result.moved === 1 ? "bookmark moved" : "bookmarks moved"}`;
        if (result.status === "failed") {
          await refresh();
          let recovery = "Try again to finish deleting. The collection is kept until all moves succeed.";
    
          if (result.error instanceof StorageQuotaError) {
            recovery = "Storage is full. Free some space, then retry to finish deleting.";
          } else if (result.error instanceof InvalidStoredBookmarkError) {
            recovery = "Some saved data is invalid. The collection has not been removed.";
          }
          error.textContent = `Couldn't finish deleting. ${count} to Unsorted in this attempt. ${recovery}`;
          error.hidden = false;
          return;
        }
        message = result.status === "not-found"
          ? "Collection was already removed. The library has been refreshed."
          : `Collection deleted. ${count} to Unsorted.`;
      } else {
        await saveCollection(draft, id || undefined);
        message = "Collection saved.";
      }
      await refresh();
      showFeedback(message);
      dialog.close();
    } catch (cause) {
      await refresh();
      if (cause instanceof MissingCollectionError) {
        showMissingCollection();
      } else if (cause instanceof InvalidStoredBookmarkError) {
        error.textContent = "Some saved data is invalid. No collection change was confirmed.";
      } else if (cause instanceof StorageQuotaError) {
        error.textContent = "Storage is full. Free some space, then retry. Drafts are kept.";
      } else if (deleting) {
        error.textContent = "Couldn't finish deleting. The library has been refreshed; retry to finish.";
      } else if (cause instanceof TypeError) {
        error.textContent = cause.message;
        name.setAttribute("aria-invalid", "true");
      } else {
        error.textContent = "Couldn't save the collection. The name draft is kept; try again.";
      }
      error.hidden = false;
    } finally {
      setBusy(false);
      status.textContent = "";
      if (dialog.open) {
        (deleting || missing ? cancel : name).focus({ preventScroll: true });
      }
    }
  }

  form.addEventListener("submit", (event) => {
    void save(event);
  });
  return { update };
}
