import type { Bookmark } from "./model.js";
import { groupBookmarks } from "./domains.js";

export type BookmarkSelection =
  | { kind: "all" }
  | { kind: "general" }
  | { kind: "domain"; domain: string };

export type SavedDateSelection = "all" | "today" | "7-days" | "30-days";
export type ViewStatusSelection = "all" | "to-view" | "viewed";
export type BookmarkSort = "newest" | "oldest" | "title-asc" | "title-desc";

export interface BookmarkFilterOptions {
  query?: string;
  selection?: BookmarkSelection;
  savedDate?: SavedDateSelection;
  viewStatus?: ViewStatusSelection;
  tag?: string;
  sort?: BookmarkSort;
  now?: number;
}

const compareTitles = new Intl.Collator(undefined, { sensitivity: "base" }).compare;

function compareBookmarks(left: Bookmark, right: Bookmark, sort: BookmarkSort): number {
  if (sort === "title-asc" || sort === "title-desc") {
    const titleOrder = compareTitles(left.title, right.title);
    if (titleOrder !== 0) {
      return sort === "title-asc" ? titleOrder : -titleOrder;
    }
  } else if (sort === "oldest") {
    return left.savedAt - right.savedAt;
  }

  // Equal titles use newest saved first; complete ties retain input order.
  return right.savedAt - left.savedAt;
}

export function savedDateRange(
  selection: SavedDateSelection,
  now: number,
): { start: number; end: number } | undefined {
  let days: number;
  switch (selection) {
    case "all":
      return undefined;
    case "today":
      days = 1;
      break;
    case "7-days":
      days = 7;
      break;
    case "30-days":
      days = 30;
      break;
    default:
      return undefined;
  }

  const currentDate = new Date(now);
  const startDate = new Date(currentDate.getTime());
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(currentDate.getTime());
  endDate.setDate(endDate.getDate() + 1);
  endDate.setHours(0, 0, 0, 0);

  return { start: startDate.getTime(), end: endDate.getTime() };
}

export function filterBookmarks(
  library: readonly Bookmark[],
  {
    query = "",
    selection = { kind: "all" },
    savedDate = "all",
    viewStatus = "all",
    tag = "",
    sort = "newest",
    now = Date.now(),
  }: BookmarkFilterOptions = {},
): Bookmark[] {
  let source: readonly Bookmark[] = library;

  if (selection.kind !== "all") {
    const groups = groupBookmarks(library);
    source = selection.kind === "general"
      ? groups.general
      : groups.domains.get(selection.domain) ?? [];
  }

  const range = savedDateRange(savedDate, now);
  const term = query.trim().toLowerCase();
  const matches = source.filter((bookmark) => {
    const tags = bookmark.tags ?? [];
    const matchesTag = !tag || tags.includes(tag);
    const matchesDate = !range || (
      bookmark.savedAt >= range.start && bookmark.savedAt < range.end
    );
    const matchesViewStatus = viewStatus === "all"
      || Boolean(bookmark.viewed) === (viewStatus === "viewed");
    const matchesQuery = !term
      || bookmark.title.toLowerCase().includes(term)
      || bookmark.url.toLowerCase().includes(term)
      || tags.some((label) => label.includes(term));

    return matchesDate && matchesViewStatus && matchesTag && matchesQuery;
  });

  // Filtering creates a fresh array; Chrome 88 has stable Array.prototype.sort.
  matches.sort((left, right) => compareBookmarks(left, right, sort));

  return matches;
}
