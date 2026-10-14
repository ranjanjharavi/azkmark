import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  COLLECTIONS_KEY,
  LAST_COLLECTION_KEY,
  StorageQuotaError,
  deleteBookmark,
  deleteCollection,
  importBookmarkRecords,
  readCollections,
  readLastCollection,
  readLibrary,
  saveBookmark,
  saveCollection,
  updateBookmark,
  updateBookmarkViewed,
  addBookmarkNote,
  updateBookmarkNote,
  deleteBookmarkNote,
  watchBookmarks,
} from "../dist/bookmarks/storage.js";

// Only the storage and exclusive-lock APIs used by these tests are modeled.
// This does not simulate native Chrome storage, quota, or Web Locks lifecycle.
function useStorageHarness(t, initial = {}) {
  const data = structuredClone(initial);
  const reads = [];
  const writes = [];
  const requests = [];
  const changeListeners = [];
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

  const onChanged = {
    addListener(listener) {
      changeListeners.push(listener);
    },
  };
  const globals = { chrome: { storage: { local, onChanged } }, navigator: { locks } };
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

  return { data, reads, writes, requests, changeListeners, locks, local };
}

function rejectWrite(t, local, key, cause) {
  const write = local.set;
  return t.mock.method(local, "set", async (items) => {
    if (Object.hasOwn(items, key)) {
      throw cause;
    }
    await write(items);
  });
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

const note = (id, body = "**Research**") => ({ id, body, createdAt: 10 });

test("concurrent note additions and metadata edits preserve all locked fields", async (t) => {
  const record = bookmark("journal", { tags: ["keep"], thumbnailUrl: "https://example.com/image.png" });
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [key]: record });
  await Promise.all([
    addBookmarkNote(record.url, note("first")),
    addBookmarkNote(record.url, note("second")),
    updateBookmark(record.url, { title: "Updated" }),
    updateBookmarkViewed(record.url, true),
  ]);
  assert.deepEqual(harness.data[key].notes, [note("first"), note("second")]);
  assert.equal(harness.data[key].title, "Updated");
  assert.equal(harness.data[key].viewed, true);
  assert.equal(harness.data[key].savedAt, record.savedAt);
  assert.deepEqual(harness.data[key].tags, ["keep"]);
  assert.equal(harness.data[key].thumbnailUrl, record.thumbnailUrl);
  assert.ok(harness.writes.every((write) => write.locks.includes(key)));
});

test("note additions snapshot input before locks and retries do not duplicate entries", async (t) => {
  const record = bookmark("retry-note");
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [key]: record });
  const original = note("stable");
  const pending = addBookmarkNote(record.url, original);
  original.body = "changed by caller";
  assert.equal((await pending).status, "updated");
  assert.equal((await addBookmarkNote(record.url, note("stable"))).status, "unchanged");
  assert.equal(harness.data[key].notes.length, 1);
  assert.equal(harness.writes.length, 1);
  assert.equal((await addBookmarkNote(record.url, note("stable", "different"))).status, "conflict");
});

test("stale edits and deletes conflict while different entries remain independent", async (t) => {
  const first = note("first");
  const second = note("second");
  const record = bookmark("conflicts", { notes: [first, second] });
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [key]: record });
  const results = await Promise.all([
    updateBookmarkNote(record.url, first, "first edit"),
    updateBookmarkNote(record.url, first, "stale edit"),
    updateBookmarkNote(record.url, second, "independent edit"),
  ]);
  assert.deepEqual(results.map(({ status }) => status), ["updated", "conflict", "updated"]);
  assert.equal((await deleteBookmarkNote(record.url, first)).status, "conflict");
  assert.deepEqual(harness.data[key].notes.map(({ body }) => body), ["first edit", "independent edit"]);
  assert.equal(harness.data[key].notes[0].createdAt, first.createdAt);
});

test("deleting the last note omits the field and missing targets are never recreated", async (t) => {
  const original = note("only");
  const record = bookmark("remove-notes", { notes: [original] });
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [key]: record });
  assert.equal((await deleteBookmarkNote(record.url, original)).status, "updated");
  assert.equal(Object.hasOwn(harness.data[key], "notes"), false);
  assert.equal((await updateBookmarkNote(record.url, original, "gone")).status, "note-not-found");
  await deleteBookmark(record.url);
  assert.equal((await addBookmarkNote(record.url, note("new"))).status, "not-found");
  assert.equal(Object.hasOwn(harness.data, key), false);
});

