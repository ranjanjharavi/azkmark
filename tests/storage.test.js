import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  COLLECTIONS_KEY,
  LAST_COLLECTION_KEY,
  deleteBookmark,
  deleteCollection,
  importBookmarkRecords,
  readLibrary,
  saveBookmark,
  updateBookmark,
  updateBookmarkViewed,
} from "../dist/bookmarks/storage.js";

// Only the storage and exclusive-lock APIs used by these tests are modeled.
// This does not simulate native Chrome storage, quota, or Web Locks lifecycle.
function useStorageHarness(t, initial = {}) {
  const data = structuredClone(initial);
  const reads = [];
  const writes = [];
  const requests = [];
  const heldLocks = new AsyncLocalStorage();
  const tails = new Map();
  t.after(() => heldLocks.disable());

  const local = {
    async get(key) {
      reads.push(key);
      if (key === null) {
        return structuredClone(data);
      }
      if (!Object.hasOwn(data, key)) {
        return {};
      }
      return structuredClone({ [key]: data[key] });
    },
    async set(items) {
      const snapshot = structuredClone(items);
      Object.assign(data, snapshot);
      const owned = heldLocks.getStore() ?? [];
      writes.push({ keys: Object.keys(snapshot), locks: [...owned] });
    },
    async remove(key) {
      delete data[key];
    },
  };
  const locks = {
    request(name, callback) {
      requests.push(name);
      const owned = heldLocks.getStore() ?? [];
      // Fail forbidden recursion immediately instead of reproducing a native deadlock.
      if (owned.includes(name)) {
        return Promise.reject(new Error("Reentrant lock request: " + name));
      }
      const previous = tails.get(name) ?? Promise.resolve();
      const pending = previous.then(() => heldLocks.run([...owned, name], callback));
      tails.set(name, pending.catch(() => {}));
      return pending;
    },
  };

  const globals = { chrome: { storage: { local } }, navigator: { locks } };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) {
        Object.defineProperty(globalThis, name, previous);
        return;
      }
      delete globalThis[name];
    });
  }

  return { data, reads, writes, requests, locks };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function bookmark(name, fields = {}) {
  return {
    url: `https://example.com/${name}`,
    title: `Saved ${name}`,
    savedAt: 1,
    ...fields,
  };
}

function bookmarkKey(url) {
  return "azkmark:bookmark:" + url;
}

const reading = Object.freeze({ id: "reading", name: "Reading" });
const work = Object.freeze({ id: "work", name: "Work" });

test("concurrent same-URL saves write once and retain the first winner's details", async (t) => {
  const harness = useStorageHarness(t);
  const first = bookmark("page?q=one#part", {
    thumbnailUrl: "https://images.example.com/first.png",
    viewed: true,
    tags: ["first"],
  });
  const second = {
    ...first,
    title: "Losing title",
    savedAt: 2,
    viewed: false,
    tags: ["second"],
  };

  const results = await Promise.all([saveBookmark(first), saveBookmark(second)]);
  assert.deepEqual(results.map((result) => result.status), ["saved", "already-saved"]);
  assert.deepEqual(results[0].bookmark, first);
  assert.deepEqual(results[1].bookmark, first);
  assert.deepEqual(harness.data[bookmarkKey(first.url)], first);
  assert.equal(harness.writes.length, 1);
});

test("save snapshots the record and remembered collection before waiting for a lock", async (t) => {
  const harness = useStorageHarness(t, { [COLLECTIONS_KEY]: [reading, work] });
  const gate = deferred();
  const holder = harness.locks.request(COLLECTIONS_KEY, () => gate.promise);
  await setImmediate();
  const draft = bookmark("original", {
    collectionId: reading.id,
    thumbnailUrl: "https://images.example.com/original.png",
    viewed: true,
    tags: ["original"],
  });
  const submitted = structuredClone(draft);
  const saving = saveBookmark(draft, true);

  draft.url = "https://example.com/replaced";
  draft.title = "Replaced title";
  draft.savedAt = 2;
  draft.thumbnailUrl = "https://images.example.com/replaced.png";
  draft.viewed = false;
  draft.collectionId = work.id;
  draft.tags[0] = "replaced";
  draft.tags.push("later");
  await setImmediate();
  assert.equal(harness.reads.length, 0);
  assert.equal(harness.writes.length, 0);

  gate.resolve();
  await holder;
  const result = await saving;
  const key = bookmarkKey(submitted.url);
  assert.deepEqual(result, { status: "saved", bookmark: submitted });
  assert.deepEqual(harness.data[key], submitted);
  assert.equal(harness.data[bookmarkKey(draft.url)], undefined);
  assert.equal(harness.data[LAST_COLLECTION_KEY], reading.id);
  assert.deepEqual(harness.requests, [COLLECTIONS_KEY, COLLECTIONS_KEY, key]);
  assert.deepEqual(harness.writes[0].locks, [COLLECTIONS_KEY, key]);
});

