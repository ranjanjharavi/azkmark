// Injected as a classic script. The final expression is returned to the popup.
(() => {
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
})();
