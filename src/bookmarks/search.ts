import type { Bookmark } from "./model.js";
import { groupBookmarks } from "./domains.js";

export type BookmarkSelection =
  | { kind: "all" }
  | { kind: "general" }
  | { kind: "domain"; domain: string };

export interface BookmarkFilterOptions {
  query?: string;
  selection?: BookmarkSelection;
}

export function filterBookmarks(
  library: readonly Bookmark[],
  { query = "", selection = { kind: "all" } }: BookmarkFilterOptions = {},
): Bookmark[] {
  let source: readonly Bookmark[] = library;

  if (selection.kind !== "all") {
    const groups = groupBookmarks(library);
    source = selection.kind === "general"
      ? groups.general
      : groups.domains.get(selection.domain) ?? [];
  }

  const term = query.trim().toLowerCase();
  const matches = source.filter((bookmark) => (
    !term
    || bookmark.title.toLowerCase().includes(term)
    || bookmark.url.toLowerCase().includes(term)
  ));

  matches.sort((left, right) => {
    if (left.savedAt === right.savedAt) {
      return 0;
    }
    return left.savedAt > right.savedAt ? -1 : 1;
  });

  return matches;
}
