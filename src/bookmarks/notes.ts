export const MAX_NOTE_LENGTH = 65_536;
export const MAX_NOTES = 100;
export const MAX_NOTES_LENGTH = 1_048_576;

export interface BookmarkNote {
  id: string;
  body: string;
  createdAt: number;
  updatedAt?: number;
}

const NOTE_FIELDS = new Set(["id", "body", "createdAt", "updatedAt"]);

export function isNoteId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value);
}

export function isNoteBody(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_NOTE_LENGTH && Boolean(value.trim());
}

export function isNote(value: unknown): value is BookmarkNote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const fields = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(fields)) {
      if (typeof key !== "string" || !NOTE_FIELDS.has(key)) return false;
      if (!fields[key].enumerable || !Object.hasOwn(fields[key], "value")) return false;
    }
    if (!["id", "body", "createdAt"].every((key) => Object.hasOwn(fields, key))) return false;
    const createdAt: unknown = fields.createdAt.value;
    if (!isNoteId(fields.id.value) || !isNoteBody(fields.body.value)) return false;
    if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) return false;
    if (Object.hasOwn(fields, "updatedAt")) {
      const updatedAt: unknown = fields.updatedAt.value;
      if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt < createdAt) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isNotes(value: unknown): value is BookmarkNote[] {
  if (!Array.isArray(value) || value.length > MAX_NOTES) return false;
  try {
    const ids = new Set<string>();
    let length = 0;
    for (let index = 0; index < value.length; index++) {
      const field = Object.getOwnPropertyDescriptor(value, String(index));
      if (!field || !Object.hasOwn(field, "value") || !isNote(field.value)) return false;
      const note: BookmarkNote = field.value;
      if (ids.has(note.id)) return false;
      ids.add(note.id);
      length += note.body.length;
      if (length > MAX_NOTES_LENGTH) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function snapshotNotes(value: unknown): BookmarkNote[] {
  if (!isNotes(value)) throw new TypeError("Invalid bookmark notes or note limits exceeded.");
  return value.map((note) => ({
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    ...(note.updatedAt === undefined ? {} : { updatedAt: note.updatedAt }),
  }));
}

export function sameNote(first: BookmarkNote, second: BookmarkNote): boolean {
  return first.id === second.id && first.body === second.body
    && first.createdAt === second.createdAt && first.updatedAt === second.updatedAt;
}

export function orderedNotes(notes: readonly BookmarkNote[] = []): BookmarkNote[] {
  return [...notes].sort((first, second) => second.createdAt - first.createdAt || first.id.localeCompare(second.id));
}