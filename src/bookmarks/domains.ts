import type { Bookmark } from "./model.js";
import { parseWebUrl } from "../shared/urls.js";

export interface DomainGroups {
  domains: Map<string, Bookmark[]>;
  general: Bookmark[];
}

export function bookmarkDomain(url: string): string {
  const parsed = parseWebUrl(url);
  if (!parsed) {
    throw new TypeError("Unsupported bookmark URL.");
  }

  const hostname = parsed.hostname.replace(/^www\./, "");
  if (hostname === "youtu.be" || hostname === "m.youtube.com") {
    return "youtube.com";
  }

  return hostname;
}

// Group the full library so search results cannot change group membership.
export function groupBookmarks(library: readonly Bookmark[]): DomainGroups {
  const domains = new Map<string, Bookmark[]>();

  for (const bookmark of library) {
    const domain = bookmarkDomain(bookmark.url);
    const members = domains.get(domain);

    if (members) {
      members.push(bookmark);
    } else {
      domains.set(domain, [bookmark]);
    }
  }

  const general: Bookmark[] = [];
  for (const [domain, members] of domains) {
    if (members.length === 1) {
      general.push(members[0]);
      domains.delete(domain);
    }
  }

  return { domains, general };
}
