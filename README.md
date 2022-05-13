# Azkmark

Local bookmarks with search, collections, previews, and manual viewed status.

- **Find:** title/URL search, domain, viewed-status, and saved-date filters. Date presets: Today, Last 7/30 days, All time. Ranges refresh at local midnight/tab return.
- **Browse:** lazy Cards with text fallback, image-free List. Sort newest/oldest/title A–Z/Z–A. Sort/view persist across tabs/reloads when storage allows, filter reset keeps both.
- **Collect:** All bookmarks, Unsorted, or named collections. Create/rename/delete, deletion keeps bookmarks in Unsorted. Popup Save to remembers the last successful new save.
- **Actions:** open/crossed-out eye = Viewed/To view, pen = title/collection edit, trash = confirmed delete. Untouched fields keep newer saved edits. Opening links never changes status.
- **Filters:** disclosure keeps selections, count excludes search/collection scope/sort/view. Escape closes it and returns focus.
- **Open library:** reuses a loaded library tab, preserving filters/drafts. Unloaded/discarded tabs may open another.

## Backup & import

- **Export backup:** whole-library v3 JSON, regardless of scope/filters. Includes empty collections, assignments, URLs, titles, dates, status, and optional thumbnail URLs—not image files. Export before uninstall, local data is deleted.
- **About backups:** imports JSON v1–3 or Chrome HTML. Existing URLs keep all saved details. Collections match normalized, case-insensitive names, colliding IDs regenerate. Partial failures report confirmed additions, retry the same file without duplicate bookmarks or collections.
- **Chrome HTML:** folders flatten into Unsorted, unsupported links skip, unusable dates use import time, new links start as To view.

## Build & load

```sh
npm install
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the generated **`dist/` directory**.
3. Optionally pin **azkmark** from Chrome's Extensions menu.

`npm run typecheck` checks TypeScript.