test("failed note writes preserve saved data and permit an idempotent retry", async (t) => {
  const record = bookmark("quota-note");
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [key]: record });
  const failure = rejectWrite(t, harness.local, key, new Error("QUOTA_BYTES exceeded"));
  await assert.rejects(addBookmarkNote(record.url, note("retry")), StorageQuotaError);
  assert.deepEqual(harness.data[key], record);
  failure.mock.restore();
  assert.equal((await addBookmarkNote(record.url, note("retry"))).status, "updated");
});

test("imports skip duplicate URLs without replacing existing notes", async (t) => {
  const record = bookmark("import-notes", { notes: [note("existing")] });
  const key = bookmarkKey(record.url);
  const harness = useStorageHarness(t, { [key]: record });
  const result = await importBookmarkRecords([{ ...record, notes: [note("incoming")] }]);
  assert.equal(result.skipped, 1);
  assert.deepEqual(harness.data[key].notes, record.notes);
});

test("library reads preserve exact URL keys and ignore unrelated Chrome storage", async (t) => {
  const record = bookmark("page/?q=one#part", {
    collectionId: reading.id,
    thumbnailUrl: "https://images.example.com/preview.png",
    tags: ["keep"],
    viewed: true,
  });
  const initial = {
    [bookmarkKey(record.url)]: record,
    [COLLECTIONS_KEY]: [reading, work],
    [LAST_COLLECTION_KEY]: reading.id,
    unrelated: { invalidBookmark: true },
  };
  const harness = useStorageHarness(t, initial);

  assert.deepEqual(await readLibrary(), { bookmarks: [record], collections: [reading, work] });
  assert.deepEqual(await readCollections(), [reading, work]);
  assert.equal(await readLastCollection(), reading.id);
  assert.deepEqual(harness.data, initial);
  assert.deepEqual(harness.writes, []);
});

test("bookmark watchers report only managed changes in local storage", (t) => {
  const harness = useStorageHarness(t);
  let notifications = 0;
  watchBookmarks(() => {
    notifications++;
  });
  assert.equal(harness.changeListeners.length, 1);
  const [notify] = harness.changeListeners;
  const key = bookmarkKey("https://example.com/watched");

  notify({ [key]: {} }, "sync");
  notify({ [COLLECTIONS_KEY]: {} }, "session");
  notify({ [LAST_COLLECTION_KEY]: {}, unrelated: {} }, "local");
  notify({}, "local");
  assert.equal(notifications, 0);

  notify({ [key]: {} }, "local");
  assert.equal(notifications, 1);
  notify({ [COLLECTIONS_KEY]: {} }, "local");
  assert.equal(notifications, 2);
  notify({ [key]: {}, [COLLECTIONS_KEY]: {} }, "local");
  assert.equal(notifications, 3);
  assert.deepEqual(harness.reads, []);
  assert.deepEqual(harness.writes, []);
});

test("unchanged bookmark and collection edits avoid persistence writes", async (t) => {
  const record = bookmark("unchanged", { collectionId: reading.id, tags: ["keep"], viewed: true });
  const initial = { [COLLECTIONS_KEY]: [reading], [bookmarkKey(record.url)]: record };
  const harness = useStorageHarness(t, initial);

  assert.deepEqual(await updateBookmark(record.url, {
    title: `  ${record.title}  `,
    collectionId: reading.id,
    tags: ["keep"],
  }), { status: "unchanged", bookmark: record });
  assert.deepEqual(await updateBookmarkViewed(record.url, true), { status: "updated", bookmark: record });
  assert.deepEqual(await saveCollection("  Reading  ", reading.id), reading);
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.data, initial);
});

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

test("partial import retains definitions and counts only confirmed records across retries", async (t) => {
  const existing = bookmark("existing", { collectionId: reading.id, tags: ["saved"], viewed: true });
  const first = bookmark("partial-first", { collectionId: work.id, tags: ["first"] });
  const second = bookmark("partial-second", { collectionId: work.id });
  const firstKey = bookmarkKey(first.url);
  const secondKey = bookmarkKey(second.url);
  const harness = useStorageHarness(t, {
    [COLLECTIONS_KEY]: [reading],
    [bookmarkKey(existing.url)]: existing,
  });
  const records = [
    { ...existing, title: "Losing existing title", collectionId: work.id },
    first,
    { ...first, title: "Losing duplicate title", tags: ["losing"] },
    second,
  ];
  const definitions = [reading, work];
  const submitted = structuredClone({ bookmarks: records, collections: definitions });
  const cause = new Error("Second record write failed.");
  const fault = rejectWrite(t, harness.local, secondKey, cause);

  const failed = await importBookmarkRecords(records, definitions);
  assert.deepEqual(failed, { status: "failed", added: 1, skipped: 2, collectionsAdded: 1, error: cause });
  assert.equal(failed.error, cause);
  assert.deepEqual(await readLibrary(), { bookmarks: [existing, first], collections: definitions });
  assert.equal(harness.data[secondKey], undefined);
  assert.deepEqual({ bookmarks: records, collections: definitions }, submitted);

  fault.mock.restore();
  const retry = await importBookmarkRecords(records, definitions);
  assert.deepEqual(retry, { status: "imported", added: 1, skipped: 3, collectionsAdded: 0 });
  assert.deepEqual(await readLibrary(), { bookmarks: [existing, first, second], collections: definitions });
  assert.deepEqual(harness.writes.map((write) => write.keys), [[COLLECTIONS_KEY], [firstKey], [secondKey]]);

  const repeated = await importBookmarkRecords(records, definitions);
  assert.deepEqual(repeated, { status: "imported", added: 0, skipped: 4, collectionsAdded: 0 });
  assert.equal(harness.writes.length, 3);
});

