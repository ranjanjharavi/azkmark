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
      title?: string;
      url?: string;
    }

    function query(
      queryInfo: { active: boolean; currentWindow: boolean },
      callback: (tabs: Tab[]) => void
    ): void;

    function create(
      createProperties: { url: string },
      callback?: (tab: Tab) => void
    ): void;
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }

    const onChanged: {
      addListener(
        callback: (changes: Record<string, StorageChange>, areaName: string) => void
      ): void;
    };

    namespace local {
      function get(
        keys: string | null,
        callback: (items: Record<string, unknown>) => void
      ): void;

      function set(items: Record<string, unknown>, callback: () => void): void;

      function remove(keys: string | string[], callback: () => void): void;
    }
  }

  namespace scripting {
    interface InjectionResult {
      frameId: number;
      result?: unknown;
    }

    function executeScript(
      injection: {
        target: { tabId: number; frameIds?: number[] };
        files: string[];
      },
      callback: (results: InjectionResult[]) => void
    ): void;
  }
}
