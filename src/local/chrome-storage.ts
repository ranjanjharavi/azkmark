// The persistence boundary returns unvalidated values and local changed keys.
// Bookmark operations retain responsibility for validation and locking.
export class StorageQuotaError extends Error {
  constructor(message = "Bookmark storage quota exceeded.") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

function rethrowStorageError(cause: unknown): never {
  if (!(cause instanceof Error) || !cause.message) {
    throw new Error("Chrome storage operation failed.");
  }

  if (/quota/i.test(cause.message)) {
    throw new StorageQuotaError(cause.message);
  }
  throw cause;
}

export function readStorage(keys: string | null): Promise<Record<string, unknown>> {
  return chrome.storage.local.get(keys).catch(rethrowStorageError);
}

export function writeStorage(items: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(items).catch(rethrowStorageError);
}

export function removeStorage(key: string): Promise<void> {
  return chrome.storage.local.remove(key).catch(rethrowStorageError);
}

export function watchStorage(onChange: (keys: readonly string[]) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      onChange(Object.keys(changes));
    }
  });
}