test("a failed definition write reports no import progress and starts no member writes", async (t) => {
  const harness = useStorageHarness(t);
  const record = bookmark("definition-failure", { collectionId: reading.id });
  const cause = new Error("Definition write failed.");
  const fault = rejectWrite(t, harness.local, COLLECTIONS_KEY, cause);

  const failed = await importBookmarkRecords([record], [reading]);
  assert.deepEqual(failed, { status: "failed", added: 0, skipped: 0, collectionsAdded: 0, error: cause });
  assert.deepEqual(harness.data, {});
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.requests, [COLLECTIONS_KEY]);
  assert.deepEqual(await readLibrary(), { bookmarks: [], collections: [] });

  fault.mock.restore();
  const retry = await importBookmarkRecords([record], [reading]);
  assert.deepEqual(retry, { status: "imported", added: 1, skipped: 0, collectionsAdded: 1 });
  assert.deepEqual(await readLibrary(), { bookmarks: [record], collections: [reading] });
});

test("an applied but unacknowledged import write is not counted or duplicated on retry", async (t) => {
  const harness = useStorageHarness(t);
  const record = bookmark("unacknowledged", { collectionId: reading.id, tags: ["keep"] });
  const key = bookmarkKey(record.url);
  const cause = new Error("Write acknowledgement lost.");
  const write = harness.local.set;
  // Model acknowledgement ambiguity, not native Chrome failure atomicity.
  const fault = t.mock.method(harness.local, "set", async (items) => {
    await write(items);
    if (Object.hasOwn(items, key)) {
      throw cause;
    }
  });

  const failed = await importBookmarkRecords([record], [reading]);
  assert.deepEqual(failed, { status: "failed", added: 0, skipped: 0, collectionsAdded: 1, error: cause });
  assert.deepEqual(await readLibrary(), { bookmarks: [record], collections: [reading] });
  assert.equal(harness.writes.length, 2);

  fault.mock.restore();
  const retry = await importBookmarkRecords([record], [reading]);
  assert.deepEqual(retry, { status: "imported", added: 0, skipped: 1, collectionsAdded: 0 });
  assert.equal(harness.writes.length, 2);
});

const deletionFailures = [
  { name: "member move", atDefinition: false, moved: 1, secondCollectionId: reading.id },
  { name: "definition removal", atDefinition: true, moved: 2, secondCollectionId: undefined },
];
for (const scenario of deletionFailures) {
  test(`failed collection ${scenario.name} retains a valid definition and completes on retry`, async (t) => {
    const first = bookmark("retry-first", { collectionId: reading.id, tags: ["keep"] });
    const second = bookmark("retry-second", { collectionId: reading.id, viewed: true });
    const unrelated = bookmark("retry-unrelated", { collectionId: work.id });
    const firstKey = bookmarkKey(first.url);
    const secondKey = bookmarkKey(second.url);
    const unrelatedKey = bookmarkKey(unrelated.url);
    const harness = useStorageHarness(t, {
      [COLLECTIONS_KEY]: [reading, work],
      [firstKey]: first,
      [secondKey]: second,
      [unrelatedKey]: unrelated,
    });
    const cause = new Error("Collection write failed.");
    const failingKey = scenario.atDefinition ? COLLECTIONS_KEY : secondKey;
    const fault = rejectWrite(t, harness.local, failingKey, cause);

    const failed = await deleteCollection(reading.id);
    assert.deepEqual(failed, { status: "failed", moved: scenario.moved, error: cause });
    assert.equal(failed.error, cause);
    assert.equal(harness.data[firstKey].collectionId, undefined);
    assert.equal(harness.data[secondKey].collectionId, scenario.secondCollectionId);
    assert.deepEqual(harness.data[COLLECTIONS_KEY], [reading, work]);
    await readLibrary();

    fault.mock.restore();
    const retry = await deleteCollection(reading.id);
    assert.deepEqual(retry, { status: "deleted", moved: 2 - scenario.moved });
    assert.deepEqual(harness.writes.map((write) => write.keys), [[firstKey], [secondKey], [COLLECTIONS_KEY]]);
    assert.deepEqual(harness.data[COLLECTIONS_KEY], [work]);
    assert.equal(harness.data[secondKey].collectionId, undefined);
    assert.deepEqual({ ...harness.data[firstKey], collectionId: reading.id }, first);
    assert.deepEqual({ ...harness.data[secondKey], collectionId: reading.id }, second);
    assert.deepEqual(harness.data[unrelatedKey], unrelated);
    await readLibrary();

    assert.deepEqual(await deleteCollection(reading.id), { status: "not-found", moved: 0 });
    assert.equal(harness.writes.length, 3);
  });
}

