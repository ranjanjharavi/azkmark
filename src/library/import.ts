import { parseBackup, UnsupportedBackupVersionError } from "../bookmarks/backup.js";
import type { LibraryData } from "../bookmarks/backup.js";
import { parseChromeBookmarks } from "../bookmarks/chrome-bookmarks.js";
import type { ImportBookmarksResult } from "../bookmarks/storage.js";
import {
  importBookmarkRecords,
  InvalidStoredBookmarkError,
  StorageQuotaError,
} from "../bookmarks/storage.js";

interface ImportCallbacks {
  refresh: () => Promise<void>;
}

export function initializeImport({ refresh }: ImportCallbacks): void {
  const form = document.querySelector<HTMLFormElement>("#import-form");
  const fileInput = document.querySelector<HTMLInputElement>("#backup-file");
  const importButton = document.querySelector<HTMLButtonElement>("#import-backup");
  const status = document.querySelector<HTMLParagraphElement>("#import-status");
  const error = document.querySelector<HTMLParagraphElement>("#import-error");
  const openImport = document.querySelector<HTMLButtonElement>("#open-import");
  const helpToggle = document.querySelector<HTMLButtonElement>("#backup-help-toggle");
  const helpPanel = document.querySelector<HTMLDivElement>("#backup-panel");

  if (!form || !fileInput || !importButton || !status || !error || !openImport || !helpToggle || !helpPanel) {
    throw new Error("The backup import controls are incomplete.");
  }

  const formElement = form;
  const fileInputElement = fileInput;
  const importButtonElement = importButton;
  const statusElement = status;
  const errorElement = error;
  const openImportButton = openImport;
  const helpToggleElement = helpToggle;
  const helpPanelElement = helpPanel;

  let importing = false;

  function setPanelOpen(open: boolean): void {
    if (!open && helpPanelElement.contains(document.activeElement)) {
      helpToggleElement.focus({ preventScroll: true });
    }
    helpPanelElement.hidden = !open;
    helpToggleElement.setAttribute("aria-expanded", String(open));
  }

  helpToggleElement.addEventListener("click", () => {
    setPanelOpen(helpPanelElement.hidden);
  });

  openImportButton.addEventListener("click", () => {
    setPanelOpen(true);
    if (!importing) {
      fileInputElement.focus();
    }
  });

  function importSummary(result: ImportBookmarksResult): string {
    const bookmarksLabel = result.added === 1 ? "bookmark" : "bookmarks";
    const collectionsLabel = result.collectionsAdded === 1 ? "collection" : "collections";
    return `${result.added} ${bookmarksLabel} and ${result.collectionsAdded} ${collectionsLabel} added; ${result.skipped} duplicate URLs skipped.`;
  }

  function failureMessage(cause: unknown, summary: string): string {
    const counts = `Confirmed this attempt: ${summary} Existing bookmarks were kept.`;
    if (cause instanceof InvalidStoredBookmarkError) {
      return `Some saved data is invalid. ${counts} Repair the library, then retry this file.`;
    }
    if (cause instanceof StorageQuotaError) {
      return `Storage is full. ${counts} Free some space, then retry this file to continue.`;
    }
    return `Couldn't finish importing. ${counts} Retry the same file to continue.`;
  }

  fileInputElement.addEventListener("change", () => {
    if (importing) {
      return;
    }
    errorElement.hidden = true;
    statusElement.textContent = "";
    fileInputElement.removeAttribute("aria-invalid");
    importButtonElement.disabled = !fileInputElement.files || fileInputElement.files.length === 0;
  });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (importing) {
      return;
    }

    const file = fileInputElement.files?.[0];
    if (!file) {
      errorElement.textContent = "Choose an azkmark JSON backup or Chrome HTML export before importing.";
      errorElement.hidden = false;
      fileInputElement.setAttribute("aria-invalid", "true");
      fileInputElement.focus();
      return;
    }

    const restoreFileFocus = document.activeElement === fileInputElement;
    const restoreSubmitFocus = document.activeElement === importButtonElement;
    importing = true;
    fileInputElement.disabled = true;
    importButtonElement.disabled = true;
    formElement.setAttribute("aria-busy", "true");
    fileInputElement.removeAttribute("aria-invalid");
    errorElement.hidden = true;
    statusElement.textContent = "Reading file…";

    let readingFile = true;
    let focusFileAfter = false;
    try {
      const text = await file.text();
      readingFile = false;
      // File names and MIME types are hints only; each parser validates the contents.
      let incoming: LibraryData;
      let unsupportedNotice = "";
      if (text.trimStart().startsWith("<")) {
        const parsed = parseChromeBookmarks(text);
        incoming = { bookmarks: parsed.bookmarks, collections: [] };
        unsupportedNotice = ` ${parsed.skipped} unsupported links skipped.`;
      } else {
        incoming = parseBackup(text);
      }
      statusElement.textContent = "Importing bookmarks… Keep this tab open.";

      const result = await importBookmarkRecords(incoming.bookmarks, incoming.collections);
      try {
        await refresh();
      } catch (cause) {
        console.error("Could not refresh the library after import.", cause);
      }

      if (result.status === "imported") {
        statusElement.textContent = `Import finished: ${importSummary(result)}${unsupportedNotice} Existing bookmarks were kept.`;
      } else {
        statusElement.textContent = "";
        errorElement.textContent = failureMessage(result.error, importSummary(result)) + unsupportedNotice;
        errorElement.hidden = false;
      }
    } catch (cause) {
      statusElement.textContent = "";
      if (readingFile) {
        errorElement.textContent = "Couldn't read the selected file. Try again or choose another file.";
      } else if (cause instanceof UnsupportedBackupVersionError) {
        errorElement.textContent = "This backup version isn't supported. Choose an azkmark version 1, 2 or 3 backup.";
      } else {
        errorElement.textContent = "This isn't a valid azkmark JSON backup or Chrome HTML export. No bookmarks or collections were changed.";
      }
      errorElement.hidden = false;
      fileInputElement.setAttribute("aria-invalid", "true");
      focusFileAfter = true;
    } finally {
      importing = false;
      fileInputElement.disabled = false;
      importButtonElement.disabled = !fileInputElement.files || fileInputElement.files.length === 0;
      formElement.setAttribute("aria-busy", "false");

      if (document.activeElement === document.body) {
        if (focusFileAfter && !helpPanelElement.hidden) {
          fileInputElement.focus({ preventScroll: true });
        } else if (restoreSubmitFocus && !helpPanelElement.hidden) {
          importButtonElement.focus({ preventScroll: true });
        } else if (restoreFileFocus && !helpPanelElement.hidden) {
          fileInputElement.focus({ preventScroll: true });
        } else if (restoreSubmitFocus || restoreFileFocus || focusFileAfter) {
          helpToggleElement.focus({ preventScroll: true });
        }
      }
    }
  }

  formElement.addEventListener("submit", (event) => {
    void submit(event);
  });
}
