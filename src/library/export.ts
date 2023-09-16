import { serializeBackup } from "../bookmarks/backup.js";
import { InvalidStoredBookmarkError, readLibrary } from "../bookmarks/storage.js";

export function initializeExport(): void {
  const button = document.querySelector<HTMLButtonElement>("#export-backup");
  const status = document.querySelector<HTMLParagraphElement>("#export-status");
  const error = document.querySelector<HTMLParagraphElement>("#export-error");

  if (!button || !status || !error) {
    throw new Error("The library is missing a required backup control or state.");
  }

  const exportButton = button;
  const statusElement = status;
  const errorElement = error;

  let exporting = false;

  async function exportBackup(): Promise<void> {
    if (exporting) {
      return;
    }

    const restoreButtonFocus = document.activeElement === exportButton;
    exporting = true;
    exportButton.disabled = true;
    exportButton.setAttribute("aria-busy", "true");
    errorElement.hidden = true;
    statusElement.textContent = "Preparing backup…";

    let objectUrl: string | undefined;
    try {
      // Export a fresh whole-library v3 snapshot, including empty collections.
      const { bookmarks, collections } = await readLibrary();
      const json = serializeBackup(bookmarks, collections);
      const file = new Blob([json], { type: "application/json;charset=utf-8" });
      objectUrl = URL.createObjectURL(file);

      const download = document.createElement("a");
      download.href = objectUrl;
      download.download = "azkmark-backup.json";
      download.click();

      const downloadedUrl = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(downloadedUrl), 1000);
      objectUrl = undefined;

      const countLabel = bookmarks.length === 1 ? "bookmark" : "bookmarks";
      const collectionLabel = collections.length === 1 ? "collection" : "collections";
      statusElement.textContent = `Backup download started with ${bookmarks.length} ${countLabel} and ${collections.length} ${collectionLabel}.`;
    } catch (cause) {
      console.error("Could not export saved bookmarks.", cause);
      statusElement.textContent = "";

      if (cause instanceof InvalidStoredBookmarkError) {
        errorElement.textContent = "Some saved data is invalid. No backup was downloaded.";
      } else {
        errorElement.textContent = "Couldn't export your bookmarks. Try again.";
      }

      errorElement.hidden = false;
    } finally {
      if (objectUrl !== undefined) {
        URL.revokeObjectURL(objectUrl);
      }

      exporting = false;
      exportButton.disabled = false;
      exportButton.setAttribute("aria-busy", "false");
      
      if (restoreButtonFocus && document.activeElement === document.body) {
        exportButton.focus({ preventScroll: true });
      }
    }
  }

  exportButton.addEventListener("click", () => {
    void exportBackup();
  });
}
