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

## Session 2026-08-20 — three changes (branch `three-changes`)
All edits applied directly to `dist/index.html` per the convention above (EN9-prefixed identifiers, anchored string patches).

1. **Always-on AI mapping** — `EN9aiRun` (before `var Be=`) runs automatically as processing step 6: chunked Groq calls (40 labels, confidence high/medium auto-book via `bF`, low = suggestion only) over the unmatched residue AND a NEW profile-caption path (`QF` now captures non-matching caption/value pairs into `entity.EN9unmatchedProfile`). No key → silent skip. Settings ▸ AI platform ▸ "Automatic AI mapping" toggle (`groq.EN9auto`, default ON). "Resolve with Groq" delegates to the same pass. AI badge in the mapping table via the EN9 layer.
2. **Year-detection hardening** — `EN9_HY`/`EN9_CYW`/`EN9_PYW`/`EN9_RSV`/`EN9_INH` helpers; `oJ`/`e8` now accept date-style ("31 Dec 2024"), FY-style, and Current/Prior-labelled headers (word labels resolve from the case year, else refuse); multi-page PDF ruler inheritance (`inheritRulerFrom` now populated). `vF` UNTOUCHED. New `EN9-boy-gap-*` info item when a BS row books eoy but drops boy.
3. **FX nearest-date + sources** — `/*EN9FX-BEGIN*/` block: session-cached OFX allTime series, `EN9ofxOnDate` nearest-day (±7d, tie→earlier) lookup wired into `tC`; fiscal-year guard lifted (calendar tables skipped, OFX average over the true fiscal window + date spots fill instead); Feb-29 window crash fixed; manual entry / Override C60 stamp `fxMeta` (tag: IRS/Treasury/OFX/ECB/Manual); source shown in FX view, Workbook tab, Preview, sign-off badges; OFX metered + honors the Settings checkbox; FX view reads `state.rateDb`.

Tests: `tests/test_detect.cjs` (+`detect_test_src.cjs` snapshot, self-syncing vs dist), `tests/test_fx.cjs`, `tests/test_ai_map.cjs`, test_enhance group 27 (AI badge); `test:all` runs all six suites. `tests/test_enhance.cjs` also gained a Blob.arrayBuffer polyfill (jsdom ≤26 lacks it — the OCR group could never pass on a stock jsdom).

### Follow-up 2026-08-20 — one-pass AI mapping
`EN9aiRun` rewritten so the automatic pass finishes the job in one run:
- **Pass 2 retry** for every row pass 1 left null/low-confidence, re-asked with amounts, year tags and source document, and told that Other-income/deduction pool lines are valid answers and `null` is only for subtotals. A pass-2 `null` never erases a pass-1 suggestion.
- **Confidence no longer gates booking.** Anything that survives `bF` (VALID_TARGETS + `vF` year rule + tax signs) is booked; low confidence is booked AND raises a `warn` review item (`EN9-ai-*` / `EN9-aip-*`, `applied:!0`) instead of being handed back to the preparer.
- Only two things still return for manual work: captions the model rejects twice (subtotals/totals/non-financial) and rows with no unambiguous current-year figure (year rule).
- NOTE on confidence: it is **self-reported by the model** in its JSON reply (`"c"`), not computed. `EN9norm1` only sanitises it (anything not literally high/medium → low). The real safety is the deterministic `bF` gate, which is confidence-independent.

### Follow-up 2026-08-20 — real-client debug (Keystone / Shaka / ZUNO 2023 return)
Two defects found by running three real AU client PDFs through the tool:
1. **Balance-sheet rows carrying only a prior-year figure were discarded.** `vF` required a current-year value on every BS row (`else return[]`), so an opening balance with a blank current-year column (Keystone: Structural Improvements 150,928, Less: Accum dep (45,760), Stock On Hand, Security Bonds, Superannuation Payable, Taxation, PAYG, GST payable adj) never reached Schedule F column D. Fixed: `else if(EN9py.length!==1)return[]` — no CY + exactly one PY now books `boy` alone. P&L behaviour unchanged (a PY-only P&L row is still refused). 4 new tests (suite is now 16); mirrored into vf_test_src.js.
2. **Profile AI candidates were 100% noise.** `QF` captured any caption with a non-empty neighbour, so table-of-contents rows ("Trading Account" => "5") and every unmapped P&L caption ("Commissions Received" => "9,703") were queued for the profile LLM call. Fixed with a value-shape filter: a profile candidate's value must contain a letter, a date separator, or "%". Keystone went from 17 junk candidates to 0.

Measured on the real files (two AU CFCs, 30 June 2024 fiscal year ends):
Keystone 74 captions → 68 booked (91.9%); Shaka 73 → 70 (95.9%). Every remaining row is a P&L caption whose current-year column is blank in the source PDF — nothing to book. FX filled from OFX (fiscal year ⇒ IRS calendar tables correctly not applied). The ZUNO 2023 federal return also fanned out a third CFC, "Hope Dealers Pty Ltd", for which no 2024 financial statements were supplied.
