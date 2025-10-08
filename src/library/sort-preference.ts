import type { BookmarkSort } from "../bookmarks/search.js";

const SORT_KEY = "azkmark.library.sort";

// Display preferences stay separate from bookmark storage and backups
export function initializeSortPreference(
  select: HTMLSelectElement,
  apply: (value: BookmarkSort) => void,
): void {
  function update(next: string | null): BookmarkSort {
    let value: BookmarkSort = "newest";
    if (next === "oldest" || next === "title-asc" || next === "title-desc") {
      value = next;
    }
    select.value = value;
    apply(value);
    return value;
  }

  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SORT_KEY);
  } catch {
    // Blocked storage must not prevent browsing
  }
  update(stored);

  window.addEventListener("storage", (event) => {
    try {
      if (event.storageArea !== localStorage) {
        return;
      }
    } catch {
      return;
    }
    if (event.key === SORT_KEY || event.key === null) {
      update(event.newValue);
    }
  });

  select.addEventListener("change", () => {
    const value = update(select.value);
    try {
      if (value === "newest") {
        localStorage.removeItem(SORT_KEY);
      } else {
        localStorage.setItem(SORT_KEY, value);
      }
    } catch {
      // The current tab remains usable without persistence
    }
  });
}
