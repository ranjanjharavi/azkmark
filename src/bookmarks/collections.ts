export interface Collection {
  id: string;
  name: string;
}

export function normalizeCollectionName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

export function collectionNameKey(name: string): string {
  return normalizeCollectionName(name).toLowerCase();
}

export function isCollectionId(value: unknown): value is string {
  return typeof value === "string" && /^[^\s\u0000-\u001f\u007f]{1,128}$/u.test(value);
}

function snapshotCollection(value: unknown): Collection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid collection.");
  }

  const prototype = Object.getPrototypeOf(value);
  const fields = Object.getOwnPropertyDescriptors(value);

  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(fields).length !== 2 ||
    !Object.hasOwn(fields, "id") ||
    !Object.hasOwn(fields, "name")
  ) {
    throw new TypeError("Invalid collection.");
  }

  for (const field of Object.values(fields)) {
    if (!field.enumerable || !Object.hasOwn(field, "value")) {
      throw new TypeError("Invalid collection.");
    }
  }

  const id: unknown = fields["id"].value;
  const name: unknown = fields["name"].value;
  if (
    !isCollectionId(id) ||
    typeof name !== "string" ||
    !name ||
    name.length > 100 ||
    name !== normalizeCollectionName(name)
  ) {
    throw new TypeError("Invalid collection.");
  }

  return { id, name };
}

export function snapshotCollections(value: unknown): Collection[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Invalid collections.");
  }

  const collections: Collection[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (let index = 0; index < value.length; index++) {
    const collection = snapshotCollection(value[index]);
    const nameKey = collectionNameKey(collection.name);

    if (ids.has(collection.id) || names.has(nameKey)) {
      throw new TypeError("Duplicate collection ID or name.");
    }

    ids.add(collection.id);
    names.add(nameKey);
    collections.push(collection);
  }

  return collections;
}

export interface CollectionMergeResult {
  collections: Collection[];
  mapping: Map<string, string>;
  added: number;
}

// Build the entire mapping before storage writes. The caller supplies fresh IDs
// only for collisions, keeping this plan independent of storage and browser APIs
export function mergeCollections(
  existing: readonly Collection[],
  incoming: readonly Collection[],
  createId: () => string
): CollectionMergeResult {
  const collections = snapshotCollections(existing);
  const candidates = snapshotCollections(incoming);
  const byName = new Map(collections.map((collection) => [collectionNameKey(collection.name), collection]));
  const usedIds = new Set(collections.map((collection) => collection.id));

  // Generated IDs must not consume the identity of a later incoming definition
  const reservedIds = new Set(usedIds);
  candidates.forEach(({ id }) => reservedIds.add(id));
  const mapping = new Map<string, string>();
  let added = 0;

  for (const candidate of candidates) {
    const nameKey = collectionNameKey(candidate.name);
    const match = byName.get(nameKey);
    if (match) {
      mapping.set(candidate.id, match.id);
      continue;
    }

    let id = candidate.id;
    if (usedIds.has(id)) {
      do {
        id = createId();
        if (!isCollectionId(id)) {
          throw new TypeError("Invalid generated collection ID.");
        }
      } while (reservedIds.has(id));
    }

    const collection = { id, name: candidate.name };
    collections.push(collection);
    byName.set(nameKey, collection);
    usedIds.add(id);
    reservedIds.add(id);
    mapping.set(candidate.id, id);
    added++;
  }

  return { collections, mapping, added };
}
