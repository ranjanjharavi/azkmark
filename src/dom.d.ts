declare interface HTMLDialogElement {
  open: boolean;
  close(returnValue?: string): void;
  showModal(): void;
}

// Retain a typed result for the exclusive Web Locks calls used by storage.
declare interface LockManager {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>;
}

declare interface Navigator {
  readonly locks: LockManager;
}
