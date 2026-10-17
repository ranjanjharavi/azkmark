# azkmark

Local bookmarks for Chrome with search, collections, tags, Markdown notes, and manual viewed status.

- Search titles, URLs, tags, and saved note bodies.
- Filter by domain, tag, saved date, or viewed status.
- Browse a split list and details view with thumbnails or random placeholder artwork.
- Desktop panes scroll independently with native thin scrollbars. Narrow screens stack the panes and keep page scrolling for details.
- Organize bookmarks into collections.
- Edit titles, collections, and tags.
- Mark bookmarks viewed or not viewed. Opening pages leaves viewed status unchanged.
- Sort by saved date or title. Sort order persists across reloads.

## Notes

- Add dated Markdown entries in the library's Notes tab. The Details tab contains the full URL, tags, and collection.
- Write or preview notes, edit an existing entry, or delete it after confirmation.
- Drafts remain in memory across selection, tab, filter, and storage refreshes. Reloading or closing the library discards unsaved drafts.
- Conflicting edits from another window preserve the draft. Load the saved entry or explicitly keep the draft against the latest version before saving again.
- Each note allows 65,536 UTF-16 code units. Each bookmark allows a maximum of 100 notes.
- Notes, icons, and Markdown rendering work locally with packaged dependencies. Embedded HTML and images are excluded. 

## Backups

- Export the full library as version 4 JSON, including collections, thumbnail URLs, and complete note histories with IDs and creation/edit timestamps.
- Import older azkmark JSON backups (versions 1, 2, and 3) without migrating existing data eagerly.
- Import azkmark JSON or Chrome HTML from Import. Existing URLs keep saved details.
- Duplicate URLs also keep their existing notes, histories are not merged.
- Chrome HTML imports do not contain azkmark note histories. Use JSON for lossless backups.
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

Rendering dependencies are pinned in the package lock. The build copies their
browser distributions and licenses into `dist/vendor/`. No CDN or CSP exceptions
are required.
