const FORMATTING_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "a",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "del",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td"
];

export function renderMarkdown(host: HTMLElement, source: string): void {
  if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
    host.textContent = source;
    return;
  }
  const renderer = new marked.Renderer();
  renderer.html = () => "";
  renderer.image = () => "";
  const html = marked.parse(source, {
    async: false,
    gfm: true,
    renderer
  });
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: FORMATTING_TAGS,
    ALLOWED_ATTR: ["href", "title"],
    ALLOW_DATA_ATTR: false
  });
  fragment.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") ?? "";
    if (!/^(https?:|mailto:)/i.test(href)) link.removeAttribute("href");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  host.replaceChildren(fragment);
}

export function noteIcon(name: string): HTMLElement {
  const icon = document.createElement("i");
  icon.dataset.lucide = name;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

export function renderNoteIcons(host: HTMLElement): void {
  if (typeof lucide !== "undefined") lucide.createIcons({ root: host });
}
