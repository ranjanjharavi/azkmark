import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { createBookmark, isBookmark, snapshotBookmarks } from "../dist/bookmarks/model.js";
import { parseBackup, serializeBackup } from "../dist/bookmarks/backup.js";
import { isNote, isNotes, snapshotNotes, orderedNotes, MAX_NOTE_LENGTH, MAX_NOTES, MAX_NOTES_LENGTH } from "../dist/bookmarks/notes.js";
import { renderMarkdown } from "../dist/ui/markdown.js";
import { initializeNotesPanel } from "../dist/library/workspace/notes-panel.js";
import { initializeNoteEditor } from "../dist/library/workspace/note-editor.js";
import { initializeLibraryView } from "../dist/library/view.js";
import { initializeManagement } from "../dist/library/workspace/bookmark-dialog.js";
import { initializeCollections } from "../dist/library/collections/collection-manager.js";
import { initializeLibraryFilters } from "../dist/library/filters.js";
import { filterBookmarks } from "../dist/bookmarks/search.js";

const note = (fields = {}) => ({ id: "entry-1", body: "  **Keep** indentation\n", createdAt: 10, ...fields });
const bookmark = (fields = {}) => ({ url: "https://example.com/notes", title: "Notes", savedAt: 1, ...fields });

test("note snapshots preserve Markdown and detach nested records", () => {
  const source = bookmark({ notes: [note({ updatedAt: 11 })] });
  const result = snapshotBookmarks([source]);
  source.notes[0].body = "changed";
  source.notes.push(note({ id: "other" }));
  assert.deepEqual(result[0].notes, [note({ updatedAt: 11 })]);
  assert.equal(result[0].savedAt, 1);
  assert.equal(Object.hasOwn(createBookmark(bookmark()), "notes"), false);
  assert.equal(Object.hasOwn(createBookmark(bookmark({ notes: [] })), "notes"), false);
});

test("notes reject malformed fields, duplicate IDs, and unsafe timestamps", () => {
  for (const fields of [{ id: "" }, { body: " \n " }, { createdAt: -1 }, { createdAt: 0.5 }, { createdAt: Infinity }, { updatedAt: 9 }, { updatedAt: undefined }, { extra: true }]) {
    assert.equal(isNote(note(fields)), false, JSON.stringify(fields));
  }
  assert.equal(isNotes([note(), note()]), false);
  assert.equal(isBookmark(bookmark({ notes: [note({ body: 1 })] })), false);
  assert.throws(() => snapshotNotes([note({ id: "" })]), TypeError);
});

test("note validation does not invoke accessors", () => {
  let reads = 0;
  const accessor = Object.defineProperty(note(), "body", { enumerable: true, get() { reads++; return "unsafe"; } });
  const entries = Object.defineProperty([], "0", { get() { reads++; return note(); } });
  assert.equal(isNote(accessor), false);
  assert.equal(isNotes(entries), false);
  assert.equal(isNote(Object.create(note())), false);
  assert.equal(reads, 0);
});

test("shared note limits enforce body, count, and aggregate boundaries", () => {
  assert.equal(isNote(note({ body: "x".repeat(MAX_NOTE_LENGTH) })), true);
  assert.equal(isNote(note({ body: "x".repeat(MAX_NOTE_LENGTH + 1) })), false);
  const entries = Array.from({ length: MAX_NOTES }, (_, index) => note({ id: `entry-${index}` }));
  assert.equal(isNotes(entries), true);
  assert.equal(isNotes([...entries, note({ id: "overflow" })]), false);
  const full = Array.from({ length: MAX_NOTES_LENGTH / MAX_NOTE_LENGTH }, (_, index) => note({ id: `full-${index}`, body: "x".repeat(MAX_NOTE_LENGTH) }));
  assert.equal(isNotes(full), true);
  assert.equal(isNotes([...full, note()]), false);
});

