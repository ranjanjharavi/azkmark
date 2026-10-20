import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { initializePopup } from "../dist/popup/page.js";
import { COLLECTIONS_KEY, LAST_COLLECTION_KEY } from "../dist/bookmarks/storage.js";

const popupMarkup = readFileSync(new URL("../public/popup.html", import.meta.url), "utf8");
const reading = { id: "reading", name: "Reading" };
const work = { id: "work", name: "Work" };
const capturedPage = {
  id: 7,
  windowId: 1,
  url: "https://example.com/article?draft=1#section",
  title: "Captured page title"
};
const bookmarkKey = "azkmark:bookmark:" + capturedPage.url;

// Model only the DOM operations used by the popup and its shared controls.
// Events are driven explicitly; this is not a renderer or native form/focus test.
function createPopupDocument() {
  class Element {
    constructor(tagName, attributes = {}) {
      this.tagName = tagName.toUpperCase();
      this.attributes = attributes;
      this.children = [];
      this.listeners = new Map();
      this.value = "";
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      this.readOnly = false;
    }

    get selectedOptions() {
      const selected = this.querySelectorAll("option").find((option) => option.value === this.value);
      return selected ? [selected] : [];
    }

    get src() {
      return this.getAttribute("src") ?? "";
    }

    set src(value) {
      this.setAttribute("src", value);
    }

    getAttribute(name) {
      return this.attributes[name] ?? null;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    removeAttribute(name) {
      delete this.attributes[name];
    }

    appendChild(child) {
      if (child.tagName === "#FRAGMENT") {
        this.children.push(...child.children);
        child.children = [];
      } else {
        this.children.push(child);
      }
      return child;
    }

    append(...children) {
      for (const child of children) {
        this.appendChild(child);
      }
    }

    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    }

    querySelectorAll(tagName) {
      const matches = [];
      for (const child of this.children) {
        if (child.tagName === tagName.toUpperCase()) {
          matches.push(child);
        }
        matches.push(...child.querySelectorAll(tagName));
      }
      return matches;
    }

    focus() {
      document.activeElement = this;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    async emit(type) {
      for (const listener of this.listeners.get(type) ?? []) {
        await listener({ preventDefault() {} });
      }
    }
  }

  const elements = new Map();
  // Read bindings and initial hidden/disabled states from the production HTML.
  for (const match of popupMarkup.matchAll(/<([a-z]+)\b([^>]*\sid="([^"]+)"[^>]*)>/g)) {
    const [, tagName, source, id] = match;
    const attributes = {};
    for (const attribute of source.matchAll(/([\w-]+)="([^"]*)"/g)) {
      attributes[attribute[1]] = attribute[2];
    }
    const element = new Element(tagName, attributes);
    element.hidden = /\shidden(?:\s|$)/.test(source);
    element.disabled = /\sdisabled(?:\s|$)/.test(source);
    assert.equal(elements.has(id), false, `Duplicate popup ID: ${id}`);
    elements.set(id, element);
  }

  const document = {
    body: new Element("body"),
    querySelector: (selector) => elements.get(selector.slice(1)) ?? null,
    createElement: (tagName) => new Element(tagName),
    createDocumentFragment: () => new Element("#fragment")
  };
  document.activeElement = document.body;
  class Option extends Element {
    constructor(text, value) {
      super("option");
      this.textContent = text;
      this.value = value;
    }
  }
  return { document, Option, element: (id) => elements.get(id) };
}