const quotaCause = new Error("QUOTA_BYTES exceeded.");
const ordinaryCause = new TypeError("Storage unavailable.");
const genericStorageMessage = "Chrome storage operation failed.";
const storageFailures = [
  { name: "quota", cause: quotaCause, type: StorageQuotaError, message: quotaCause.message },
  { name: "ordinary", cause: ordinaryCause, type: TypeError, message: ordinaryCause.message, preserve: true },
  { name: "empty Error", cause: new Error(""), type: Error, message: genericStorageMessage },
  { name: "non-Error", cause: "quota exceeded", type: Error, message: genericStorageMessage },
];
const storageOperations = [
  { name: "read", method: "get", run: readLibrary },
  { name: "write", method: "set", run: updateBookmark, status: "updated" },
  { name: "remove", method: "remove", run: deleteBookmark, status: "deleted" },
];
for (const operation of storageOperations) {
  for (const failure of storageFailures) {
    test(`${operation.name} ${failure.name} failure preserves data and permits retry`, async (t) => {
      const record = bookmark("error-retry", { collectionId: reading.id, tags: ["saved"] });
      const key = bookmarkKey(record.url);
      const initial = { [COLLECTIONS_KEY]: [reading, work], [key]: record };
      const harness = useStorageHarness(t, initial);
      const draft = { title: "  Draft title  ", collectionId: work.id, tags: ["draft"] };
      const submitted = structuredClone(draft);
      const fault = t.mock.method(harness.local, operation.method, async () => {
        throw failure.cause;
      });

      await assert.rejects(operation.run(record.url, draft), (error) => {
        assert.equal(error.constructor, failure.type);
        assert.equal(error.message, failure.message);
        if (failure.preserve) {
          assert.equal(error, failure.cause);
        }
        return true;
      });
      assert.deepEqual(harness.data, initial);
      assert.deepEqual(harness.writes, []);
      assert.deepEqual(draft, submitted);

      fault.mock.restore();
      const retry = await operation.run(record.url, draft);
      if (operation.method === "get") {
        assert.deepEqual(retry, { bookmarks: [record], collections: [reading, work] });
        return;
      }
      assert.equal(retry.status, operation.status);
    });
  }
}

const validImport = bookmark("validation");
const rejectedImports = [
  {
    name: "invalid losing duplicate tags",
    records: [validImport, { ...validImport, tags: ["UPPERCASE"] }],
    collections: [],
  },
  {
    name: "orphan reference on a losing duplicate",
    records: [validImport, { ...validImport, collectionId: "missing" }],
    collections: [reading],
  },
  {
    name: "file orphan despite a matching stored definition",
    records: [validImport, bookmark("orphan", { collectionId: reading.id })],
    collections: [],
  },
  {
    name: "invalid unused collection definition",
    records: [validImport],
    collections: [{ ...work, name: " Work " }],
  },
];
for (const scenario of rejectedImports) {
  test(`${scenario.name} is rejected before locks or storage access`, async (t) => {
    const initial = { [COLLECTIONS_KEY]: [reading], [bookmarkKey(validImport.url)]: validImport };
    const harness = useStorageHarness(t, initial);
    const write = t.mock.method(harness.local, "set");

    await assert.rejects(importBookmarkRecords(scenario.records, scenario.collections), TypeError);
    assert.deepEqual(harness.reads, []);
    assert.deepEqual(harness.requests, []);
    assert.deepEqual(harness.writes, []);
    assert.equal(write.mock.callCount(), 0);
    assert.deepEqual(harness.data, initial);
  });
}
