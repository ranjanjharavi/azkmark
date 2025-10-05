declare namespace chrome {
  namespace runtime {
    interface LastError {
      message?: string;
    }

    const lastError: LastError | undefined;

    function getURL(path: string): string;
  }

  namespace extension {
    function getViews(fetchProperties: { type: "tab"; tabId?: number }): Window[];
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId: number;
      title?: string;
      url?: string;
    }

    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;

    function query(
      queryInfo: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: Tab[]) => void
    ): void;

    function create(createProperties: { url: string }): Promise<Tab>;

    function update(tabId: number, updateProperties: { active: boolean }): Promise<Tab | undefined>;
  }

  namespace windows {
    function update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>;
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
      function get(keys: string | null): Promise<Record<string, unknown>>;

      function set(items: Record<string, unknown>): Promise<void>;

      function remove(keys: string | string[]): Promise<void>;
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
