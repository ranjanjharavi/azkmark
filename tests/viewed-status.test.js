import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { initializeViewedStatus } from "../dist/library/workspace/viewed-status.js";

function useViewedHarness(t) {
  const url = "https://example.com/saved";
  const key = "azkmark:bookmark:" + url;
  const data = { [key]: { url, title: "Saved title", savedAt: 1, tags: ["saved"] } };
  const feedback = { textContent: "" };
  const error = { hidden: true, textContent: "" };
  const button = {
    disabled: false,
    dataset: { viewed: "true" },
    attributes: { "data-viewed": "true" },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
  const document = {
    activeElement: button,
    querySelector(selector) {
      if (selector === "#viewed-feedback") return feedback;
      if (selector === "#viewed-error") return error;
      return null;
    }
  };
  const local = {
    async get(requested) {
      return Object.hasOwn(data, requested) ? { [requested]: structuredClone(data[requested]) } : {};
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    }
  };
  const globals = {
    document,
    chrome: { storage: { local } },
    navigator: { locks: { request: async (_name, callback) => callback() } }
  };
  for (const [name, value] of Object.entries(globals)) {
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
  const snapshot = { target: "details", bookmarkUrl: url, bookmarkAction: "viewed" };
  const rendered = [];
  const refreshed = [];
  const callbacks = {
    async refresh() {
      refreshed.push(status.isPending(url));
    }
  };
  const status = initializeViewedStatus({
    refresh: () => callbacks.refresh(),
    render: (focus) => rendered.push({ focus, pending: status.isPending(url) }),
    focus: {
      capture: () => snapshot,
      afterViewedUpdate(_button, _url, wasFocused, previous) {
        assert.equal(wasFocused, true);
        return previous;
      }
    }
  });
  return { url, key, data, local, button, feedback, error, snapshot, rendered, refreshed, callbacks, status };
}

test("a pending viewed write blocks duplicate submissions and stays pending through refresh", async (t) => {
  const harness = useViewedHarness(t);
  const { status, url, button, local, data, key, refreshed, rendered, snapshot } = harness;
  let finish;
  const writeGate = new Promise((resolve) => {
    finish = resolve;
  });
  const write = local.set;
  const writes = t.mock.method(local, "set", async (items) => {
    await writeGate;
    await write(items);
  });
  const pending = status.update(button, url);
  await status.update(button, url);
  await setImmediate();
  assert.equal(writes.mock.callCount(), 1);
  assert.equal(status.isPending(url), true);
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-busy"], "true");
  finish();
  await pending;
  assert.equal(data[key].viewed, true);
  assert.deepEqual(refreshed, [true]);
  assert.deepEqual(rendered, [{ focus: snapshot, pending: false }]);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes["aria-busy"], "false");
});

test("a quota failure clears pending state, keeps data intact, and permits retry", async (t) => {
  const { status, url, local, data, key, button, error } = useViewedHarness(t);
  const original = structuredClone(data);
  const write = local.set;
  local.set = async () => {
    throw new Error("QUOTA_BYTES exceeded");
  };
  await status.update(button, url);
  assert.deepEqual(data, original);
  assert.equal(status.isPending(url), false);
  assert.equal(button.disabled, false);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /Storage is full/);
  local.set = write;
  await status.update(button, url);
  assert.equal(data[key].viewed, true);
  assert.equal(error.hidden, true);
});

test("a removed bookmark refreshes the library without recreating the record", async (t) => {
  const { status, url, data, key, button, error, refreshed } = useViewedHarness(t);
  delete data[key];
  await status.update(button, url);
  assert.equal(Object.hasOwn(data, key), false);
  assert.deepEqual(refreshed, [true]);
  assert.equal(status.isPending(url), false);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /no longer saved/);
});

test("an invalid stored record is not overwritten and the status button remains usable", async (t) => {
  const { status, url, data, key, button, error } = useViewedHarness(t);
  data[key].unexpected = true;
  const original = structuredClone(data);
  await status.update(button, url);
  assert.deepEqual(data, original);
  assert.equal(status.isPending(url), false);
  assert.equal(button.disabled, false);
  assert.match(error.textContent, /saved data is invalid/);
});

test("refresh rejection after a write still clears pending state and renders recovery", async (t) => {
  const { status, url, data, key, button, callbacks, rendered, error } = useViewedHarness(t);
  callbacks.refresh = async () => {
    throw new Error("Refresh failed");
  };
  await status.update(button, url);
  assert.equal(data[key].viewed, true);
  assert.equal(status.isPending(url), false);
  assert.equal(button.disabled, false);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].pending, false);
  assert.match(error.textContent, /Couldn't save status/);
});
