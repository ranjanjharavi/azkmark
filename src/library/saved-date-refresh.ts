import { savedDateRange } from "../bookmarks/search.js";
import type { SavedDateSelection } from "../bookmarks/search.js";

// Compare the rendered calendar bounds, not elapsed 24-hour durations
export function initializeSavedDateRefresh(refresh: (now: number) => void): {
  update: (selection: SavedDateSelection, now?: number) => void;
} {
  let selection: SavedDateSelection = "all";
  let renderedRange: ReturnType<typeof savedDateRange>;
  let timer: number | undefined;

  function clearTimer(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  function scheduleMidnight(): void {
    clearTimer();
    if (!renderedRange || document.visibilityState !== "visible") {
      return;
    }

    // The range ends at the next local midnight, including short/long DST days
    const delay = Math.max(1, renderedRange.end - Date.now());
    timer = window.setTimeout(refreshIfNeeded, delay);
  }

  function refreshIfNeeded(): void {
    if (document.visibilityState !== "visible") {
      clearTimer();
      return;
    }

    const now = Date.now();
    const currentRange = savedDateRange(selection, now);
    if (currentRange && (
      !renderedRange
      || currentRange.start !== renderedRange.start
      || currentRange.end !== renderedRange.end
    )) {
      refresh(now);
    }
    scheduleMidnight();
  }

  function update(next: SavedDateSelection, now = Date.now()): void {
    selection = next;
    renderedRange = savedDateRange(next, now);
    scheduleMidnight();
  }

  window.addEventListener("focus", refreshIfNeeded);
  document.addEventListener("visibilitychange", refreshIfNeeded);
  window.addEventListener("pagehide", clearTimer);
  window.addEventListener("pageshow", refreshIfNeeded);

  return { update };
}
