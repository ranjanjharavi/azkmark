function queryTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "Could not find browser tabs."));
        return;
      }
      resolve(tabs);
    });
  });
}

function hasLibraryView(url: string, tabId?: number): boolean {
  // Inspect only this extension's loaded views, never another tab's URL/title.
  const views = tabId === undefined
    ? chrome.extension.getViews({ type: "tab" })
    : chrome.extension.getViews({ type: "tab", tabId });
  return views.some((view) => !view.closed && view.location.href === url);
}

async function findLibraryTab(url: string): Promise<chrome.tabs.Tab | undefined> {
  if (!hasLibraryView(url)) {
    return undefined;
  }
  const tabs = await queryTabs();
  return tabs.find((tab) => tab.id !== undefined && hasLibraryView(url, tab.id));
}

function activateTab(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "Could not activate the library tab."));
        return;
      }
      if (!tab) {
        reject(new Error("The library tab is no longer available."));
        return;
      }
      resolve(tab);
    });
  });
}

function focusWindow(windowId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, { focused: true }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "Could not focus the library window."));
        return;
      }
      resolve();
    });
  });
}

function createLibraryTab(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "Could not create a library tab."));
        return;
      }
      resolve();
    });
  });
}

export function openLibrary(): Promise<void> {
  return navigator.locks.request("azkmark:library-tab", async () => {
    const url = chrome.runtime.getURL("library.html");
    const existing = await findLibraryTab(url);
    if (existing?.id === undefined) {
      // Unloaded/discarded library documents have no view, keep the create path
      await createLibraryTab(url);
      return;
    }

    // Activate without navigating/reloading, preserving library filters and drafts
    const activated = await activateTab(existing.id);
    await focusWindow(activated.windowId);
  });
}
