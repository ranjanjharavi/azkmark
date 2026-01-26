import type { Bookmark } from "../../bookmarks/model.js";

export function reconcileSelection(
  matches: readonly Bookmark[],
  library: readonly Bookmark[],
  previousUrl: string | undefined,
  previousUrls: readonly string[],
): Bookmark | undefined {
  if (matches.length === 0) {
    return undefined;
  }

  const selected = matches.find(({ url }) => url === previousUrl);
  if (selected || previousUrl === undefined) {
    return selected ?? matches[0];
  }

  // A filtered-out bookmark uses the first match, only deletion keeps its position.
  if (library.some(({ url }) => url === previousUrl)) {
    return matches[0];
  }

  const previousIndex = Math.max(0, previousUrls.indexOf(previousUrl));
  const nextIndex = Math.min(previousIndex, matches.length - 1);
  return matches[nextIndex];
}