test("history sorts by creation, not edit time, without mutating its input", () => {
  const entries = [note({ id: "older", updatedAt: 100 }), note({ id: "second", createdAt: 20 }), note({ id: "first", createdAt: 20 })];
  assert.deepEqual(orderedNotes(entries).map(({ id }) => id), ["first", "second", "older"]);
  assert.equal(entries[0].id, "older");
});

test("version 4 backups round-trip complete note histories and empty libraries", () => {
  const records = [bookmark({ notes: [note({ updatedAt: 12 })], collectionId: "reading", tags: ["research"] })];
  const collections = [{ id: "reading", name: "Reading" }];
  const json = serializeBackup(records, collections);
  assert.equal(JSON.parse(json).version, 4);
  assert.deepEqual(parseBackup(json), { bookmarks: records, collections });
  assert.deepEqual(parseBackup(serializeBackup([])), { bookmarks: [], collections: [] });
});

test("legacy backup versions keep their original envelopes and field restrictions", () => {
  for (const version of [1, 2, 3]) {
    const envelope = { format: "azkmark", version, bookmarks: [bookmark()], ...(version >= 3 ? { collections: [] } : {}) };
    assert.deepEqual(parseBackup(JSON.stringify(envelope)), { bookmarks: [bookmark()], collections: [] });
    assert.throws(() => parseBackup(JSON.stringify({ ...envelope, bookmarks: [bookmark({ notes: [note()] })] })), TypeError);
    if (version < 3) assert.throws(() => parseBackup(JSON.stringify({ ...envelope, bookmarks: [bookmark({ tags: ["no"] })] })), TypeError);
    if (version === 1) assert.throws(() => parseBackup(JSON.stringify({ ...envelope, bookmarks: [bookmark({ viewed: true })] })), TypeError);
  }
  const collections = [{ id: "reading", name: "Reading" }];
  const record = bookmark({ collectionId: "reading", tags: ["keep"], viewed: true });
  assert.deepEqual(parseBackup(JSON.stringify({ format: "azkmark", version: 3, bookmarks: [record], collections })), { bookmarks: [record], collections });
});

test("saved note search preserves existing filters, sorting, and ordinary matches", () => {
  const records = [bookmark({ notes: [note({ body: "Unique RESEARCH phrase" })], tags: ["reading"], viewed: true }), bookmark({ url: "https://example.com/plain", title: "Plain", savedAt: 2 })];
  assert.deepEqual(filterBookmarks(records, { query: " research " }), [records[0]]);
  assert.deepEqual(filterBookmarks(records, { query: "research", viewStatus: "to-view" }), []);
  assert.deepEqual(filterBookmarks(records, { query: "research", tag: "other" }), []);
  assert.deepEqual(filterBookmarks(records, { query: "plain" }), [records[1]]);
  assert.deepEqual(filterBookmarks(records).map(({ title }) => title), ["Plain", "Notes"]);
  records[0].notes = [];
  assert.deepEqual(filterBookmarks(records, { query: "research" }), []);
});

function useNotesDom(t, record = bookmark({ notes: [note()] })) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://extension.test/library.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new window.Event("close")); };
  for (const file of ["marked.js", "purify.js", "lucide.js"]) window.eval(readFileSync(new URL(`../dist/vendor/${file}`, import.meta.url), "utf8"));
  const key = "azkmark:bookmark:" + record.url;
  const data = { [key]: structuredClone(record) };
  const local = {
    async get(name) { return structuredClone(name === null ? data : Object.hasOwn(data, name) ? { [name]: data[name] } : {}); },
    async set(items) { Object.assign(data, structuredClone(items)); },
    async remove(name) { delete data[name]; },
  };
  const globals = {
    window, document: window.document, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    Option: window.Option,
    localStorage: window.localStorage,
    marked: window.marked, DOMPurify: window.DOMPurify, lucide: window.lucide,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    navigator: { locks: { request: async (_name, callback) => callback() } },
    chrome: { storage: { local } },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  t.after(() => window.close());
  return { window, document: window.document, data, key, local };
}

