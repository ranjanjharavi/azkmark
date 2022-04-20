import { serializeBackup } from "../bookmarks/backup.js";
import { InvalidStoredBookmarkError, readLibrary } from "../bookmarks/storage.js";

export function initializeExport(): void {
  const button = document.querySelector<HTMLButtonElement>("#export-backup");
  const helpToggle = document.querySelector<HTMLButtonElement>("#backup-help-toggle");
  const helpPanel = document.querySelector<HTMLDivElement>("#backup-panel");
  const status = document.querySelector<HTMLParagraphElement>("#export-status");
  const error = document.querySelector<HTMLParagraphElement>("#export-error");

  if (!button || !helpToggle || !helpPanel || !status || !error) {
    throw new Error("The library is missing a required backup control or state.");
  }

  const exportButton = button;
  const helpToggleButton = helpToggle;
  const helpPanelElement = helpPanel;
  const statusElement = status;
  const errorElement = error;

  helpToggleButton.addEventListener("click", () => {
    const expanded = helpToggleButton.getAttribute("aria-expanded") === "true";
    if (expanded) {
      helpToggleButton.setAttribute("aria-expanded", "false");
      helpPanelElement.hidden = true;
    } else {
      helpToggleButton.setAttribute("aria-expanded", "true");
      helpPanelElement.hidden = false;
    }
  });

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
      // Read the complete current library
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
      statusElement.textContent = `Backup download started with ${bookmarks.length} ${countLabel}.`;
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
