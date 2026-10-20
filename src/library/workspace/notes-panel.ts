import type { Bookmark } from "../../bookmarks/model.js";
import { orderedNotes } from "../../bookmarks/notes.js";
import { noteIcon, renderMarkdown, renderNoteIcons } from "../../ui/markdown.js";
import { initializeNoteEditor } from "./note-editor.js";

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className = "",
  text = ""
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

interface Panel {
  root: HTMLElement;
  notes: HTMLElement;
  metadata: HTMLElement;
  history: HTMLOListElement;
  notesTab: HTMLButtonElement;
  detailsTab: HTMLButtonElement;
  historyKey?: string;
  bookmark: Bookmark;
  editor: ReturnType<typeof initializeNoteEditor>;
}

export function initializeNotesPanel(refresh: () => Promise<void>) {
  const panels = new Map<string, Panel>();
  let selectedUrl: string | undefined;
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  function selectTab(panel: Panel, notes: boolean): void {
    panel.notes.hidden = !notes;
    panel.metadata.hidden = notes;
    panel.notesTab.setAttribute("aria-selected", String(notes));
    panel.detailsTab.setAttribute("aria-selected", String(!notes));
    panel.notesTab.tabIndex = notes ? 0 : -1;
    panel.detailsTab.tabIndex = notes ? -1 : 0;
  }

  function createPanel(bookmark: Bookmark): Panel {
    const root = element("section", "bookmark-notes");
    const tabs = element("div", "notes-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Bookmark information");
    const notesTab = element("button", "", "Notes");
    const detailsTab = element("button", "", "Details");
    notesTab.type = detailsTab.type = "button";
    notesTab.id = "notes-tab";
    detailsTab.id = "details-tab";
    const notes = element("section", "notes-content");
    const metadata = element("section", "notes-metadata");
    notes.id = "notes-content";
    metadata.id = "notes-metadata";
    for (const [tab, content] of [
      [notesTab, notes],
      [detailsTab, metadata]
    ] as const) {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", content.id);
      content.setAttribute("role", "tabpanel");
      content.setAttribute("aria-labelledby", tab.id);
      tabs.append(tab);
    }
    const history = element("ol", "note-history");
    history.setAttribute("aria-label", "Note history, newest first");
    const editor = initializeNoteEditor(bookmark, refresh, (saved) => {
      panel.bookmark = saved;
      panel.historyKey = undefined;
      renderHistory(panel, saved);
    });
    notes.append(editor.root, history);
    root.append(tabs, notes, metadata);
    const panel: Panel = { root, notes, metadata, history, notesTab, detailsTab, editor, bookmark };
    notesTab.addEventListener("click", () => selectTab(panel, true));
    detailsTab.addEventListener("click", () => selectTab(panel, false));
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const useNotes = event.key === "Home" || (event.key !== "End" && document.activeElement === detailsTab);
      selectTab(panel, useNotes);
      (useNotes ? notesTab : detailsTab).focus();
    });
    selectTab(panel, true);
    return panel;
  }

  function renderHistory(panel: Panel, bookmark: Bookmark): void {
    const key = JSON.stringify(bookmark.notes ?? []);
    if (panel.historyKey === key) return;
    panel.historyKey = key;
    panel.history.replaceChildren();
    const notes = orderedNotes(bookmark.notes);
    panel.notesTab.textContent = `Notes (${notes.length})`;
    if (!notes.length) {
      panel.history.append(element("li", "notes-empty", "No notes yet."));
      return;
    }
    for (const note of notes) {
      const item = element("li", "note-entry");
      const header = element("header", "note-entry-header");
      const timestamp = new Date(note.createdAt);
      const validDate = Number.isFinite(timestamp.getTime());
      const date = element("time", "", validDate ? dateFormat.format(timestamp) : "Unknown date");
      if (validDate) date.dateTime = timestamp.toISOString();
      header.append(date);
      if (note.updatedAt !== undefined) {
        const edited = element("span", "note-edited", "Edited");
        if (Number.isFinite(new Date(note.updatedAt).getTime())) edited.title = dateFormat.format(note.updatedAt);
        header.append(edited);
      }
      const actions = element("div", "note-entry-actions");
      for (const [action, label, icon] of [
        ["edit", "Edit note", "pencil"],
        ["delete", "Delete note", "trash-2"]
      ]) {
        const button = element("button", "note-icon-button");
        button.type = "button";
        button.id = `note-${action}-${note.id}`;
        button.dataset.tooltip = label;
        button.setAttribute("aria-label", label);
        button.append(noteIcon(icon));
        button.addEventListener("click", () => {
          if (action === "edit") void panel.editor.edit(note);
          else void panel.editor.remove(note);
        });
        actions.append(button);
      }
      header.append(actions);
      const body = element("div", "note-markdown");
      renderMarkdown(body, note.body);
      item.append(header, body);
      panel.history.append(item);
    }
    renderNoteIcons(panel.history);
  }

  function render(bookmark: Bookmark, metadata: HTMLElement): HTMLElement {
    let panel = panels.get(bookmark.url);
    if (!panel) {
      panel = createPanel(bookmark);
      panels.set(bookmark.url, panel);
    }
    if (selectedUrl !== bookmark.url) selectTab(panel, true);
    selectedUrl = bookmark.url;
    panel.bookmark = bookmark;
    panel.editor.update(bookmark);
    panel.root.dataset.bookmarkUrl = bookmark.url;
    panel.metadata.replaceChildren(metadata);
    renderHistory(panel, bookmark);
    return panel.root;
  }

  return { render };
}
