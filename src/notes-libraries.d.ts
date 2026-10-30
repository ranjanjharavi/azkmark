declare const marked: {
  Renderer: new () => { html: () => string; image: () => string };
  parse(
    source: string,
    options: {
      async: false;
      gfm: true;
      renderer: { html: () => string; image: () => string };
    }
  ): string;
};

declare const DOMPurify: {
  sanitize(
    source: string,
    options: {
      RETURN_DOM_FRAGMENT: true;
      ALLOWED_TAGS: string[];
      ALLOWED_ATTR: string[];
      ALLOW_DATA_ATTR: false;
    }
  ): DocumentFragment;
};

declare const lucide: {
  createIcons(options: { root: HTMLElement }): void;
};
