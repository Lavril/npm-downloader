# NPM Explorer & Downloader

Chrome extension to explore npm packages, view dependency trees, and download package tarballs (latest).

## Features

- Search npm packages by name (configurable registry)
- View package version, description, and dependencies (collapsible tree)
- Navigate dependencies with Back button (session history)
- Download package tarball (`dist.tarball`)
- Download selected dependencies or download all recursively
- Recursive download shows progress (text + progress bar) and supports soft cancel
- Caching of package metadata via `chrome.storage.local`
- Dependency graph visualization (D3)
- MIT licensed

## Installation (developer)
1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable *Developer mode*.
4. Click *Load unpacked* and select the `npm-explorer` folder.

## Files
- `src/manifest.json` - Chrome manifest
- `src/popup.html`, `src/styles.css`, `src/popup.js` - extension UI and logic
- `src/icons/` - icons in multiple sizes
- `LICENSE`, `README.md`, `PRIVACY.md` - docs

## Notes
- The extension queues downloads with `chrome.downloads.download`. Chrome handles actual file transfer; this tool treats queued downloads as successful for progress tracking.
