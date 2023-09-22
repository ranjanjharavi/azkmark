const PREVIEW_TIMEOUT_MS = 10000;

interface PreviewRegistration {
  image: HTMLImageElement;
  start: () => void;
  dispose: () => void;
}

export function bookmarkPreview(thumbnailUrl: string): HTMLDivElement {
  const preview = document.createElement("div");
  preview.className = "bookmark-preview";

  const loading = document.createElement("p");
  loading.className = "preview-loading";
  loading.textContent = "Loading preview…";
  loading.setAttribute("aria-hidden", "true");

  const image = document.createElement("img");
  image.className = "bookmark-image";
  image.alt = "";
  image.width = 640;
  image.height = 360;
  image.setAttribute("loading", "lazy");
  image.setAttribute("decoding", "async");
  image.referrerPolicy = "no-referrer";
  // No request or expiry budget until this preview reaches the visible viewport
  image.setAttribute("data-thumbnail-url", thumbnailUrl);

  preview.appendChild(image);
  preview.appendChild(loading);
  return preview;
}

export function initializeBookmarkPreviews(host: HTMLElement): {
  observe: () => void;
  clear: () => void;
} {
  const pending = new Map<Element, PreviewRegistration>();
  const observer = new IntersectionObserver((entries) => {
    if (document.visibilityState !== "visible") {
      return;
    }
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        pending.get(entry.target)?.start();
      }
    });
  });

  function register(preview: HTMLDivElement): void {
    const image = preview.querySelector<HTMLImageElement>(".bookmark-image[data-thumbnail-url]");
    const loading = preview.querySelector<HTMLParagraphElement>(".preview-loading");
    const thumbnailUrl = image?.getAttribute("data-thumbnail-url");
    if (!image || !loading || !thumbnailUrl) {
      return;
    }

    const imageElement = image;
    const loadingElement = loading;
    const imageUrl = thumbnailUrl;
    let timer: number | undefined;
    let started = false;
    let disposed = false;

    function cleanup(): void {
      disposed = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      observer.unobserve(preview);
      imageElement.removeEventListener("load", loaded);
      imageElement.removeEventListener("error", failed);
      pending.delete(preview);
    }

    function dispose(): void {
      cleanup();
      imageElement.removeAttribute("src");
    }

    function loaded(): void {
      if (disposed) {
        return;
      }
      cleanup();
      imageElement.removeAttribute("data-thumbnail-url");
      imageElement.classList.add("loaded");
      loadingElement.remove();
    }

    function failed(): void {
      if (disposed) {
        return;
      }
      dispose();
      preview.remove();
    }

    function start(): void {
      if (started || disposed) {
        return;
      }
      if (!preview.isConnected) {
        dispose();
        return;
      }
      started = true;
      observer.unobserve(preview);
      // Visibility provides lazy loading; eager activation prevents native lazy
      imageElement.setAttribute("loading", "eager");
      timer = window.setTimeout(failed, PREVIEW_TIMEOUT_MS);
      imageElement.src = imageUrl;
    }

    imageElement.addEventListener("load", loaded);
    imageElement.addEventListener("error", failed);
    pending.set(preview, { image: imageElement, start, dispose });
    observer.observe(preview);
  }

  function observe(): void {
    host.querySelectorAll<HTMLDivElement>(".bookmark-preview").forEach((preview) => {
      if (!pending.has(preview)) {
        register(preview);
      }
    });
  }

  function clear(): void {
    observer.disconnect();
    pending.forEach((registration) => registration.dispose());
    pending.clear();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // A hidden-tab intersection callback must not leave a preview unstarted.
      pending.forEach((registration, preview) => {
        if (!registration.image.hasAttribute("src")) {
          observer.unobserve(preview);
          observer.observe(preview);
        }
      });
    }
  });
  window.addEventListener("pagehide", clear);
  window.addEventListener("pageshow", observe);

  return { observe, clear };
}
