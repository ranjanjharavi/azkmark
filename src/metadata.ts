import type { CurrentPage } from "./page-capture.js";
import { parseWebUrl, youtubeVideoId } from "./urls.js";

export const METADATA_TIMEOUT_MS = 750;

interface ThumbnailMetadata {
  pageUrl: string;
  baseUrl: string;
  canonicalUrl: string | null;
  imageUrls: string[];
}

// Chrome serializes this function into the page. Keep it self-contained.
export function readThumbnailMetadata(): ThumbnailMetadata {
  const canonicalUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content")
    || document.querySelector('link[rel="canonical"]')?.getAttribute("href")
    || null;

  const selectors = [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ];

  return {
    pageUrl: location.href,
    baseUrl: document.baseURI,
    canonicalUrl,
    imageUrls: selectors
      .map((selector) => document.querySelector(selector)?.getAttribute("content")?.trim() || "")
      .filter(Boolean),
  };
}

function canonicalMatchesPage(current: URL, canonical: URL): boolean {
  const videoId = youtubeVideoId(current);
  if (videoId) {
    return videoId === youtubeVideoId(canonical);
  }

  return current.host.replace(/^www\./, "") === canonical.host.replace(/^www\./, "")
    && current.pathname.replace(/\/$/, "") === canonical.pathname.replace(/\/$/, "")
    && current.search === canonical.search;
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
        func: readThumbnailMetadata,
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
