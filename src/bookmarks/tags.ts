export const MAX_TAGS = 32;
export const MAX_TAG_LENGTH = 80;

function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function normalizeTags(tags: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const tag of tags) {
    const label = normalizeTag(tag);
    if (label) {
      normalized.add(label);
    }
  }
  return Array.from(normalized);
}

function readTags(value: unknown): string[] | undefined {
  try {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const prototype = Object.getPrototypeOf(value);
    const fields = Object.getOwnPropertyDescriptors(value as object);
    const lengthField = fields["length"];
    const length: unknown = lengthField?.value;
    if (
      (prototype !== Array.prototype && prototype !== null)
      || !lengthField
      || !Object.hasOwn(lengthField, "value")
      || lengthField.enumerable
      || typeof length !== "number"
      || !Number.isSafeInteger(length)
      || length < 0
      || length > MAX_TAGS
      || Reflect.ownKeys(fields).length !== length + 1
    ) {
      return undefined;
    }

    const seen = new Set<string>();
    const tags: string[] = [];
    for (let index = 0; index < length; index++) {
      const field = fields[String(index)];
      const tag: unknown = field?.value;
      if (
        !field?.enumerable
        || !Object.hasOwn(field, "value")
        || typeof tag !== "string"
        || !tag
        || tag.length > MAX_TAG_LENGTH
        || normalizeTag(tag) !== tag
        || seen.has(tag)
      ) {
        return undefined;
      }
      seen.add(tag);
      tags.push(tag);
    }
    return tags;
  } catch {
    return undefined;
  }
}

export function isTags(value: unknown): value is string[] {
  return readTags(value) !== undefined;
}

export function snapshotTags(value: unknown): string[] {
  // Copy validated descriptor values, never invoke an input iterator or getter
  const tags = readTags(value);
  if (!tags) {
    throw new TypeError("Invalid bookmark tags.");
  }
  return tags;
}

export function sameTags(left: readonly string[] = [], right: readonly string[] = []): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

export function availableTags(bookmarks: readonly { tags?: readonly string[] }[]): string[] {
  const vocabulary = new Set<string>();
  for (const bookmark of bookmarks) {
    for (const tag of bookmark.tags ?? []) {
      vocabulary.add(tag);
    }
  }
  return Array.from(vocabulary).sort((left, right) => left.localeCompare(right));
}
