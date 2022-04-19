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
    (prototype !== Object.prototype && prototype !== null)
    || Reflect.ownKeys(fields).length !== 2
    || !Object.hasOwn(fields, "id")
    || !Object.hasOwn(fields, "name")
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
    !isCollectionId(id)
    || typeof name !== "string"
    || !name
    || name.length > 100
    || name !== normalizeCollectionName(name)
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
