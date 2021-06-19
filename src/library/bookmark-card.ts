import type { Bookmark } from "../bookmarks/model.js";
import { bookmarkDomain } from "../bookmarks/domains.js";

export function bookmarkCard(bookmark: Bookmark): HTMLLIElement {
  const card = document.createElement("li");
  card.className = "bookmark-card";

  const link = document.createElement("a");
  link.className = bookmark.thumbnailUrl
    ? "bookmark-link"
    : "bookmark-link bookmark-link--text-only";

  link.href = bookmark.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("data-bookmark-url", bookmark.url);

  const title = document.createElement("h2");
  title.textContent = bookmark.title;

  const metadata = document.createElement("div");
  metadata.className = "bookmark-meta";

  const domain = document.createElement("p");
  domain.className = "bookmark-domain";
  domain.textContent = bookmarkDomain(bookmark.url);
  metadata.appendChild(domain);

  link.appendChild(title);
  link.appendChild(metadata);

  if (bookmark.thumbnailUrl) {
    const preview = document.createElement("div");
    preview.className = "bookmark-preview";

    const loading = document.createElement("p");
    loading.className = "preview-loading";
    loading.textContent = "Loading preview…";
    loading.setAttribute("aria-hidden", "true");

    const image = document.createElement("img");
    image.className = "bookmark-image";
    image.alt = "";
    image.width = 640;
    image.height = 360;
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    image.referrerPolicy = "no-referrer";

    image.addEventListener("load", () => {
      image.classList.add("loaded");
      loading.remove();
    }, { once: true });
    
    image.addEventListener("error", () => preview.remove(), { once: true });
    image.src = bookmark.thumbnailUrl;

    preview.appendChild(image);
    preview.appendChild(loading);
    link.appendChild(preview);
  }

  const actions = document.createElement("div");
  actions.className = "bookmark-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "bookmark-action";
  editButton.textContent = "Edit title";
  editButton.setAttribute("data-action", "edit");
  editButton.setAttribute("data-bookmark-url", bookmark.url);
  editButton.setAttribute("aria-label", `Edit title: ${bookmark.title}`);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "bookmark-action";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("data-action", "delete");
  deleteButton.setAttribute("data-bookmark-url", bookmark.url);
  deleteButton.setAttribute("aria-label", `Delete bookmark: ${bookmark.title}`);

  actions.appendChild(editButton);
  actions.appendChild(deleteButton);
  card.appendChild(link);
  card.appendChild(actions);
  return card;
}