function useLibraryDom(t, record) {
  const harness = useNotesDom(t, record);
  const fixture = new harness.window.DOMParser().parseFromString(readFileSync(new URL("../public/library.html", import.meta.url), "utf8"), "text/html");
  harness.document.body.replaceChildren(...fixture.body.childNodes);
  return harness;
}

test("library markup labels the import picker and uses native status outputs", (t) => {
  const dom = new JSDOM(readFileSync(new URL("../public/library.html", import.meta.url), "utf8"));
  t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.equal(document.querySelector("#backup-file").labels[0].textContent, "Import bookmark backup");
  const statuses = document.querySelectorAll("output[aria-atomic='true']");
  assert.equal(statuses.length, 10);
  assert.equal(document.querySelector("[role='status']"), null);
});

test("filter controls sort domains and expose active selections through dataset", (t) => {
  const { document } = useLibraryDom(t);
  const filters = initializeLibraryFilters({ onChange: () => {}, onReset: () => {}, isAvailable: () => true });
  const records = ["zebra", "alpha"].flatMap((domain) => [1, 2].map((index) => bookmark({ url: `https://${domain}.example/${index}`, tags: ["saved"] })));
  filters.update(records, []);
  filters.setDisabled(false);
  const domain = document.querySelector("#domain");
  assert.deepEqual([...domain.options].map((option) => option.value), ["all", "general", "domain:alpha.example", "domain:zebra.example"]);
  domain.value = "domain:zebra.example";
  document.querySelector("#tag-filter").value = "saved";
  const state = filters.render();
  assert.equal(state.activeCount, 2);
  assert.equal(domain.dataset.active, "true");
  assert.equal(document.querySelector("#tag-filter").dataset.active, "true");
  assert.equal(document.querySelector("#toggle-filters").dataset.active, "true");
  assert.deepEqual(state.selection, { kind: "domain", domain: "zebra.example" });
});

test("production Markdown renders formatting without executable HTML or remote resources", (t) => {
  const { document } = useNotesDom(t);
  const host = document.createElement("div");
  renderMarkdown(host, '**Safe**\n\n`code`\n\n![remote](https://tracker.example/pixel)\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[good](https://example.com)');
  assert.equal(host.querySelector("strong").textContent, "Safe");
  assert.equal(host.querySelector("code").textContent, "code");
  assert.equal(host.querySelector("img,script,iframe,[onerror],[onclick],[src]"), null);
  assert.equal(host.querySelector('a[href^="javascript:"]'), null);
  const link = host.querySelector('a[href="https://example.com"]');
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
});

test("panel refreshes, tabs, and bookmark switches retain the same draft textarea", (t) => {
  const { window, document } = useNotesDom(t);
  const panel = initializeNotesPanel(async () => {});
  const first = bookmark({ notes: [note()] });
  const metadata = () => document.createElement("dl");
  const root = panel.render(first, metadata());
  document.body.append(root);
  const textarea = root.querySelector("textarea");
  textarea.value = "  unsaved draft\n";
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(3, 7);
  assert.equal(panel.render({ ...first, title: "Changed elsewhere" }, metadata()), root);
  assert.equal(root.querySelector("textarea"), textarea);
  assert.equal(textarea.selectionStart, 3);
  root.querySelector("#details-tab").click();
  panel.render(first, metadata());
  assert.equal(root.querySelector("#notes-metadata").hidden, false);
  document.body.replaceChildren(panel.render(bookmark({ url: "https://example.com/other" }), metadata()));
  document.body.replaceChildren(panel.render(first, metadata()));
  assert.equal(root.querySelector("textarea"), textarea);
  assert.equal(textarea.value, "  unsaved draft\n");
  assert.equal(root.querySelector("#notes-content").hidden, false);
  assert.ok(root.querySelector(".note-icon-button svg"));
});

