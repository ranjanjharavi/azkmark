import type { CurrentPage } from "./page-capture.js";
import { parseWebUrl } from "../shared/urls.js";

export const METADATA_TIMEOUT_MS = 750;

interface ThumbnailMetadata {
  pageUrl: string;
  baseUrl: string;
  canonicalUrl: string | null;
  imageUrls: string[];
}

// Video identity detects stale previews. It never rewrites the saved URL.
function youtubeVideoId(url: URL): string | undefined {
  const hostname = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/");

  if (hostname === "youtu.be") {
    return parts[1] || undefined;
  }

  if (hostname !== "youtube.com" && hostname !== "m.youtube.com") {
    return undefined;
  }

  if (url.pathname === "/watch") {
    return url.searchParams.get("v") || undefined;
  }

  if (parts[1] === "shorts" || parts[1] === "embed" || parts[1] === "live") {
    return parts[2] || undefined;
  }

  return undefined;
}

function canonicalMatchesPage(current: URL, canonical: URL): boolean {
  const videoId = youtubeVideoId(current);
  if (videoId) {
    return videoId === youtubeVideoId(canonical);
  }

  return (
    current.host.replace(/^www\./, "") === canonical.host.replace(/^www\./, "") &&
    current.pathname.replace(/\/$/, "") === canonical.pathname.replace(/\/$/, "") &&
    current.search === canonical.search
  );
}

function thumbnailVideoId(image: URL): string | undefined {
  if (!/^(?:i\d?\.ytimg\.com|img\.youtube\.com)$/.test(image.hostname)) {
    return undefined;
  }

  return /^\/(?:vi|vi_webp)\/([^/]+)\//.exec(image.pathname)?.[1];
}

export function selectThumbnail(metadata: unknown, expectedPageUrl: string): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const snapshot = metadata as Partial<ThumbnailMetadata>;
  const expected = parseWebUrl(expectedPageUrl);
  const observed = parseWebUrl(snapshot.pageUrl);
  const base = parseWebUrl(snapshot.baseUrl);

  if (!expected || !observed || !base || observed.href !== expected.href || !Array.isArray(snapshot.imageUrls)) {
    return undefined;
  }

  if (snapshot.canonicalUrl !== null && snapshot.canonicalUrl !== undefined) {
    const canonical = parseWebUrl(snapshot.canonicalUrl, base.href);

    if (!canonical || !canonicalMatchesPage(expected, canonical)) {
      return undefined;
    }
  }

  const videoId = youtubeVideoId(expected);
  for (const candidate of snapshot.imageUrls) {
    const image = parseWebUrl(candidate, base.href);

    if (!image || image.username || image.password) {
      continue;
    }

    const imageVideoId = thumbnailVideoId(image);
    if (videoId && imageVideoId && imageVideoId !== videoId) {
      continue;
    }

    // Without a canonical identity, only a matching video thumbnail is trusted.
    if (videoId && !snapshot.canonicalUrl && imageVideoId !== videoId) {
      continue;
    }

    return image.href;
  }

  return undefined;
}

type ThumbnailCallback = (thumbnailUrl: string | undefined) => void;

export function captureThumbnail(page: CurrentPage, callback: ThumbnailCallback): void {
  let completed = false;
  let timeout: number | undefined;

  const finish = (thumbnailUrl: string | undefined): void => {
    if (completed) return;

    completed = true;
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
    }

    callback(thumbnailUrl);
  };

  timeout = window.setTimeout(() => finish(undefined), METADATA_TIMEOUT_MS);

  try {
    chrome.scripting.executeScript(
      {
        target: { tabId: page.tabId, frameIds: [0] },
        files: ["thumbnail-capture.js"]
      },
      (results) => {
        if (chrome.runtime.lastError) {
          finish(undefined);
          return;
        }

        const mainFrameResult = results.find((result) => result.frameId === 0);
        finish(selectThumbnail(mainFrameResult?.result, page.url));
      }
    );
  } catch {
    // Restricted pages and navigation races simply have no preview.
    finish(undefined);
  }
}
