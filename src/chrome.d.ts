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

  namespace scripting {
    interface InjectionResult {
      frameId: number;
      result?: unknown;
    }

    function executeScript(
      injection: {
        target: { tabId: number; frameIds?: number[] };
        func: () => unknown;
      },
      callback: (results: InjectionResult[]) => void
    ): void;
  }
}
