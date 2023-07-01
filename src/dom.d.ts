// Retain a typed result for the exclusive Web Locks calls used by storage.
declare interface LockManager {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>;
}
