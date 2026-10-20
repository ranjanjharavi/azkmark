import { parseWebUrl } from "../shared/urls.js";

export interface CurrentPage {
  tabId: number;
  url: string;
  title: string;
}

export type PageCaptureResult =
  { status: "ready"; page: CurrentPage } | { status: "unsupported" | "unavailable"; message: string };

type PageCaptureCallback = (result: PageCaptureResult) => void;

export function captureCurrentPage(callback: PageCaptureCallback): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      callback({
        status: "unavailable",
        message: "Couldn't read this page. Reopen the extension and try again."
      });

      return;
    }

    const tab = tabs[0];

    if (typeof tab?.id !== "number" || !Number.isInteger(tab.id) || tab.id < 0 || !tab.url) {
      callback({
        status: "unavailable",
        message: "Couldn't read this page. Open the extension from a web page and try again."
      });

      return;
    }

    const parsedUrl = parseWebUrl(tab.url);

    if (!parsedUrl) {
      callback({
        status: "unsupported",
        message: "This page isn't supported. Open an HTTP or HTTPS page to preview it."
      });

      return;
    }

    callback({
      status: "ready",
      page: {
        tabId: tab.id,
        // Preserve the destination, including query parameters and fragments.
        url: tab.url,
        title: tab.title?.trim() || parsedUrl.hostname
      }
    });
  });
}
