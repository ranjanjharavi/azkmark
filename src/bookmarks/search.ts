import type { Bookmark } from "./model.js";
import { groupBookmarks } from "./domains.js";

export type BookmarkSelection =
  | { kind: "all" }
  | { kind: "general" }
  | { kind: "domain"; domain: string };

export type SavedDateSelection = "all" | "today" | "7-days" | "30-days";
export type ViewStatusSelection = "all" | "to-view" | "viewed";

export interface BookmarkFilterOptions {
  query?: string;
  selection?: BookmarkSelection;
  savedDate?: SavedDateSelection;
  viewStatus?: ViewStatusSelection;
  now?: number;
}

function savedDateRange(
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
    const matchesDate = !range || (
      bookmark.savedAt >= range.start && bookmark.savedAt < range.end
    );
    const matchesViewStatus = viewStatus === "all"
      || Boolean(bookmark.viewed) === (viewStatus === "viewed");
    const matchesQuery = !term
      || bookmark.title.toLowerCase().includes(term)
      || bookmark.url.toLowerCase().includes(term);

    return matchesDate && matchesViewStatus && matchesQuery;
  });

  matches.sort((left, right) => {
    if (left.savedAt === right.savedAt) {
      return 0;
    }
    return left.savedAt > right.savedAt ? -1 : 1;
  });

  return matches;
}
