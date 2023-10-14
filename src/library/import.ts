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
  const fileInput = document.querySelector<HTMLInputElement>("#backup-file");
  const status = document.querySelector<HTMLParagraphElement>("#import-status");
  const error = document.querySelector<HTMLParagraphElement>("#import-error");
  const openImport = document.querySelector<HTMLButtonElement>("#open-import");
  const helpToggle = document.querySelector<HTMLButtonElement>("#backup-help-toggle");
  const helpPanel = document.querySelector<HTMLDivElement>("#backup-panel");

  if (!fileInput || !status || !error || !openImport || !helpToggle || !helpPanel) {
    throw new Error("The backup import controls are incomplete.");
  }

  const fileInputElement = fileInput;
  const statusElement = status;
  const errorElement = error;
  const openImportButton = openImport;
  const helpToggleElement = helpToggle;
  const helpPanelElement = helpPanel;

  let importing = false;

  helpToggleElement.addEventListener("click", () => {
    const open = helpPanelElement.hidden;
    helpPanelElement.hidden = !open;
    helpToggleElement.setAttribute("aria-expanded", String(open));
  });

  openImportButton.addEventListener("click", () => {
    if (!importing) {
      fileInputElement.click();
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
      return `Some saved data is invalid. ${counts} Repair the library, then choose this file again.`;
    }
    if (cause instanceof StorageQuotaError) {
      return `Storage is full. ${counts} Free some space, then choose this file again to continue.`;
    }
    return `Couldn't finish importing. ${counts} Choose the same file again to continue.`;
  }

  async function importSelectedFile(): Promise<void> {
    const file = fileInputElement.files?.[0];
    if (importing || !file) {
      return;
    }

    const restoreButtonFocus = document.activeElement === openImportButton;
    // Allow choosing the same file again after success or a partial failure.
    fileInputElement.value = "";
    importing = true;
    fileInputElement.disabled = true;
    openImportButton.disabled = true;
    openImportButton.setAttribute("aria-busy", "true");
    errorElement.hidden = true;
    statusElement.textContent = "Reading file…";

    let readingFile = true;
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
        errorElement.textContent = "Couldn't read the selected file. Use Import to try again or choose another file.";
      } else if (cause instanceof UnsupportedBackupVersionError) {
        errorElement.textContent = "This backup version isn't supported. Choose an azkmark version 1, 2 or 3 backup.";
      } else {
        errorElement.textContent = "This isn't a valid azkmark JSON backup or Chrome HTML export. No bookmarks or collections were changed.";
      }
      errorElement.hidden = false;
    } finally {
      importing = false;
      fileInputElement.disabled = false;
      openImportButton.disabled = false;
      openImportButton.setAttribute("aria-busy", "false");

      if (restoreButtonFocus && document.activeElement === document.body) {
        openImportButton.focus({ preventScroll: true });
      }
    }
  }

  fileInputElement.addEventListener("change", () => {
    void importSelectedFile();
  });
}
