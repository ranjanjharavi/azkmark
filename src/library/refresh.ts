interface RefreshWaiter {
  resolve: () => void;
  reject: (cause: unknown) => void;
}

const STORAGE_REFRESH_DELAY_MS = 100;

// One reader at a time; storage bursts share a fixed window to avoid thrashing the UI
export function createRefreshScheduler(readAndRender: () => Promise<void>): {
  refresh: () => Promise<void>;
  schedule: () => void;
} {
  let running = false;
  let queued = false;
  let timer: number | undefined;
  let waiters: RefreshWaiter[] = [];

  function clearTimer(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  async function flush(): Promise<void> {
    if (running || !queued) {
      return;
    }

    clearTimer();
    running = true;
    queued = false;
    // Requests arriving during this read belong to the next, fresh read
    const currentWaiters = waiters;
    waiters = [];

    try {
      await readAndRender();
      currentWaiters.forEach((waiter) => waiter.resolve());
    } catch (cause) {
      currentWaiters.forEach((waiter) => waiter.reject(cause));
      if (currentWaiters.length === 0) {
        console.error("Could not refresh the library after a storage change.", cause);
      }
    } finally {
      running = false;
      // Explicit requests bypass the delay; expired storage windows run next
      if (queued && (waiters.length > 0 || timer === undefined)) {
        void flush();
      }
    }
  }

  function refresh(): Promise<void> {
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
      queued = true;
      clearTimer();
      void flush();
    });
  }

  function schedule(): void {
    queued = true;
    if (timer === undefined) {
      timer = window.setTimeout(() => {
        timer = undefined;
        void flush();
      }, STORAGE_REFRESH_DELAY_MS);
    }
  }

  return { refresh, schedule };
}
