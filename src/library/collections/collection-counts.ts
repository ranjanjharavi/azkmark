import type { Bookmark } from "../../bookmarks/model.js";

export function countCollectionBookmarks(bookmarks: readonly Bookmark[]): Map<string | undefined, number> {
  const counts = new Map<string | undefined, number>();
  for (const { collectionId } of bookmarks) {
    const count = counts.get(collectionId) ?? 0;
    counts.set(collectionId, count + 1);
  }
  return counts;
}