test("detail scrolling survives refreshes and resets when the selected bookmark changes", (t) => {
  const { window } = useLibraryDom(t);
  const view = initializeLibraryView(() => {}, async () => {});
  const first = bookmark({ notes: [note()] });
  const second = bookmark({ url: "https://example.com/second", notes: [note()] });
  const state = {
    library: [first, second], collections: [], matches: [first, second], scopeSize: 2,
    filters: { query: "", selection: { kind: "all" }, savedDate: "all", viewStatus: "all", tag: "", sort: "newest", collectionScope: "all", activeCount: 0 },
    savingViewStatus: false, notice: "", now: Date.now(),
  };
  view.render({ ...state, selectedBookmark: first });
  const { workspaceElement } = view.elements;
  assert.equal(workspaceElement.style.getPropertyValue("--workspace-height"), `${window.innerHeight}px`);
  workspaceElement.getBoundingClientRect = () => ({ top: 240 });
  window.dispatchEvent(new window.Event("resize"));
  assert.equal(workspaceElement.style.getPropertyValue("--workspace-height"), `${window.innerHeight - 240}px`);
  const details = view.elements.bookmarkDetailsElement;
  const list = view.elements.bookmarksListElement;
  details.scrollTop = 300;
  list.scrollTop = 200;
  view.invalidateDetails();
  view.render({ ...state, selectedBookmark: { ...first, title: "Refreshed" } });
  assert.equal(details.scrollTop, 300);
  assert.equal(list.scrollTop, 200);
  view.render({ ...state, selectedBookmark: second });
  assert.equal(details.scrollTop, 0);
  details.scrollTop = 150;
  view.render({ ...state, selectedBookmark: second, savingViewStatus: true });
  assert.equal(details.scrollTop, 150);
  view.showError();
  view.render({ ...state, selectedBookmark: second });
  assert.equal(details.scrollTop, 0);
});

test("bookmark dialog validates drafts, preserves failed edits, and retries without dropping notes", async (t) => {
  const record = bookmark({ notes: [note()], tags: ["keep"] });
  const { window, document, data, key, local } = useLibraryDom(t, record);
  const feedback = [];
  const manager = initializeManagement({ getBookmarks: () => [data[key]], getCollections: () => [], refresh: async () => {}, restoreFocus: () => {}, showFeedback: (message) => feedback.push(message), clearFeedback: () => {} });
  manager.open(record.url, "edit");
  const form = document.querySelector("#management-form");
  const title = document.querySelector("#bookmark-title");
  title.value = " ";
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  assert.equal(title.getAttribute("aria-invalid"), "true");
  title.value = "  Revised title  ";
  const write = local.set;
  local.set = async () => { throw new Error("QUOTA_BYTES exceeded"); };
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await setImmediate();
  assert.match(document.querySelector("#management-error").textContent, /storage is full/);
  assert.equal(title.value, "  Revised title  ");
  assert.equal(title.readOnly, false);
  assert.equal(document.querySelector("#bookmark-dialog").open, true);
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  let writes = 0;
  local.set = async (items) => { writes++; await gate; await write(items); };
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await setImmediate();
  assert.equal(writes, 1);
  assert.equal(document.querySelector("#management-submit").disabled, true);
  finish();
  await setImmediate();
  assert.equal(data[key].title, "Revised title");
  assert.deepEqual(data[key].notes, record.notes);
  assert.deepEqual(data[key].tags, record.tags);
  assert.equal(data[key].savedAt, record.savedAt);
  assert.equal(document.querySelector("#bookmark-dialog").open, false);
  assert.deepEqual(feedback, ["Bookmark changes saved."]);
});

