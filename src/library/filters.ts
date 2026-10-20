import type { Bookmark } from "../bookmarks/model.js";
import type { Collection } from "../bookmarks/collections.js";
import type { BookmarkSelection, BookmarkSort, SavedDateSelection, ViewStatusSelection } from "../bookmarks/search.js";
import { groupBookmarks } from "../bookmarks/domains.js";
import { availableTags } from "../bookmarks/tags.js";
import { requireElement } from "../ui/dom.js";
import { collectionButtons } from "./collections/collection-navigation.js";
import { initializeSortPreference } from "./sort-preference.js";

export interface LibraryFilters {
  query: string;
  selection: BookmarkSelection;
  savedDate: SavedDateSelection;
  viewStatus: ViewStatusSelection;
  tag: string;
  sort: BookmarkSort;
  collectionScope: string;
  activeCount: number;
}

interface FilterCallbacks {
  onChange: () => void;
  onReset: () => void;
  isAvailable: () => boolean;
}

export function inCollectionScope(bookmark: Bookmark, scope: string): boolean {
  if (scope === "all") {
    return true;
  }
  if (scope === "unsorted") {
    return bookmark.collectionId === undefined;
  }
  return bookmark.collectionId === scope.slice("collection:".length);
}

export function initializeLibraryFilters({ onChange, onReset, isAvailable }: FilterCallbacks) {
  const searchInputElement = requireElement<HTMLInputElement>("#search");
  const domainSelectElement = requireElement<HTMLSelectElement>("#domain");
  const savedDateSelectElement = requireElement<HTMLSelectElement>("#saved-date");
  const viewStatusSelectElement = requireElement<HTMLSelectElement>("#view-status");
  const tagSelect = requireElement<HTMLSelectElement>("#tag-filter");
  const sortSelectElement = requireElement<HTMLSelectElement>("#sort-by");
  const toggleFiltersElement = requireElement<HTMLButtonElement>("#toggle-filters");
  const filtersElement = requireElement<HTMLDivElement>("#library-filters");
  const filterCountElement = requireElement<HTMLSpanElement>("#filter-count");
  const libraryControlsElement = requireElement<HTMLFormElement>("#library-controls");
  const resetFiltersButton = requireElement<HTMLButtonElement>("#reset-filters");
  const clearCollectionButton = requireElement<HTMLButtonElement>("#clear-collection");
  const collectionNavigationElement = requireElement<HTMLElement>("#collection-navigation");
  const manageCollectionsButton = requireElement<HTMLButtonElement>("#manage-collections");
  let collectionScope = "all";

  function read(): LibraryFilters {
    const domain = domainSelectElement.value;
    let selection: BookmarkSelection = { kind: "all" };
    if (domain.startsWith("domain:")) {
      selection = { kind: "domain", domain: domain.slice("domain:".length) };
    } else if (domain === "general") {
      selection = { kind: "general" };
    }
    const status = viewStatusSelectElement.value;
    const viewStatus: ViewStatusSelection = status === "viewed" || status === "to-view" ? status : "all";
    const savedDate = savedDateSelectElement.value as SavedDateSelection;
    const tag = tagSelect.value;
    const activeSelections = [selection.kind !== "all", savedDate !== "all", viewStatus !== "all", tag !== ""];
    const activeCount = activeSelections.filter(Boolean).length;
    return {
      query: searchInputElement.value,
      selection,
      savedDate,
      viewStatus,
      tag,
      sort: sortSelectElement.value as BookmarkSort,
      collectionScope,
      activeCount
    };
  }

  function updateDomainOptions(bookmarks: readonly Bookmark[]): string {
    const groups = groupBookmarks(bookmarks);
    let { selection } = read();
    let notice = "";
    if (selection.kind === "domain" && !groups.domains.has(selection.domain)) {
      selection = { kind: "all" };
      notice = "Domain group no longer available. Showing all domains; other filters kept.";
    }
    const options = document.createDocumentFragment();
    options.appendChild(new Option(`All bookmarks (${bookmarks.length})`, "all"));
    options.appendChild(new Option(`General (${groups.general.length})`, "general"));
    const domains = Array.from(groups.domains.keys()).sort((left, right) => left.localeCompare(right));
    domains.forEach((domain) => {
      const members = groups.domains.get(domain) ?? [];
      options.appendChild(new Option(`${domain} (${members.length})`, `domain:${domain}`));
    });
    domainSelectElement.replaceChildren(options);
    domainSelectElement.value = selection.kind === "domain" ? `domain:${selection.domain}` : selection.kind;
    return notice;
  }

  function updateTagOptions(bookmarks: readonly Bookmark[]): void {
    const selected = tagSelect.value;
    const vocabulary = availableTags(bookmarks);
    const options = document.createDocumentFragment();
    options.appendChild(new Option("All tags", ""));
    if (vocabulary.length > 0) {
      const group = document.createElement("optgroup");
      group.label = "Tags";
      vocabulary.forEach((tag) => {
        group.appendChild(new Option(tag, tag));
      });
      options.appendChild(group);
    }
    // Keep a vanished selection explicit, rather than silently broadening results.
    if (selected && !vocabulary.includes(selected)) {
      const missing = new Option(`${selected} — no saved bookmarks`, selected);
      missing.disabled = true;
      options.appendChild(missing);
    }
    tagSelect.replaceChildren(options);
    tagSelect.value = selected;
  }

  function update(bookmarks: readonly Bookmark[], collections: readonly Collection[]): string {
    const notices = [updateDomainOptions(bookmarks)];
    const selectedId = collectionScope.slice("collection:".length);
    if (collectionScope.startsWith("collection:") && !collections.some(({ id }) => id === selectedId)) {
      collectionScope = "all";
      notices.push("Collection removed. Showing all bookmarks with the current search and filters.");
    }
    collectionNavigationElement.replaceChildren(
      collectionButtons(collections, bookmarks, collectionScope),
      manageCollectionsButton
    );
    updateTagOptions(bookmarks);
    return notices.filter(Boolean).join(" ");
  }

  function setCollectionControls(disabled: boolean): void {
    const buttons = collectionNavigationElement.querySelectorAll<HTMLButtonElement>("button[value]");
    buttons.forEach((button) => {
      button.disabled = disabled;
      button.setAttribute("aria-pressed", String(button.value === collectionScope));
    });
    manageCollectionsButton.disabled = disabled;
  }

  function setDisabled(disabled: boolean): void {
    const controls = [
      searchInputElement,
      domainSelectElement,
      savedDateSelectElement,
      viewStatusSelectElement,
      tagSelect,
      sortSelectElement,
      toggleFiltersElement,
      resetFiltersButton
    ];
    controls.forEach((control) => {
      control.disabled = disabled;
    });
    setCollectionControls(disabled);
  }

  function render(): LibraryFilters {
    setCollectionControls(false);
    const state = read();
    const states: readonly [HTMLSelectElement, boolean][] = [
      [domainSelectElement, state.selection.kind !== "all"],
      [savedDateSelectElement, state.savedDate !== "all"],
      [viewStatusSelectElement, state.viewStatus !== "all"],
      [tagSelect, state.tag !== ""]
    ];
    states.forEach(([control, selected]) => {
      control.dataset.active = String(selected);
    });
    filterCountElement.textContent = String(state.activeCount);
    filterCountElement.hidden = state.activeCount === 0;
    toggleFiltersElement.setAttribute(
      "aria-label",
      state.activeCount ? `Filters, ${state.activeCount} active` : "Filters"
    );
    toggleFiltersElement.dataset.active = String(state.activeCount > 0);
    return state;
  }

  function reset(): void {
    collectionScope = "all";
    searchInputElement.value = "";
    domainSelectElement.value = "all";
    savedDateSelectElement.value = "all";
    viewStatusSelectElement.value = "all";
    tagSelect.value = "";
    onChange();
    onReset();
  }

  function setOpen(open: boolean): void {
    if (!open && filtersElement.contains(document.activeElement)) {
      toggleFiltersElement.focus({ preventScroll: true });
    }
    filtersElement.hidden = !open;
    toggleFiltersElement.setAttribute("aria-expanded", String(open));
  }

  searchInputElement.addEventListener("input", onChange);
  domainSelectElement.addEventListener("change", onChange);
  savedDateSelectElement.addEventListener("change", onChange);
  tagSelect.addEventListener("change", onChange);
  viewStatusSelectElement.addEventListener("change", () => {
    viewStatusSelectElement.value = read().viewStatus;
    onChange();
  });
  libraryControlsElement.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  collectionNavigationElement.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !isAvailable()) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[value]");
    if (!button || button.disabled || !collectionNavigationElement.contains(button)) {
      return;
    }
    collectionScope = button.value;
    onChange();
  });
  resetFiltersButton.addEventListener("click", reset);
  clearCollectionButton.addEventListener("click", reset);
  toggleFiltersElement.addEventListener("click", () => {
    setOpen(filtersElement.hidden);
  });
  libraryControlsElement.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !filtersElement.hidden && filtersElement.contains(document.activeElement)) {
      event.preventDefault();
      setOpen(false);
    }
  });
  initializeSortPreference(sortSelectElement, onChange);

  return {
    read,
    render,
    update,
    setDisabled,
    elements: {
      searchInputElement,
      domainSelectElement,
      savedDateSelectElement,
      viewStatusSelectElement,
      tagSelect,
      sortSelectElement,
      toggleFiltersElement,
      resetFiltersButton,
      clearCollectionButton,
      collectionNavigationElement,
      manageCollectionsButton
    }
  };
}