test("edit snapshots the trimmed title, tag array, and supplied fields before waiting", async (t) => {
  const record = bookmark("edit", { collectionId: reading.id, tags: ["saved"] });
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [COLLECTIONS_KEY]: [reading], [key]: record });
  const gate = deferred();
  const holder = harness.locks.request(key, () => gate.promise);
  await setImmediate();
  const draft = { title: "  Draft title  ", tags: ["draft"] };
  const editing = updateBookmark(record.url, draft);

  draft.title = "Changed after submitting";
  draft.tags[0] = "changed";
  draft.tags.push("later");
  draft.collectionId = null;
  await setImmediate();
  assert.equal(harness.reads.length, 0);

  gate.resolve();
  await holder;
  const result = await editing;
  const expected = { ...record, title: "Draft title", tags: ["draft"] };
  assert.deepEqual(result, { status: "updated", bookmark: expected });
  assert.deepEqual(harness.data[key], expected);
  assert.deepEqual(harness.requests, [key, key]);
  assert.deepEqual(draft, {
    title: "Changed after submitting",
    tags: ["changed", "later"],
    collectionId: null,
  });
});

test("title-only edits preserve untouched fields from the latest locked record", async (t) => {
  const original = bookmark("fresh-edit", { tags: ["old"] });
  const key = bookmarkKey(original.url);
  const harness = useStorageHarness(t, { [COLLECTIONS_KEY]: [work], [key]: original });
  const gate = deferred();
  const holder = harness.locks.request(key, () => gate.promise);
  await setImmediate();
  const editing = updateBookmark(original.url, { title: "Edited title" });
  const latest = {
    ...original,
    title: "Remote title",
    savedAt: 2,
    thumbnailUrl: "https://images.example.com/latest.png",
    viewed: true,
    collectionId: work.id,
    tags: ["remote"],
  };
  harness.data[key] = structuredClone(latest);

  gate.resolve();
  await holder;
  const result = await editing;
  const expected = { ...latest, title: "Edited title" };
  assert.deepEqual(result, { status: "updated", bookmark: expected });
  assert.deepEqual(harness.data[key], expected);
});

test("Viewed writes preserve the latest locked title, tags, collection, and metadata", async (t) => {
  const original = bookmark("fresh-viewed");
  const key = bookmarkKey(original.url);
  const harness = useStorageHarness(t, { [COLLECTIONS_KEY]: [work], [key]: original });
  const gate = deferred();
  const holder = harness.locks.request(key, () => gate.promise);
  await setImmediate();
  const updating = updateBookmarkViewed(original.url, true);
  const latest = {
    ...original,
    title: "Remote title",
    savedAt: 2,
    thumbnailUrl: "https://images.example.com/latest.png",
    collectionId: work.id,
    tags: ["remote"],
  };
  harness.data[key] = structuredClone(latest);

  gate.resolve();
  await holder;
  const result = await updating;
  const expected = { ...latest, viewed: true };
  assert.deepEqual(result, { status: "updated", bookmark: expected });
  assert.deepEqual(harness.data[key], expected);
});

test("queued title and Viewed edits cannot resurrect a deleted bookmark", async (t) => {
  const record = bookmark("deleted");
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [key]: record });

  const results = await Promise.all([
    deleteBookmark(record.url),
    updateBookmark(record.url, { title: "Too late" }),
    updateBookmarkViewed(record.url, true),
  ]);
  assert.deepEqual(results, [{ status: "deleted" }, { status: "not-found" }, { status: "not-found" }]);
  assert.equal(harness.data[key], undefined);
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.requests, [key, key, key]);
});

