declare namespace chrome {
  namespace runtime {
    interface LastError {
      message?: string;
    }

    const lastError: LastError | undefined;

    function getURL(path: string): string;
  }

  namespace tabs {
    interface Tab {
      id?: number;
    }

    function create(
      createProperties: { url: string },
      callback?: (tab: Tab) => void
    ): void;
  }
}
