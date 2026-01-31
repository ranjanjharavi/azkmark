import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSelection } from "../dist/library/workspace/selection.js";

function bookmark(url) {
  return Object.freeze({ url, title: "Saved page", savedAt: 1 });
}

const first = bookmark("https://example.com/first");
const second = bookmark("https://example.com/second");
const third = bookmark("https://example.com/third");
const library = Object.freeze([first, second, third]);
const previousUrls = library.map((record) => record.url);

test("no visible matches clears selection", () => {
  assert.equal(reconcileSelection([], library, second.url, previousUrls), undefined);
});

test("initial selection uses the first visible match", () => {
  const matches = [third, first];
  assert.equal(reconcileSelection(matches, library, undefined, []), third);
});

test("selection survives reordering and uses the latest matching record", () => {
  const updated = { ...second, title: "Updated title" };
  const matches = [third, updated, first];
  assert.equal(reconcileSelection(matches, matches, second.url, previousUrls), updated);
});

test("a filtered-out selection uses the first match, not its previous index", () => {
  const matches = [first, third];
  assert.equal(reconcileSelection(matches, library, second.url, previousUrls), first);
});

test("deletion selects the surviving row at the previous visible index", () => {
  const remaining = [first, third];
  assert.equal(reconcileSelection(remaining, remaining, second.url, previousUrls), third);
});

test("deletion clamps the previous index to the last remaining row", () => {
  const remaining = [first, second];
  assert.equal(reconcileSelection(remaining, remaining, third.url, previousUrls), second);
});

test("a deleted URL missing from the previous list falls back to the first match", () => {
  const deletedUrl = "https://example.com/deleted";
  assert.equal(reconcileSelection(library, library, deletedUrl, []), first);
});

test("selection compares complete URLs, including queries and fragments", () => {
  const original = bookmark("https://example.com/page?q=one#first");
  const otherQuery = bookmark("https://example.com/page?q=two#first");
  const otherFragment = bookmark("https://example.com/page?q=one#second");
  const matches = [otherFragment, original, otherQuery];

  assert.equal(reconcileSelection(matches, matches, otherQuery.url, []), otherQuery);
  assert.equal(reconcileSelection(matches, matches, original.url, []), original);
});
