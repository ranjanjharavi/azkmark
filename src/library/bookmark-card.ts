import type { Bookmark } from "../bookmarks/model.js";
import { bookmarkDomain } from "../bookmarks/domains.js";

export type BookmarkView = "cards" | "list";

export function bookmarkCard(
  bookmark: Bookmark,
  view: BookmarkView = "cards",
  savingViewStatus = false,
): HTMLLIElement {
  const card = document.createElement("li");
  card.className = "bookmark-card";

  const link = document.createElement("a");
  link.className = view === "cards" && bookmark.thumbnailUrl
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

  if (view === "cards" && bookmark.thumbnailUrl) {
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

  const viewStatusButton = document.createElement("button");
  viewStatusButton.type = "button";
  viewStatusButton.className = "bookmark-action";
  viewStatusButton.setAttribute("data-action", "viewed");
  viewStatusButton.setAttribute("data-bookmark-url", bookmark.url);
  viewStatusButton.setAttribute("data-viewed", String(!bookmark.viewed));
  viewStatusButton.setAttribute("aria-label", `${bookmark.viewed ? "Viewed. Mark to view" : "To view. Mark viewed"}: ${bookmark.title}`);
  viewStatusButton.setAttribute("aria-pressed", String(Boolean(bookmark.viewed)));
  viewStatusButton.setAttribute("aria-busy", String(savingViewStatus));
  viewStatusButton.disabled = savingViewStatus;

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "bookmark-action";
  editButton.setAttribute("data-action", "edit");
  editButton.setAttribute("data-bookmark-url", bookmark.url);
  editButton.setAttribute("aria-label", `Edit title: ${bookmark.title}`);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "bookmark-action";
  deleteButton.setAttribute("data-action", "delete");
  deleteButton.setAttribute("data-bookmark-url", bookmark.url);
  deleteButton.setAttribute("aria-label", `Delete bookmark: ${bookmark.title}`);

  actions.appendChild(viewStatusButton);
  actions.appendChild(editButton);
  actions.appendChild(deleteButton);
  card.appendChild(link);
  card.appendChild(actions);
  return card;
}