test("bookmark dialog handles a missing delete target without recreating it", async (t) => {
  const record = bookmark({ notes: [note()] });
  const { window, document, data, key } = useLibraryDom(t, record);
  const manager = initializeManagement({ getBookmarks: () => Object.values(data), getCollections: () => [], refresh: async () => {}, restoreFocus: () => {}, showFeedback: () => {}, clearFeedback: () => {} });
  manager.open(record.url, "delete");
  delete data[key];
  document.querySelector("#management-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await setImmediate();
  assert.equal(Object.hasOwn(data, key), false);
  assert.equal(document.querySelector("#management-submit").disabled, true);
  assert.equal(document.activeElement, document.querySelector("#management-cancel"));
  assert.match(document.querySelector("#management-error").textContent, /no longer saved/);
});

test("collection rename retains drafts through quota failures and missing-target refreshes", async (t) => {
  const record = bookmark({ notes: [note()] });
  const { window, document, data, key, local } = useLibraryDom(t, record);
  const collectionKey = "azkmark:collections";
  const collections = [{ id: "reading", name: "Reading" }];
  data[collectionKey] = structuredClone(collections);
  const manager = initializeCollections({ getBookmarks: () => [data[key]], getCollections: () => data[collectionKey], refresh: async () => {}, showFeedback: () => {}, clearFeedback: () => {} });
  const open = document.querySelector("#manage-collections");
  open.disabled = false;
  open.click();
  document.querySelector('[data-collection-action="rename"]').click();
  const input = document.querySelector("#collection-rename-name");
  const form = document.querySelector("#collection-rename-form");
  input.value = "Research";
  const write = local.set;
  local.set = async () => { throw new Error("QUOTA_BYTES exceeded"); };
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await setImmediate();
  assert.equal(input.value, "Research");
  assert.match(document.querySelector("#collection-rename-error").textContent, /Storage is full/);
  assert.equal(input.readOnly, false);
  data[collectionKey] = [];
  manager.update();
  assert.equal(input.value, "Research");
  assert.equal(document.querySelector("#collection-rename-save").disabled, true);
  assert.match(document.querySelector("#collection-rename-error").textContent, /was removed/);
  data[collectionKey] = structuredClone(collections);
  manager.update();
  local.set = write;
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await setImmediate();
  assert.equal(data[collectionKey][0].name, "Research");
  assert.equal(form.hidden, true);
  assert.deepEqual(data[key].notes, record.notes);
});

test("collection delete confirmation becomes read-only when its target disappears", (t) => {
  const { document, data, key } = useLibraryDom(t, bookmark());
  const collectionKey = "azkmark:collections";
  data[collectionKey] = [{ id: "reading", name: "Reading" }];
  const manager = initializeCollections({ getBookmarks: () => [data[key]], getCollections: () => data[collectionKey], refresh: async () => {}, showFeedback: () => {}, clearFeedback: () => {} });
  const open = document.querySelector("#manage-collections");
  open.disabled = false;
  open.click();
  document.querySelector('[data-collection-action="delete"]').click();
  data[collectionKey] = [];
  manager.update();
  assert.equal(document.querySelector("#collection-delete-submit").disabled, true);
  assert.equal(document.querySelector("#collection-delete-cancel").textContent, "Close");
  assert.match(document.querySelector("#collection-delete-error").textContent, /was removed/);
});

test("composer preserves failed drafts, blocks duplicates, and retries a stable addition", async (t) => {
  const record = bookmark();
  const { window, document, data, key, local } = useNotesDom(t, record);
  let saved;
  const editor = initializeNoteEditor(record, async () => {}, (value) => { saved = value; });
  document.body.append(editor.root);
  const textarea = editor.root.querySelector("textarea");
  textarea.value = "**New note**";
  textarea.dispatchEvent(new window.Event("input"));
  const write = local.set;
  local.set = async (items) => { await write(items); throw new Error("QUOTA_BYTES exceeded"); };
  const form = editor.root.querySelector("form");
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  assert.equal(editor.root.querySelector('[type="submit"]').disabled, true);
  await setImmediate();
  assert.equal(textarea.value, "**New note**");
  assert.match(editor.root.querySelector(".note-error").textContent, /storage is full/);
  const id = data[key].notes[0].id;
  local.set = write;
  form.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await setImmediate();
  assert.equal(data[key].notes.length, 1);
  assert.equal(data[key].notes[0].id, id);
  assert.equal(saved.notes[0].body, "**New note**");
  assert.equal(textarea.value, "");
});

test("composer preserves conflicting drafts until the user explicitly rebases", async (t) => {
  const record = bookmark({ notes: [note()] });
  const { window, document, data, key } = useNotesDom(t, record);
  const editor = initializeNoteEditor(record, async () => {}, () => {});
  document.body.append(editor.root);
  await editor.edit(record.notes[0]);
  const textarea = editor.root.querySelector("textarea");
  textarea.value = "My retained draft";
  textarea.dispatchEvent(new window.Event("input"));
  data[key].notes[0] = note({ body: "Changed in another window", updatedAt: 20 });
  editor.update(structuredClone(data[key]));
  assert.equal(textarea.value, "My retained draft");
  assert.equal(editor.root.querySelector('[type="submit"]').disabled, true);
  editor.root.querySelector('[data-note-action="rebase"]').click();
  document.querySelector("dialog .destructive").click();
  await setImmediate();
  assert.equal(editor.root.querySelector('[type="submit"]').disabled, false);
  editor.root.querySelector("form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await setImmediate();
  assert.equal(data[key].notes[0].body, "My retained draft");
  assert.equal(data[key].notes[0].createdAt, 10);
});

test("canceling dirty-draft replacement and note deletion leaves the draft intact", async (t) => {
  const record = bookmark({ notes: [note()] });
  const { window, document, data, key } = useNotesDom(t, record);
  const editor = initializeNoteEditor(record, async () => {}, () => {});
  document.body.append(editor.root);
  const textarea = editor.root.querySelector("textarea");
  textarea.value = "Keep this draft";
  textarea.dispatchEvent(new window.Event("input"));
  const edit = editor.edit(record.notes[0]);
  document.querySelector("dialog button").click();
  await edit;
  assert.equal(textarea.value, "Keep this draft");
  const remove = editor.remove(record.notes[0]);
  document.querySelector("dialog button").click();
  await remove;
  assert.equal(data[key].notes.length, 1);
  assert.equal(textarea.value, "Keep this draft");
});

test("confirmed deletion removes only its target and preserves a new-entry draft", async (t) => {
  const record = bookmark({ notes: [note(), note({ id: "second", body: "Keep saved" })] });
  const { window, document, data, key } = useNotesDom(t, record);
  const editor = initializeNoteEditor(record, async () => {}, () => {});
  document.body.append(editor.root);
  const textarea = editor.root.querySelector("textarea");
  textarea.value = "Keep unsaved";
  textarea.dispatchEvent(new window.Event("input"));
  const pending = editor.remove(record.notes[0]);
  document.querySelector("dialog .destructive").click();
  await pending;
  assert.deepEqual(data[key].notes, [record.notes[1]]);
  assert.equal(textarea.value, "Keep unsaved");
  assert.equal(data[key].savedAt, 1);
});

test("composer explains count and aggregate limits while allowing existing-note edits", async (t) => {
  const entries = Array.from({ length: MAX_NOTES }, (_, index) => note({ id: `entry-${index}` }));
  const record = bookmark({ notes: entries });
  const { document, window } = useNotesDom(t, record);
  const editor = initializeNoteEditor(record, async () => {}, () => {});
  document.body.append(editor.root);
  const textarea = editor.root.querySelector("textarea");
  const submit = editor.root.querySelector('[type="submit"]');
  assert.equal(submit.disabled, true);
  assert.match(editor.root.querySelector(".note-error").textContent, /100-note limit/);
  await editor.edit(entries[0]);
  textarea.value += "edited";
  textarea.dispatchEvent(new window.Event("input"));
  assert.equal(submit.disabled, false);
  const full = Array.from({ length: MAX_NOTES_LENGTH / MAX_NOTE_LENGTH }, (_, index) => note({ id: `full-${index}`, body: "x".repeat(MAX_NOTE_LENGTH) }));
  full[0].body = full[0].body.slice(entries[0].body.length);
  editor.update(bookmark({ notes: [...full, entries[0]] }));
  assert.equal(submit.disabled, true);
  assert.match(editor.root.querySelector(".note-error").textContent, /combined notes/);
  assert.equal(textarea.value, entries[0].body + "edited");
});