# Azkmark

Local bookmarks with search, previews, and manual viewed status.

- **Find:** title/URL search, domain, saved date, and viewed status filters. Date presets: Today, Last 7 days, Last 30 days, or All time. Active ranges refresh at local midnight or on tab return.
- **Browse:** Cards with previews or an image free List. Sort by newest, oldest, or title A–Z/Z–A. View and sort persist across reloads/tabs when storage is available, filter reset preserves both.
- **Manage:** open eye = Viewed, crossed out eye = To view. Pen edits titles, trash requires confirmation. Opening a link never changes its status.
- **Filters:** disclosure preserves selections, the count excludes search/sort. Escape closes the group and returns focus.

## Backup & import

**Export backup** downloads the whole library as JSON, regardless of filters. Backups contain URLs, titles, dates, status, and optional thumbnail references not image files. Uninstall removes local data, export beforehand.

**About backups** accepts azkmark JSON backups and Chrome HTML exports. Existing URL matches remain unchanged, retrying the same file continues after a storage failure. Chrome folders flatten, unsupported links skip, unusable dates default to import time, and imported links start as To view.

## Build & load

```sh
npm install
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the generated **`dist/` directory**.
3. Optionally pin **azkmark** from Chrome's Extensions menu.

`npm run typecheck` checks TypeScript.
