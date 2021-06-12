export function parseWebUrl(value: unknown, base?: string): URL | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  try {
    const url = base === undefined ? new URL(value) : new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

// Video identity detects stale previews. It never rewrites the saved URL.
export function youtubeVideoId(url: URL): string | undefined {
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
