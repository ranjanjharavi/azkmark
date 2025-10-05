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
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.id !== undefined && hasLibraryView(url, tab.id));
}

export function openLibrary(): Promise<void> {
  return navigator.locks.request("azkmark:library-tab", async () => {
    const url = chrome.runtime.getURL("library.html");
    const existing = await findLibraryTab(url);
    if (existing?.id === undefined) {
      // Unloaded/discarded library documents have no view, keep the create path
      await chrome.tabs.create({ url });
      return;
    }

    // Activate without navigating/reloading, preserving library filters and drafts
    const activated = await chrome.tabs.update(existing.id, { active: true });
    if (!activated) {
      throw new Error("The library tab is no longer available.");
    }
    await chrome.windows.update(activated.windowId, { focused: true });
  });
}
