import type { Bookmark } from "../../bookmarks/model.js";
import type { BookmarkNote } from "../../bookmarks/notes.js";
import { MAX_NOTE_LENGTH, MAX_NOTES, MAX_NOTES_LENGTH, sameNote } from "../../bookmarks/notes.js";
import { addBookmarkNote, updateBookmarkNote, deleteBookmarkNote, StorageQuotaError } from "../../bookmarks/storage.js";
import type { NoteMutationResult } from "../../bookmarks/storage.js";
import { renderMarkdown, renderNoteIcons } from "../../ui/markdown.js";

function confirmNoteAction(message: string, label: string): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "note-confirmation";
    dialog.setAttribute("aria-labelledby", "note-confirm-title");
    dialog.setAttribute("aria-describedby", "note-confirm-copy");
    dialog.innerHTML = '<h2 id="note-confirm-title"></h2><p id="note-confirm-copy"></p><div class="management-actions"><button type="button">Cancel</button><button type="button" class="destructive"></button></div>';
    dialog.querySelector("h2")!.textContent = label === "Delete note" ? "Delete this note?" : "Discard or replace draft?";
    dialog.querySelector("p")!.textContent = message;
    const [cancel, accept] = dialog.querySelectorAll("button");
    accept.textContent = label;
    let confirmed = false;
    cancel.addEventListener("click", () => dialog.close());
    accept.addEventListener("click", () => { confirmed = true; dialog.close(); });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); dialog.close(); }
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      resolve(confirmed);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export function initializeNoteEditor(
  initial: Bookmark,
  refresh: () => Promise<void>,
  onSaved: (bookmark: Bookmark) => void,
) {
  let bookmark = initial;
  let original: BookmarkNote | undefined;
  let addition: BookmarkNote | undefined;
  let conflict: BookmarkNote | undefined;
  let pending = false;
  let confirming = false;
  let previewing = false;
  let error = "";
  let notice = "";
  const root = document.createElement("div");
  root.className = "note-composer";
  root.innerHTML = `
    <form class="note-editor" aria-label="Add a note">
      <div class="note-editor-top"><div class="note-editor-modes" role="tablist" aria-label="Note editor mode">
        <button id="note-write-tab" type="button" role="tab" aria-controls="note-write" aria-selected="true">Write</button>
        <button id="note-preview-tab" type="button" role="tab" aria-controls="note-preview" aria-selected="false" tabindex="-1">Preview</button>
      </div><span class="note-editor-kind">Markdown</span></div>
      <div id="note-write" role="tabpanel" aria-labelledby="note-write-tab">
        <div class="note-format-tools" role="group" aria-label="Text formatting"></div>
        <label class="visually-hidden" for="note-body">Note in Markdown</label>
        <textarea id="note-body" rows="4" placeholder="A quick thought, an excerpt, a next step..." aria-describedby="note-counter note-error"></textarea>
      </div>
      <div id="note-preview" class="note-markdown note-preview" role="tabpanel" aria-labelledby="note-preview-tab" tabindex="0" hidden></div>
      <div class="note-editor-footer"><span id="note-counter"></span><div class="note-editor-actions">
        <button type="button" class="note-icon-button" data-note-action="discard" aria-label="Discard draft" data-tooltip="Discard draft"><i data-lucide="x" aria-hidden="true"></i></button>
        <button type="submit" class="note-save"><i data-lucide="check" aria-hidden="true"></i><span>Add note</span></button>
      </div></div>
    </form>
    <p id="note-error" class="note-error" role="alert" hidden></p>
    <div class="note-conflict" hidden><button type="button" data-note-action="reload">Load saved note</button><button type="button" data-note-action="rebase">Keep my draft</button></div>
    <output class="note-status" aria-live="polite" aria-atomic="true"></output>`;
  const form = root.querySelector<HTMLFormElement>("form")!;
  const textarea = root.querySelector<HTMLTextAreaElement>("textarea")!;
  const write = root.querySelector<HTMLElement>("#note-write")!;
  const preview = root.querySelector<HTMLElement>("#note-preview")!;
  const writeTab = root.querySelector<HTMLButtonElement>("#note-write-tab")!;
  const previewTab = root.querySelector<HTMLButtonElement>("#note-preview-tab")!;
  const errorElement = root.querySelector<HTMLElement>(".note-error")!;
  const submitButton = root.querySelector<HTMLButtonElement>(".note-save")!;
  const discardButton = root.querySelector<HTMLButtonElement>('[data-note-action="discard"]')!;
  textarea.maxLength = MAX_NOTE_LENGTH;

  const formats: Record<string, [string, string, string]> = {
    bold: ["**", "**", "bold text"], italic: ["*", "*", "italic text"],
    link: ["[", "](https://example.com)", "link text"], list: ["- ", "", "list item"], quote: ["> ", "", "quote"],
  };
  const tools = root.querySelector(".note-format-tools")!;
  for (const [name, label] of Object.entries({ bold: "Bold", italic: "Italic", link: "Link", list: "Bullet list", quote: "Quote" })) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-icon-button";
    button.dataset.format = name;
    button.dataset.tooltip = label;
    button.setAttribute("aria-label", label);
    const icon = document.createElement("i");
    icon.dataset.lucide = name;
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    tools.append(button);
  }

  function dirty(): boolean { return textarea.value !== (original?.body ?? ""); }

  function limitMessage(): string {
    const entries = bookmark.notes ?? [];
    const replacedId = original?.id ?? addition?.id;
    if (!original && !entries.some((note) => note.id === replacedId) && entries.length >= MAX_NOTES) {
      return `This bookmark has reached its ${MAX_NOTES}-note limit. Edit or delete an existing entry first.`;
    }
    if (textarea.value.length > MAX_NOTE_LENGTH) return "This note is too long. Shorten the draft before saving.";
    const total = entries.reduce((length, note) => length + (note.id === replacedId ? 0 : note.body.length), textarea.value.length);
    return total > MAX_NOTES_LENGTH ? "This bookmark's combined notes are too long. Shorten the draft or an existing entry before saving." : "";
  }

  function controls(): void {
    const limit = limitMessage();
    const missing = Boolean(original && !bookmark.notes?.some((note) => note.id === original?.id));
    if (missing) error = "This note was removed. Your draft is kept; copy it or discard the edit.";
    textarea.readOnly = pending;
    form.setAttribute("aria-busy", String(pending));
    form.setAttribute("aria-label", original ? "Edit note" : "Add a note");
    root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = pending; });
    submitButton.disabled = pending || missing || Boolean(conflict) || Boolean(limit) || !textarea.value.trim()
      || Boolean(original && !dirty());
    const saveLabel = original ? "Save changes" : "Add note";
    submitButton.querySelector("span")!.textContent = pending ? "Saving..." : saveLabel;
    discardButton.disabled = pending || (!original && !textarea.value);
    root.querySelector("#note-counter")!.textContent = `${textarea.value.length.toLocaleString()} / ${MAX_NOTE_LENGTH.toLocaleString()}${dirty() ? " / Unsaved" : ""}`;
    errorElement.textContent = error || limit;
    errorElement.hidden = !error && !limit;
    root.querySelector<HTMLElement>(".note-conflict")!.hidden = !conflict;
    root.querySelector(".note-status")!.textContent = notice;
    if (previewing) renderMarkdown(preview, textarea.value);
  }

  function mode(showPreview: boolean): void {
    previewing = showPreview;
    write.hidden = showPreview;
    preview.hidden = !showPreview;
    writeTab.setAttribute("aria-selected", String(!showPreview));
    previewTab.setAttribute("aria-selected", String(showPreview));
    writeTab.tabIndex = showPreview ? -1 : 0;
    previewTab.tabIndex = showPreview ? 0 : -1;
    controls();
  }

  function clear(): void {
    original = addition = conflict = undefined;
    textarea.value = "";
    error = "";
    mode(false);
  }

  async function canReplace(): Promise<boolean> {
    if (pending || confirming) return false;
    if (!dirty()) return true;
    confirming = true;
    try { return await confirmNoteAction("Your unsaved changes will be discarded. Saved notes are unchanged.", "Discard draft"); }
    finally { confirming = false; }
  }

  async function edit(note: BookmarkNote): Promise<void> {
    if (!await canReplace()) return;
    original = { ...note };
    addition = conflict = undefined;
    textarea.value = note.body;
    error = notice = "";
    mode(false);
    textarea.focus();
  }

  function failure(cause: unknown): void {
    if (cause instanceof StorageQuotaError) error = "Bookmark storage is full. Your draft is kept; free some space and retry.";
    else if (cause instanceof TypeError) error = `${cause.message} Your draft is kept.`;
    else error = "Couldn't save the note. Your draft is kept; try again.";
  }

  async function save(): Promise<void> {
    if (submitButton.disabled) return;
    const restoreFocus = root.contains(document.activeElement);
    const body = textarea.value;
    pending = true;
    error = notice = "";
    controls();
    try {
      let result: NoteMutationResult;
      if (original) result = await updateBookmarkNote(bookmark.url, original, body);
      else {
        addition ??= { id: crypto.randomUUID(), body, createdAt: Date.now() };
        result = await addBookmarkNote(bookmark.url, { ...addition, body });
      }
      if (result.status === "conflict") {
        conflict = { ...result.note };
        error = "This note changed in another window. Load the saved note or explicitly keep your draft against the latest version.";
      } else if (result.status === "not-found" || result.status === "note-not-found") {
        error = "This bookmark or note was removed. Your draft is kept; no record was recreated.";
      } else if (result.status === "updated" || result.status === "unchanged") {
        bookmark = result.bookmark;
        clear();
        notice = "Note saved.";
        onSaved(bookmark);
      }
      try { await refresh(); }
      catch { error = notice ? "Note saved, but the library could not refresh. Retry loading the library." : error; }
    } catch (cause) { failure(cause); }
    finally {
      pending = false;
      controls();
      if (restoreFocus && root.isConnected && (root.contains(document.activeElement) || document.activeElement === document.body)) textarea.focus({ preventScroll: true });
    }
  }

  async function remove(note: BookmarkNote): Promise<void> {
    if (pending || confirming) return;
    confirming = true;
    let accepted: boolean;
    try { accepted = await confirmNoteAction("This deletes this entry, not its bookmark or other notes. Any draft editing this entry will be discarded.", "Delete note"); }
    finally { confirming = false; }
    if (!accepted) return;
    pending = true;
    error = notice = "";
    controls();
    try {
      const result = await deleteBookmarkNote(bookmark.url, note);
      if (result.status === "updated" || result.status === "unchanged") {
        bookmark = result.bookmark;
        if (original?.id === note.id) clear();
        onSaved(bookmark);
        notice = "Note deleted.";
      } else error = result.status === "conflict" ? "This entry changed. Review the latest saved note before deleting it again." : "This bookmark or note is no longer saved.";
      try { await refresh(); } catch { error = "The library could not refresh. Retry loading it."; }
    } catch (cause) { failure(cause); }
    finally {
      pending = false;
      controls();
      if (root.isConnected && document.activeElement === document.body) textarea.focus({ preventScroll: true });
    }
  }

  async function resolveConflict(load: boolean): Promise<void> {
    if (!conflict || pending || confirming) return;
    const latest = { ...conflict };
    confirming = true;
    try {
      const message = load ? "Replace your draft with the latest saved note?" : "Keep your draft against the latest saved version? Save changes will explicitly replace that version.";
      if (!await confirmNoteAction(message, load ? "Load saved note" : "Keep my draft")) return;
      original = latest;
      addition = conflict = undefined;
      if (load) textarea.value = latest.body;
      error = "";
      mode(false);
      textarea.focus();
    } finally { confirming = false; }
  }

  function format(name: string): void {
    if (pending) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const [prefix, suffix, placeholder] = formats[name];
    const selection = textarea.value.slice(start, end) || placeholder;
    const line = (name === "list" || name === "quote") && start > 0 && textarea.value[start - 1] !== "\n" ? "\n" : "";
    const replacement = line + prefix + selection + suffix;
    if (textarea.value.length - (end - start) + replacement.length > MAX_NOTE_LENGTH) return;
    textarea.setRangeText(replacement, start, end, "end");
    textarea.focus();
    textarea.setSelectionRange(start + line.length + prefix.length, start + line.length + prefix.length + selection.length);
    controls();
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); void save(); });
  textarea.addEventListener("input", () => { notice = ""; controls(); });
  writeTab.addEventListener("click", () => mode(false));
  previewTab.addEventListener("click", () => mode(true));
  root.querySelector(".note-editor-modes")!.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    mode(key === "End" || (key !== "Home" && !previewing));
    (previewing ? previewTab : writeTab).focus();
  });
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.dataset.format) format(button.dataset.format);
    if (button.dataset.noteAction === "discard") void canReplace().then((accepted) => { if (accepted) { clear(); textarea.focus(); } });
    if (button.dataset.noteAction === "reload") void resolveConflict(true);
    if (button.dataset.noteAction === "rebase") void resolveConflict(false);
  });

  function update(current: Bookmark): void {
    bookmark = current;
    if (original && !pending) {
      const latest = bookmark.notes?.find((note) => note.id === original?.id);
      if (latest && !sameNote(latest, original)) {
        conflict = { ...latest };
        error = "This note changed in another window. Your draft is kept.";
      }
    }
    controls();
  }

  controls();
  renderNoteIcons(root);
  return { root, edit, remove, update, isPending: () => pending };
}