const membershipChanges = [
  { name: "assigning a collection", collectionId: work.id },
  { name: "clearing membership", collectionId: null },
];
for (const { name, collectionId } of membershipChanges) {
  test(`${name} takes the collection lock before the URL lock`, async (t) => {
    const record = bookmark("membership", { collectionId: reading.id, tags: ["keep"] });
    const key = bookmarkKey(record.url);
    const harness = useStorageHarness(t, { [COLLECTIONS_KEY]: [reading, work], [key]: record });

    const result = await updateBookmark(record.url, { collectionId });
    assert.equal(result.status, "updated");
    assert.equal(result.bookmark.collectionId, collectionId ?? undefined);
    assert.deepEqual(result.bookmark.tags, record.tags);
    assert.deepEqual(harness.requests, [COLLECTIONS_KEY, key]);
    assert.equal(harness.writes.length, 1);
    assert.deepEqual(harness.writes[0].locks, [COLLECTIONS_KEY, key]);
    await readLibrary();
  });
}

test("import snapshots the file before waiting and acquires the collection lock only once", async (t) => {
  const harness = useStorageHarness(t);
  const gate = deferred();
  const holder = harness.locks.request(COLLECTIONS_KEY, () => gate.promise);
  await setImmediate();
  const records = [
    bookmark("import-first", { collectionId: reading.id, tags: ["original"] }),
    bookmark("import-second", { collectionId: reading.id }),
  ];
  const definitions = [{ ...reading }];
  const submitted = structuredClone({ bookmarks: records, collections: definitions });
  const importing = importBookmarkRecords(records, definitions);

  records[0].url = "https://example.com/replaced";
  records[0].title = "Replaced title";
  records[0].tags.push("later");
  records.push(bookmark("injected"));
  definitions[0].id = "replaced";
  definitions[0].name = "Replaced name";
  definitions.push({ ...work });
  await setImmediate();
  assert.equal(harness.reads.length, 0);
  assert.equal(harness.writes.length, 0);

  gate.resolve();
  await holder;
  const result = await importing;
  const firstKey = bookmarkKey(submitted.bookmarks[0].url);
  const secondKey = bookmarkKey(submitted.bookmarks[1].url);
  assert.deepEqual(result, { status: "imported", added: 2, skipped: 0, collectionsAdded: 1 });
  assert.deepEqual(harness.requests, [COLLECTIONS_KEY, COLLECTIONS_KEY, firstKey, secondKey]);
  assert.deepEqual(harness.writes, [
    { keys: [COLLECTIONS_KEY], locks: [COLLECTIONS_KEY] },
    { keys: [firstKey], locks: [COLLECTIONS_KEY, firstKey] },
    { keys: [secondKey], locks: [COLLECTIONS_KEY, secondKey] },
  ]);
  assert.deepEqual(await readLibrary(), submitted);
});

test("collection deletion takes the outer collection lock and separate member URL locks", async (t) => {
  const first = bookmark("move-first", { collectionId: reading.id, tags: ["keep"] });
  const second = bookmark("move-second", { collectionId: reading.id, viewed: true });
  const unrelated = bookmark("unrelated", { collectionId: work.id });
  const firstKey = bookmarkKey(first.url);
  const secondKey = bookmarkKey(second.url);
  const unrelatedKey = bookmarkKey(unrelated.url);
  const harness = useStorageHarness(t, {
    [COLLECTIONS_KEY]: [reading, work],
    [firstKey]: first,
    [secondKey]: second,
    [unrelatedKey]: unrelated,
  });

  const result = await deleteCollection(reading.id);
  assert.deepEqual(result, { status: "deleted", moved: 2 });
  assert.deepEqual(harness.requests, [COLLECTIONS_KEY, firstKey, secondKey]);
  assert.deepEqual(harness.writes, [
    { keys: [firstKey], locks: [COLLECTIONS_KEY, firstKey] },
    { keys: [secondKey], locks: [COLLECTIONS_KEY, secondKey] },
    { keys: [COLLECTIONS_KEY], locks: [COLLECTIONS_KEY] },
  ]);
  assert.deepEqual(harness.data[COLLECTIONS_KEY], [work]);
  assert.equal(harness.data[firstKey].collectionId, undefined);
  assert.equal(harness.data[secondKey].collectionId, undefined);
  assert.deepEqual({ ...harness.data[firstKey], collectionId: reading.id }, first);
  assert.deepEqual({ ...harness.data[secondKey], collectionId: reading.id }, second);
  assert.deepEqual(harness.data[unrelatedKey], unrelated);
  await readLibrary();
});
