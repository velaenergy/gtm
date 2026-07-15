# AGENTS.md

## Cursor Cloud specific instructions

Vela GTM is a **Manifest V3 Chrome extension** (no bundler, no build step, and no
runtime npm dependencies). All logic ships as plain ES modules loaded directly by
Chrome. There is nothing to compile.

### Services / how to run

- **Unit tests + manifest validation**: `npm run check` (runs
  `scripts/validate-manifest.mjs` then `node --test`). `npm test` runs only the
  Node test suite. Tests are pure Node with no external services.
- **UI preview (no Chrome needed)**: `npm run preview` serves the repo statically
  on `http://localhost:4173` via `python3 -m http.server`. The extension pages
  detect the absence of `chrome.*` APIs and fall back to a seeded preview mode
  (demo prospect "Joshua Rivera", stub Gmail senders, `chrome.storage` backed by
  `localStorage`). Useful entry points:
  `http://localhost:4173/popup.html` (side panel),
  `http://localhost:4173/dashboard.html` (control room),
  `http://localhost:4173/options.html` (settings).
  Append `?theme=light|dark` or `?tab=draft` to `popup.html` to inspect variants.
- **Optional writer server**: `npm run writer` starts `server/index.mjs` on
  `http://127.0.0.1:8787` and requires `OPENAI_API_KEY`. It is an optional
  production boundary and is NOT needed for tests or the preview UI.

### Non-obvious notes

- The full extension (LinkedIn profile parsing, ContactOut session bridge, Gmail
  `gmail.send`, Google OAuth) only exercises end-to-end when the folder is loaded
  as an unpacked extension in Chrome 116+; those flows need real Chrome APIs and
  external credentials, so they cannot run fully headless. Use `npm run preview`
  plus the seeded demo data to verify UI/interaction changes without Chrome.
- Preview mode is inferred at runtime from missing `chrome.tabs.query` (see
  `state.isPreview` in `popup.js`); it is not a separate build target.
- `vendor/xlsx.full.min.js` is a committed vendored dependency for MailMerge
  import/export — do not expect it in `node_modules`.
