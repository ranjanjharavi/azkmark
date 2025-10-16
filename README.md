# azkmark

Local bookmarks for Chrome with search, collections, tags, and manual viewed status.

- Search titles, URLs, and tags. 
- Filter by domain, tag, saved date, or viewed status.
- Browse a split list and details view with thumbnails or random placeholder artwork.
- Organize bookmarks into collections.
- Edit titles, collections, and tags.
- Mark bookmarks viewed or not viewed. Opening pages leaves viewed status unchanged.
- Sort by saved date or title. Sort order persists across reloads.

## Backups

- Export the full library as JSON, including collections and thumbnail URLs.
- Import azkmark JSON or Chrome HTML from Import. Existing URLs keep saved details.
- Export before uninstalling. Uninstalling deletes local data.

## Build and load

```sh
npm install
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose **`dist/`**.
3. Optionally pin **azkmark** from the Extensions menu.

Typecheck: `npm run typecheck`.

Tests: `npm test` builds first, then runs Node's built-in test runner.