import assert from "node:assert/strict";
import test from "node:test";
import { initializeLibraryFocus } from "../dist/library/focus.js";

function useFocusHarness(t, library = [{ url: "https://example.com/saved" }]) {
  const document = { body: {}, activeElement: undefined };
  class Button {
    constructor(attributes = {}) {
      this.attributes = attributes;
      this.disabled = false;
      this.classList = { contains: () => false };
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name);
    }
    focus() {
      document.activeElement = this;
    }
    contains() {
      return false;
    }
    querySelectorAll() {
      return [];
    }
    querySelector() {
      return null;
    }
    getBoundingClientRect() {
      return { top: 0, bottom: 20, height: 20 };
    }
  }
  for (const [name, value] of Object.entries({ document, HTMLButtonElement: Button, HTMLAnchorElement: class {} })) {
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
  const names = ["searchInputElement", "domainSelectElement", "savedDateSelectElement",
    "viewStatusSelectElement", "tagSelect", "sortSelectElement", "toggleFiltersElement",
    "resetFiltersButton", "clearCollectionButton", "collectionNavigationElement",
    "manageCollectionsButton", "libraryHeadingElement", "retryButtonElement",
    "bookmarksListElement", "bookmarkDetailsElement"];
  const elements = Object.fromEntries(names.map((name) => [name, new Button()]));
  const context = { library, selectedUrl: library?.[0]?.url, collectionScope: "all" };
  return {
    document,
    Button,
    elements,
    context,
    focus: initializeLibraryFocus(elements, () => context),
  };
}

test("dialog close after a read failure focuses retry before inspecting stale actions", (t) => {
  const { focus, document, context, elements } = useFocusHarness(t);
  context.library = undefined;
  elements.bookmarkDetailsElement.querySelectorAll = () => {
    assert.fail("A failed library must not restore focus into stale details");
  };
  focus.restoreManagement({ url: "https://example.com/saved", mode: "edit" });
  assert.equal(document.activeElement, elements.retryButtonElement);
});

test("a filtered-out detail action falls back to the current selected row", (t) => {
  const { focus, document, Button, context, elements } = useFocusHarness(t);
  const selected = new Button({ "data-bookmark-url": context.selectedUrl });
  elements.bookmarksListElement.querySelectorAll = () => [selected];
  elements.bookmarksListElement.clientTop = 0;
  elements.bookmarksListElement.clientHeight = 100;
  elements.bookmarksListElement.scrollTop = 0;
  focus.restore({ target: "details", bookmarkUrl: "https://example.com/filtered", bookmarkAction: "viewed" });
  assert.equal(document.activeElement, selected);
});

test("read failure leaves unrelated dialog focus alone and recovers library controls", (t) => {
  const { focus, document, elements } = useFocusHarness(t);
  const dialogInput = {};
  document.activeElement = dialogInput;
  focus.restoreAfterReadError({ target: "other" });
  assert.equal(document.activeElement, dialogInput);
  focus.restoreAfterReadError({ target: "tag" });
  assert.equal(document.activeElement, elements.retryButtonElement);
});

test("an empty library restores control focus to its heading", (t) => {
  const { focus, document, elements } = useFocusHarness(t, []);
  focus.restore({ target: "search" });
  assert.equal(document.activeElement, elements.libraryHeadingElement);
  focus.reset();
  assert.equal(document.activeElement, elements.libraryHeadingElement);
});

test("viewed completion recovers a disabled action's lost focus after a failed read", (t) => {
  const { focus, document, context, elements, Button } = useFocusHarness(t);
  const previous = { target: "details", bookmarkUrl: context.selectedUrl, bookmarkAction: "viewed" };
  const button = new Button();
  document.activeElement = document.body;
  context.library = undefined;
  assert.equal(focus.afterViewedUpdate(button, previous.bookmarkUrl, true, previous), previous);
  assert.equal(document.activeElement, elements.retryButtonElement);
});

test("viewed completion does not steal focus moved to another control", (t) => {
  const { focus, document, context, elements, Button } = useFocusHarness(t);
  document.activeElement = elements.searchInputElement;
  const previous = { target: "details", bookmarkUrl: context.selectedUrl, bookmarkAction: "viewed" };
  const next = focus.afterViewedUpdate(new Button(), context.selectedUrl, true, previous);
  assert.deepEqual(next, { target: "search" });
  assert.equal(document.activeElement, elements.searchInputElement);
});
