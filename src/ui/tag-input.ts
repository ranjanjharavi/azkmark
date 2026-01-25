import { isTags, MAX_TAG_LENGTH, MAX_TAGS, normalizeTags, snapshotTags } from "../bookmarks/tags.js";
import { requireElement } from "./dom.js";

interface TagInput {
  read: () => string[] | undefined;
  set: (tags: readonly string[]) => void;
  updateVocabulary: (tags: readonly string[]) => void;
  setDisabled: (disabled: boolean) => void;
}

// All edits stay local to the form. Reading includes pending text but never
// consumes it, so another invalid field or a failed save cannot lose that draft
export function initializeTagInput(prefix: string): TagInput {
  const input = requireElement<HTMLInputElement>(`#${prefix}-tag`);
  const add = requireElement<HTMLButtonElement>(`#${prefix}-tag-add`);
  const list = requireElement<HTMLUListElement>(`#${prefix}-tags`);
  const suggestions = requireElement<HTMLDataListElement>(`#${prefix}-tag-options`);
  const error = requireElement<HTMLParagraphElement>(`#${prefix}-tag-error`);
  const status = requireElement<HTMLParagraphElement>(`#${prefix}-tag-status`);
  let draft: string[] = [];
  let vocabulary: readonly string[] = [];
  let disabled = false;

  function clearError(): void {
    error.hidden = true;
    error.textContent = "";
    input.removeAttribute("aria-invalid");
  }

  function updateSuggestions(): void {
    const options = document.createDocumentFragment();
    vocabulary.forEach((tag) => {
      if (!draft.includes(tag)) {
        options.appendChild(new Option(tag, tag));
      }
    });
    suggestions.replaceChildren(options);
  }

  function render(): void {
    const items = document.createDocumentFragment();
    draft.forEach((tag, index) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = tag;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "tag-remove";
      remove.setAttribute("aria-label", `Remove tag: ${tag}`);
      remove.disabled = disabled;
      remove.addEventListener("click", () => {
        if (disabled) {
          return;
        }

        draft.splice(index, 1);
        clearError();
        render();
        status.textContent = `Removed tag: ${tag}.`;
        const buttons = list.querySelectorAll<HTMLButtonElement>("button");
        const next = buttons[index] ?? buttons[index - 1] ?? input;
        next.focus({ preventScroll: true });
      });

      item.append(text, remove);
      items.appendChild(item);
    });

    list.replaceChildren(items);
    list.hidden = draft.length === 0;
    updateSuggestions();
  }

  function read(): string[] | undefined {
    const tags = normalizeTags([...draft, input.value]);
    const count = tags.length;
    if (isTags(tags)) {
      clearError();
      return tags;
    }

    error.textContent = count > MAX_TAGS
      ? `Use up to ${MAX_TAGS} tags. Remove a tag before adding another.`
      : `Each tag must be ${MAX_TAG_LENGTH} characters or fewer. Shorten the tag before saving.`;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return undefined;
  }

  function addTag(): void {
    if (disabled) {
      return;
    }

    const tags = read();
    if (!tags) {
      return;
    }

    const tag = normalizeTags([input.value])[0];
    const duplicate = tag && draft.includes(tag);
    draft = tags;
    input.value = "";
    render();
    status.textContent = "";

    if (tag) {
      const action = duplicate ? "Tag already added" : "Added tag";
      status.textContent = `${action}: ${tag}.`;
    }

    input.focus();
  }

  add.addEventListener("click", addTag);
  input.addEventListener("input", clearError);

  return {
    read,

    set: (tags) => {
      draft = snapshotTags(tags);
      input.value = "";
      clearError();
      status.textContent = "";
      render();
    },

    updateVocabulary: (tags) => {
      vocabulary = tags.slice();
      updateSuggestions();
    },

    setDisabled: (value) => {
      disabled = value;
      input.readOnly = value;
      add.disabled = value;
      const buttons = list.querySelectorAll<HTMLButtonElement>("button");
      buttons.forEach((button) => {
        button.disabled = value;
      });
    },
  };
}