async function usePopupHarness(t, { initial = {}, tab = capturedPage, thumbnailUrl } = {}) {
  const dom = createPopupDocument();
  const data = structuredClone({
    [COLLECTIONS_KEY]: [reading, work],
    [LAST_COLLECTION_KEY]: reading.id,
    ...initial
  });
  const createdTabs = [];
  const timers = new Map();
  const storageListeners = [];
  let nextTimer = 0;
  const local = {
    async get(key) {
      if (key === null) {
        return structuredClone(data);
      }
      return Object.hasOwn(data, key) ? structuredClone({ [key]: data[key] }) : {};
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    }
  };
  const chrome = {
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    extension: { getViews: () => [] },
    tabs: {
      query(_options, callback) {
        callback([tab]);
      },
      async create(options) {
        createdTabs.push(options);
      }
    },
    scripting: {
      executeScript(_options, callback) {
        const results = [];
        if (thumbnailUrl) {
          results.push({
            frameId: 0,
            result: {
              pageUrl: tab.url,
              baseUrl: tab.url,
              canonicalUrl: null,
              imageUrls: [thumbnailUrl]
            }
          });
        }
        callback(results);
      }
    },
    storage: { local, onChanged: { addListener: (listener) => storageListeners.push(listener) } }
  };
  const window = {
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
  // Lock ordering/concurrency belongs to storage.test.js, not this UI harness.
  const navigator = { locks: { request: async (_name, callback) => callback() } };
  for (const [name, value] of Object.entries({
    document: dom.document,
    Option: dom.Option,
    chrome,
    window,
    navigator
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) {
        Object.defineProperty(globalThis, name, previous);
      } else {
        delete globalThis[name];
      }
    });
  }
  t.after(() => timers.clear());
  initializePopup();
  await setImmediate();
  return {
    ...dom,
    chrome,
    local,
    data,
    createdTabs,
    runTimers(delay) {
      for (const [id, timer] of Array.from(timers)) {
        if (timer.delay === delay) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    notifyCollections() {
      for (const listener of storageListeners) {
        listener({ [COLLECTIONS_KEY]: {} }, "local");
      }
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function addDraftTag(element, value) {
  element("page-tag").value = value;
  await element("page-tag-add").emit("click");
}

function draftTags(element) {
  return element("page-tags").children.map((item) => item.children[0].textContent);
}

test("capture shows the domain but preserves the full title and destination without stealing focus", async (t) => {
  const { element, document } = await usePopupHarness(t);
  assert.equal(element("page-details").hidden, false);
  assert.equal(element("page-status").hidden, true);
  assert.equal(element("page-title").value, capturedPage.title);
  assert.equal(element("page-url").textContent, "example.com");
  assert.equal(element("page-url").href, capturedPage.url);
  assert.equal(element("page-url").title, capturedPage.url);
  assert.equal(element("page-url").getAttribute("aria-label"), `Open current page: ${capturedPage.url}`);
  assert.equal(element("save-to").value, reading.id);
  assert.equal(element("save").disabled, false);
  assert.equal(element("page-image").hidden, true);
  assert.equal(element("preview-status").textContent, "No thumbnail available.");
  assert.equal(document.activeElement, document.body);
});

test("unsupported pages retain feedback and library access while saving stays disabled", async (t) => {
  const { element, createdTabs } = await usePopupHarness(t, {
    tab: { ...capturedPage, url: "chrome://extensions" }
  });
  assert.equal(element("page-details").hidden, true);
  assert.equal(element("page-status").hidden, false);
  assert.match(element("page-status").textContent, /isn't supported/);
  assert.equal(element("save").disabled, true);
  await element("open-library").emit("click");
  assert.deepEqual(createdTabs, [{ url: "chrome-extension://test/library.html" }]);
});

test("invalid titles focus the title and keep both draft chips and pending tag text", async (t) => {
  const { element, document, data } = await usePopupHarness(t);
  await addDraftTag(element, "  Draft Tag  ");
  element("page-tag").value = "pending tag";
  element("page-title").value = "   ";
  await element("save-form").emit("submit");
  assert.equal(element("title-error").hidden, false);
  assert.equal(element("page-title").getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, element("page-title"));
  assert.deepEqual(draftTags(element), ["draft tag"]);
  assert.equal(element("page-tag").value, "pending tag");
  assert.equal(data[bookmarkKey], undefined);

  element("page-title").value = "Valid title";
  await element("page-title").emit("input");
  assert.equal(element("title-error").hidden, true);
  assert.equal(element("page-title").getAttribute("aria-invalid"), null);
});

test("tag validation stays actionable and removing a chip recovers focus to the input", async (t) => {
  const { element, document, data } = await usePopupHarness(t);
  await addDraftTag(element, "design");
  await element("page-tags").querySelectorAll("button")[0].emit("click");
  assert.equal(element("page-tags").hidden, true);
  assert.equal(document.activeElement, element("page-tag"));
  element("page-tag").value = "x".repeat(81);
  await element("save-form").emit("submit");
  assert.equal(element("page-tag-error").hidden, false);
  assert.equal(element("page-tag").getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, element("page-tag"));
  assert.equal(data[bookmarkKey], undefined);
});

test("saving freezes controls, blocks duplicate submits, and finishes without waiting for image load", async (t) => {
  const thumbnailUrl = "https://images.example.com/cover.jpg";
  const { element, document, local, data } = await usePopupHarness(t, { thumbnailUrl });
  const gate = deferred();
  const write = local.set;
  const writes = t.mock.method(local, "set", async (items) => {
    await gate.promise;
    await write(items);
  });
  await addDraftTag(element, "design");
  element("page-tag").value = "  Pending Tag  ";
  element("page-title").value = "  Edited title  ";
  element("save").focus();
  const pending = element("save-form").emit("submit");
  await setImmediate();
  assert.equal(element("save").disabled, true);
  assert.equal(element("save-to").disabled, true);
  assert.equal(element("page-title").readOnly, true);
  assert.equal(element("page-tag").readOnly, true);
  assert.equal(element("page-tag-add").disabled, true);
  assert.equal(element("page-tags").querySelectorAll("button")[0].disabled, true);
  assert.equal(element("save-form").getAttribute("aria-busy"), "true");
  await element("save-form").emit("submit");
  assert.equal(writes.mock.callCount(), 1);
  // Model Chrome dropping focus when the focused submit becomes disabled.
  document.body.focus();
  gate.resolve();
  await pending;

  assert.equal(data[bookmarkKey].url, capturedPage.url);
  assert.equal(data[bookmarkKey].title, "Edited title");
  assert.equal(data[bookmarkKey].thumbnailUrl, thumbnailUrl);
  assert.deepEqual(data[bookmarkKey].tags, ["design", "pending tag"]);
  assert.equal(element("page-title").value, data[bookmarkKey].title);
  assert.equal(element("page-tag").value, "");
  assert.equal(element("page-image").hidden, true);
  assert.equal(element("save").textContent, "Saved");
  assert.equal(element("save").disabled, true);
  assert.equal(element("save-form").getAttribute("aria-busy"), "false");
  assert.equal(document.activeElement, element("open-library"));
});

test("duplicate saves restore the stored title, tags, and collection without overwriting them", async (t) => {
  const stored = {
    url: capturedPage.url,
    title: "An authoritative saved title that is longer than the newly captured page title",
    tags: ["saved"],
    collectionId: work.id,
    savedAt: 1
  };
  const { element, data } = await usePopupHarness(t, { initial: { [bookmarkKey]: stored } });
  element("page-title").value = "New draft title";
  element("page-tag").value = "new draft tag";
  await element("save-form").emit("submit");
  assert.deepEqual(data[bookmarkKey], stored);
  assert.equal(element("page-title").value, stored.title);
  assert.equal(element("page-title").readOnly, true);
  assert.deepEqual(draftTags(element), stored.tags);
  assert.equal(element("save-to").value, work.id);
  assert.equal(element("save").textContent, "Saved");
  assert.equal(element("save-status").textContent, "Already saved. Kept its saved details.");
});

for (const { message, feedback } of [
  { message: "Write failed", feedback: /Couldn't save this page/ },
  { message: "QUOTA_BYTES exceeded", feedback: /Storage is full/ }
]) {
  test(`${message}: failed saves keep drafts, recover focus, and allow a successful retry`, async (t) => {
    const { element, document, local, data } = await usePopupHarness(t);
    await addDraftTag(element, "design");
    element("page-tag").value = "  pending  ";
    element("page-title").value = "Draft title";
    const failure = t.mock.method(local, "set", async () => {
      throw new Error(message);
    });
    element("save").focus();
    const pending = element("save-form").emit("submit");
    document.body.focus();
    await pending;
    assert.equal(data[bookmarkKey], undefined);
    assert.equal(element("page-title").value, "Draft title");
    assert.equal(element("page-title").readOnly, false);
    assert.equal(element("page-tag").value, "  pending  ");
    assert.equal(element("page-tag").readOnly, false);
    assert.deepEqual(draftTags(element), ["design"]);
    assert.equal(element("save-to").value, reading.id);
    assert.equal(element("save").disabled, false);
    assert.equal(element("save").textContent, "Save bookmark");
    assert.equal(element("save-error").hidden, false);
    assert.match(element("save-error").textContent, feedback);
    assert.equal(element("save-form").getAttribute("aria-busy"), "false");
    assert.equal(document.activeElement, element("save"));
    failure.mock.restore();
    await element("save-form").emit("submit");
    assert.deepEqual(data[bookmarkKey].tags, ["design", "pending"]);
    assert.equal(element("save-error").hidden, true);
  });
}

test("save completion preserves focus moved to another control while the write was pending", async (t) => {
  const { element, document, local } = await usePopupHarness(t);
  const gate = deferred();
  const write = local.set;
  t.mock.method(local, "set", async (items) => {
    await gate.promise;
    await write(items);
  });
  element("save").focus();
  const pending = element("save-form").emit("submit");
  await setImmediate();
  element("page-title").focus();
  gate.resolve();
  await pending;
  assert.equal(element("save").textContent, "Saved");
  assert.equal(document.activeElement, element("page-title"));
});

test("a collection removed during the draft stays selected until the user chooses a valid destination", async (t) => {
  const { element, document, data } = await usePopupHarness(t);
  element("page-tag").value = "pending";
  data[COLLECTIONS_KEY] = [work];
  await element("save-form").emit("submit");
  assert.equal(data[bookmarkKey], undefined);
  assert.equal(element("save-to").value, reading.id);
  assert.equal(element("save-to").selectedOptions[0].disabled, true);
  assert.match(element("save-error").textContent, /no longer available/);
  assert.equal(element("page-tag").value, "pending");
  await element("save-form").emit("submit");
  assert.equal(document.activeElement, element("save-to"));

  element("save-to").value = "";
  await element("save-to").emit("change");
  await element("save-form").emit("submit");
  assert.deepEqual(data[bookmarkKey].tags, ["pending"]);
  assert.equal(data[bookmarkKey].collectionId, undefined);
});

test("passive collection refresh preserves title/tag drafts and the user's current focus", async (t) => {
  const { element, document, data, notifyCollections, runTimers } = await usePopupHarness(t);
  await addDraftTag(element, "draft");
  element("page-title").value = "Draft title";
  element("page-tag").value = "pending";
  element("page-tag").focus();
  data[COLLECTIONS_KEY] = [work];
  notifyCollections();
  runTimers(100);
  await setImmediate();
  assert.equal(element("page-title").value, "Draft title");
  assert.equal(element("page-tag").value, "pending");
  assert.deepEqual(draftTags(element), ["draft"]);
  assert.equal(element("save-to").selectedOptions[0].disabled, true);
  assert.equal(document.activeElement, element("page-tag"));
});

for (const failure of ["error", "timeout"]) {
  test(`thumbnail ${failure} collapses the image and ignores a late load`, async (t) => {
    const { element, runTimers } = await usePopupHarness(t, {
      thumbnailUrl: "https://images.example.com/cover.jpg"
    });
    const image = element("page-image");
    assert.equal(element("preview-status").textContent, "Loading thumbnail…");
    if (failure === "error") {
      await image.emit("error");
    } else {
      runTimers(1500);
    }
    assert.equal(image.hidden, true);
    assert.equal(image.getAttribute("src"), null);
    assert.equal(element("preview-status").textContent, "No thumbnail available.");
    await image.emit("load");
    assert.equal(image.hidden, true);
    assert.equal(element("save").disabled, false);
  });
}

test("library failures recover the header action and focus, then allow retry", async (t) => {
  const { element, document, chrome, createdTabs } = await usePopupHarness(t);
  t.mock.method(console, "error", () => {});
  const gate = deferred();
  const create = t.mock.method(chrome.tabs, "create", () => gate.promise);
  element("open-library").focus();
  const pending = element("open-library").emit("click");
  await setImmediate();
  assert.equal(element("open-library").disabled, true);
  assert.equal(element("open-library").getAttribute("aria-busy"), "true");
  await element("open-library").emit("click");
  assert.equal(create.mock.callCount(), 1);
  document.body.focus();
  gate.reject(new Error("Couldn't create tab"));
  await pending;
  assert.equal(element("open-library").disabled, false);
  assert.equal(element("open-library").getAttribute("aria-busy"), "false");
  assert.equal(element("feedback").hidden, false);
  assert.equal(document.activeElement, element("open-library"));
  create.mock.restore();
  await element("open-library").emit("click");
  assert.equal(element("feedback").hidden, true);
  assert.deepEqual(createdTabs, [{ url: "chrome-extension://test/library.html" }]);
});
