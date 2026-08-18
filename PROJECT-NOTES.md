# 5471 Work Paper — full project package

## What is in here
| Path | What it is |
|---|---|
| `src/` | Frontend source — TypeScript/React (entry.tsx, prototype/, styles/) |
| `server/` | **Backend** — Fastify API (`server/src/index.ts`), Postgres pool + migration runner (`db.ts`), SQL migrations (`server/migrations/001_init.sql`) |
| `scripts/build.mjs` / `build-server.mjs` | esbuild builds: app -> `dist/`, server -> `dist-server/server.cjs` |
| `dist/index.html` | The BUILT app, **currently containing every fix and feature from the Claude session** (entity isolation, year rule, IRS authority panel, OCR, UI layer, bug fixes) |
| `layer-src/` | Source of the EN9 enhancement layer (theme.css, enhance.css, enhance.js) injected into dist/index.html |
| `scripts/inject-layer.mjs` | Re-injects layer-src into dist/index.html |
| `tests/` | Test suites: `test_enhance.js` (26 UI groups / 106 assertions, jsdom), `test_vf.js` (12 year-rule tests), `test_spaces.js` (space-typing fixes) |
| `assets/master-template.xlsx` | 5471 master workbook template |
| `docs/` | User guide |
| `netlify.toml`, `vercel.json`, `_redirects` | Deploy configs |

## CRITICAL WARNING — do not lose the fixes
All fixes from the Claude session were applied to the **built** `dist/index.html`
(and to the injected layer), NOT to `src/`. Therefore:

- `npm run build` / `npm run build:app` REGENERATES `dist/index.html` from `src/`
  and will WIPE those fixes.
- If you must rebuild from src, port the fixes into `src/` first (the commit
  messages in the repo describe each change), or diff the current
  `dist/index.html` against a fresh build.
- After any rebuild, run `npm run inject:layer` to restore the UI layer
  (filters, pagination, authority panel, OCR card, palette, etc.).

## Running
- Static (no backend): `npx serve dist` — the app is fully functional offline.
- With backend: set `DATABASE_URL` (Postgres; Railway TLS auto-detected),
  optionally `PORT`, `CORS_ORIGINS`, `MAX_UPLOAD_MB`, then
  `npm run build:server && npm run start:server`.
- Tests: `npm i` (installs jsdom) then `npm run test:all`.

## Environment variables (server)
`DATABASE_URL` (required), `PORT`, `CORS_ORIGINS`, `MAX_UPLOAD_MB`
