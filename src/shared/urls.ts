export function parseWebUrl(value: unknown, base?: string): URL | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  try {
    const url = base === undefined ? new URL(value) : new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
