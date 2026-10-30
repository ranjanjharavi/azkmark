import { savedDateRange } from "../bookmarks/search.js";

// Filters and row ages share one refresh at the next local calendar boundary.
export function initializeSavedDateRefresh(refresh: (now: number) => void): {
  update: (active: boolean, now?: number) => void;
} {
  let renderedDay: ReturnType<typeof savedDateRange>;
  let timer: number | undefined;

  function clearTimer(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  function scheduleMidnight(): void {
    clearTimer();
    if (!renderedDay || document.visibilityState !== "visible") {
      return;
    }

    // The range ends at the next local midnight, including short/long DST days
    const delay = Math.max(1, renderedDay.end - Date.now());
    timer = window.setTimeout(refreshIfNeeded, delay);
  }

  function refreshIfNeeded(): void {
    if (!renderedDay || document.visibilityState !== "visible") {
      clearTimer();
      return;
    }

    const now = Date.now();
    const currentDay = savedDateRange("today", now);
    if (currentDay && (currentDay.start !== renderedDay.start || currentDay.end !== renderedDay.end)) {
      refresh(now);
    }
    scheduleMidnight();
  }

  function update(active: boolean, now = Date.now()): void {
    renderedDay = active ? savedDateRange("today", now) : undefined;
    scheduleMidnight();
  }

  window.addEventListener("focus", refreshIfNeeded);
  document.addEventListener("visibilitychange", refreshIfNeeded);
  window.addEventListener("pagehide", clearTimer);
  window.addEventListener("pageshow", refreshIfNeeded);

  return { update };
}
