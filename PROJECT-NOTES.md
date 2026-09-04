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

### Session 2026-08-21 — crash-proofing, button hygiene, OCR placement, honest re-processing

Dist string patches (all anchors were unique; pinned by `tests/test_gen.cjs`):
1. `refreshTasks` coerces a null task list to `[]`; `hydrateAll` tolerates a
   null workpaper list; `ensureWorkpaper` throws "createWorkpaper returned no
   record" instead of dereferencing a null create result (killed the autosave
   TypeError loop). Tasks callout title is now "Task management is currently
   unavailable — backend connection required".
2. Generate buttons now live ONLY in Executive overview, Workpaper preview,
   Entity workspace ("Generate this entity") and Review & sign-off. The
   Entities & documents page-header button was removed; Workpaper readiness'
   action is an "Open sign-off" link.
3. `removeFile` also drops `docClasses[fileId]` + `docKindOverrides[fileId]`,
   resets `status:"idle"`, and nulls `processedAt` when no files remain.
4. `/*EN9PRUNE-BEGIN*/…/*EN9PRUNE-END*/` before the re-process wipe: detected
   entries (incl. `cat:*`), profile/ownership values still equal to their
   detection, cf-seeded categories, sourced shareholders, currencyConfirmed
   and fxAuto rates are cleared when their source document is no longer
   attached. Hand-typed values, sign-offs, mapOverrides, translations and
   excludedSheets survive. Audit line: "Stale document data cleared".

Layer (`layer-src/enhance.js` + `enhance.css`; re-inject after edits):
- `enhanceOverviewButton()` — with nothing processed, the Overview primary
  action becomes "Preview format" (downloads the untouched master template
  from `#wp-template` as `5471_Workpaper_Blank_Format.xlsx`); the React
  Generate button is hidden via `.en9-swapped`, restored when any entity has
  lines or a completed run, and the layer stands down if a rebuilt app ships
  its own Preview-format button.
- `enhanceOcrPanel()` re-anchored: the card sits INSIDE the docs-tab content,
  directly after the dropzone, so a tab switch removes it — it can no longer
  linger on Shareholders/Dividends. A pending OCR result re-surfaces after a
  rebuild; "Add to intake" is one-shot (`EN9OCR.result` cleared).
- OCR provenance badge `⚠ OCR — verify` (`.en9-ocr-flag`): mapping rows and
  any `.wp-table` provenance small citing an "(OCR).pdf" document. The full
  OCR panel appears nowhere else.
- Settings cards are tab-scoped via `en9SettingsTab()`: Authoritative sources
  on Methodologies only, the OCR engine card at the bottom of Free services
  only.

src/ mirrors (land on the next proper rebuild; src is still behind dist):
api.ts non-JSON throw, persist.ts null guards, TasksView guard-before-map +
copy, PrototypeApp `ViewBoundary` error boundary (src-only — not patchable
into the minified React tree), store `downloadBlankTemplate()` +
`pruneRemovedDocData()` + removeFile parity + `detected["cat:*"]` seeds,
Overview/Readiness/Entities button changes.

Tests: `test_gen.cjs` +13 pins; `test_enhance.cjs` now 29 groups (19 and 21
rewritten for tab scoping/placement, 23 asserts one-shot intake, 28 Overview
swap + blank download, 29 OCR badges). Verified live on both failure modes:
plain 404 (`npx serve dist`) and SPA-fallback 200-HTML — friendly message,
zero console errors, no white screen.

NOTE: the previously-live deployment predates these fixes (its white screen
and extra Generate buttons are stale-build artifacts) — redeploy `dist/`
verbatim.

## Session 2026-08-24 — consolidated fix pass (A–F)
All functional edits applied to `dist/index.html` and `layer-src/` per the
convention above, plus one new backend module. `npm run test:all` is now
**14 suites**; `npm run inject:layer` was run after the layer edits.

| Item | What changed |
|---|---|
| **B1** | `EN9toIso` accepts ISO `YYYY-MM-DD` / `YYYY/MM/DD`. New `EN9reqIso` **throws** on a supplied-but-unparseable date instead of returning null — the spot-rate caller logged `let u=EN9toIso(h.end)\|\|void 0` and then asked every provider for a *dateless* rate, which came back as today's and was stamped as the year-end rate. An unparseable dividend date now raises a **blocking** review item. |
| **B2/B3** | `EN9nearestPoint` is backward-only (largest date ≤ requested, never later at any distance) with the window widened 7 → 10 days. Failures name the requested date and the oldest date searched. |
| **B4** | `EN9fxManualMeta` stamps the **measurement** date as `asOf` (from the entity's own `cyEnd`/`pyEnd` via `EN9fxMeasureDate`) and records `enteredOn` separately. `EN9asOfLabel` untouched. |
| **C1** | `EN9r2` / `EN9r2add` — 2dp at accumulation in `bF` and again at workbook write in `sl` (Sch C, Sch F boy/eoy, and every numeric `extraWrites` cell). Text cells pass through untouched. |
| **C2** | `"total for income"` / `"total for expenses"` added to the SKIP rule (QuickBooks phrasing; neither contains the existing `"total income"`/`"total expenses"` substrings). Parts Sold, Discounts given, Disbursements, Billable Expense Income and Uncategorised Income deliberately **left unmapped**. |
| **D1** | Root cause found in-bundle: `maxTokens:8e3` + a real prompt vs a **TPM of 8000** → 413 on the first call. Budgets now scale (`EN9maxTokensFor`), batches 40 → 25, and a rolling 60s token gate paces requests. `EN9askResume` splits a batch on 413 and resumes, backs off on 429/5xx honouring `retry-after`. |
| **D2** | `EN9classifyGroq` separates credential (401/403/`invalid_api_key`) from transient (413/429/5xx/network). Transient restores the prior status and writes an amber `EN9notice`; only credential failures set the red sticky `lastError`. |
| **D3** | `Be.EN9revalidateGroq()` checks a stored key silently on load. |
| **E** | **New:** `server/src/aiProxy.ts` — `POST /api/ai/chat` injects `GROQ_API_KEY` server-side; origin allow-list, optional `AI_PROXY_TOKEN`, per-IP minute+day rate limits, model allow-list, `max_tokens` ceiling, key redaction on passthrough. `/api/health` gained `aiProxy`. Client picks proxy vs personal key via `EN9aiMode`; Settings names the mode and the trade-off. **No build-time key injection.** |
| **F** | Local-first task store (IndexedDB, localStorage fallback) behind `EN9taskStore`; the API adapter is used only when the health check actually answered. The single "Backend is not connected" banner became four states (`local` / `unreachable` / `connected` / `checking`) — file:// and a static-host 404 no longer share a message. Backend-URL override moved into the UI. Local assignment is labelled "this browser only", never claimed as real. |
| **A1** | **Root cause:** `autoFocus:!0` on the popup search input — focusing inside a scrollable ancestor scrolls it into view. Now `focus({preventScroll:true})` via `EN9focusNoScroll`, used by both the React filters and the layer. |
| **A2/A3/A4** | The separate filter row is gone; carets sit on existing column headers on every table in every tab. Unlabelled and action-only columns (Remove/Restore/Use/…) are skipped. The Status filter reads the **chip**, not the select's options. |
| **A5** | `EN9popPlace` clamps left/right, flips above the trigger near the viewport bottom, and repositions on scroll and resize from the trigger's **live** rect. Narrow screens scroll the table horizontally inside its panel — the old rule hid `thead` outright, taking the headers and filters with it. |
| **A6** | One popup, appended to `<body>`. `.wp-table` sets `overflow:auto` and clipped it in the `<th>`, and a React rebuild tore it down mid-keystroke. Caret clicks are delegated. |
| **A7** | `tkey` is derived from the panel heading, the header's own text and the column count, with `[data-en9]` nodes stripped first. The old document-wide `querySelectorAll("table")` index changed whenever any earlier table mounted, silently losing filter state, page and rows-per-page and appending a duplicate pager each time. |

### New test suites
`test_groq`, `test_tasks`, `test_taskstore`, `test_aikey`, `test_tables`,
`test_schedc`, `test_boot` — added to `test:all`. `test_taskstore` drives the
real storage adapters through `fake-indexeddb` across all three environments;
`test_boot` loads the shipped `dist/index.html` in jsdom and asserts the app
renders. `test_fx`, `test_ai_map`, `test_gen` and `test_enhance` were updated
where an assertion pinned behaviour these items deliberately changed.

### New environment variables (server)
`GROQ_API_KEY`, `AI_PROXY_TOKEN`, `AI_RATE_PER_MIN`, `AI_RATE_PER_DAY`,
`AI_MAX_TOKENS`, `AI_MODELS` — all optional; without `GROQ_API_KEY` the proxy
reports itself off and browsers fall back to a personal key.

## Session 2026-08-26 — mapping accuracy rules 1-7 + step 4

Driven by fixture #1 (2Hats Consulting B.V. 2024). The fixture replays the real
Yuki report rows through the **shipped** mapping code via `window.__EN9MAP`
(a debug hook in the bundle) and scores against the reviewed workpaper. No copy
of the mapping logic lives in the test.

**Result: financial line accuracy 11% -> 90%; Schedule F balances to the cent.**

| Rule | Change |
|---|---|
| **6** | Ligature folding (fi/fl/ffi...) + control-character stripping in `ZY()`, the single point every extracted string passes. Fixes the NUL bytes that made the generated `.xlsx` fail XML validation. Applied again on the way into the workbook. |
| **1** | `EN9structRows` — three structural subtotal tests, no keyword list: forward (rows indented beneath sum to it), backward (rows above at a deeper indent sum to it), and total-worded rows at the document's outermost indent. `EN9dropFurniture` removes running headers/footers first so the backward scan survives page breaks. |
| **2** | `EN9dedupeRows` — one booking per `(document, page, caption, value)`. |
| **3** | `EN9sectionOk` — a caption cannot cross the banner it was printed under (assets/liabilities/income/costs), and within the balance sheet cannot cross sides. |
| **3b** | `EN9sectionRoute` — **beyond the brief.** The banner is documentary evidence, so it now outranks the model's guess (but never an explicit keyword rule). This is what routes a "depreciation" caption to accumulated depreciation under Assets and to the expense line under Costs. |
| **4** | `EN9balance` / `EN9tieOut` — Schedule F must balance; wired into `gn()` so it blocks generation. Verified: fires on the old figures naming the exact gap, silent on the corrected sheet. |
| **5** | `EN9PLACEHOLDERS` + `EN9clearPlaceholders` — the template's demo shareholder ("A" / 60 / 0.6), the hard-coded 60/100 totals and the leftover `VAT Payable` / `CAISSE D'EPARGNE` labels are blanked on every generation. |
| **7** | `EN9parseUsShareholders` — Schedule B **Part I** parser, which did not exist. Reads by column position, so `Common Stock`, `Class A Common`, `Ordinary Shares` and `COMMON` all parse; every one was silently dropped before. |
| **Step 4** | `EN9schETax` writes the income tax to Schedule E (O16/Q16 + identification). The template chain `Income Statement J56 -> Sch-H I10 -> I26 -> Schedule J F23` and `Schedule E U21 -> Sch-H G19` is entirely formula-driven, so this one write is what lights up Sch-H, Schedule I-1, 8992 and Worksheet A. Sign convention: the P&L keeps the tax negative, Schedule E receives the magnitude. `EN9tieTax` flags a disagreement. |

### Before / after on fixture #1
| Line | Before | After |
|---|---|---|
| Cash | 114,923.68 | **28,447.17** |
| Gross receipts | 385,453.38 | **174,223.36** |
| Compensation | 559,921.89 | **186,640.63** |
| Depreciable assets / accum. dep. | 1,864.09 / 0 | **1,449.37 / -1,390.12** |
| Common stock / retained earnings | 11,609.32 / -3,781.36 | **4,500.00 / -1,890.68** |
| Other deductions / other income | 199,649.31 / - | **3,252.17 / 18,503.33** |
| Assets vs liabilities+equity | out by 42,939.81 | **29,641.42 = 29,641.42** |
| Unmatched captions | 6 | **0** |
| Rows skipped as subtotals | 3 | **38** |

### Correction to an earlier finding
The audit claimed "Tangible fixed assets was booked twice from page 2". The
provenance shows page 2 (59.25) and page 4 (236.97) — two different rows. It is
caught by the section guard, not by dedupe.

### Known presentation difference (not an error)
The tool books Creditors 259.24 to Accounts payable and social security 6,087 to
other current liabilities; the reviewed workpaper does the reverse. Both sides
total 29,641.42 identically.

### New in this session
`tests/fixtures/harness.cjs` (jsdom driver), `tests/fixtures/2hats_rows.json`,
`tests/fixtures/2hats_ai_mappings.json`, `tests/test_fixture_2hats.cjs`
(20 checks, wired into `test:all`). `window.__EN9MAP` debug hook in the bundle.

### Correction + wiring (2026-08-27, follow-up session)
The "11% -> 90%" fixture number was measured through `tests/fixtures/harness.cjs`,
which applied rules 1/2/3 itself — at `c087eb9` those rules were DEFINED in dist but
never called by the app (only `window.__EN9MAP` referenced them), so the shipped
pipeline scored ~10% on the same rows and the newly-wired balance check then blocked
generation undismissably. Fixed in this session:
- Rules 1-3 wired into the real pipeline: PDF feed items now carry `x0` and run
  `EN9tagSections` -> `EN9structRows` per document/feed side; structurally-skipped
  rows are honored (and logged) by stage 3; `EN9sectionRoute` now actually fires
  (F.section exists); `EN9sectionOk` vetoes AI proposals that cross a banner.
- Cross-document booking dedupe (same target+caption+value+field from a different
  document books once, with an info item) replaces the dead `EN9dedupeRows` wiring;
  `EN9dedupeRows` itself remains harness-only (its key would merge legitimate
  identical rows).
- Schedule F tie-out block is dismissible per entity (merged through the dismissal
  lookup in gn(), navigable target, no duplicate ids). EN9tieTax is wired (warn).
- `EN9clearPlaceholders` no longer mutates entity state from render (sl() works on
  a local copy; polluted saves heal on restore).
- Schedule E writes CURRENT tax only (|IS:54|) — deferred tax is not "paid or
  accrued"; the old `abs(54+55)` overstated tax when a deferred benefit existed and
  fed the Sch-H -> I-1 -> 8992 chain. I16/K16 receive the year, not a full date.
- aiProxy hardened: rate-limit config fails closed, XFF honored only behind
  TRUST_PROXY=1, bounded bucket map, response_format/reasoning_effort allow-listed,
  JSON-only content-type on our origin, loud boot warning for keyed-but-tokenless
  deployments. Proxy 401/403/503 no longer reported as "Groq rejected the API key".
- FX copy corrected everywhere to the real rule: the last rate published on or
  before the date, searching back 10 days (was "nearest on or before the date (10-day search)").
- `tests/test_wired.cjs` guards against dead-wiring regressions (call-site counts,
  dismissal behavior, extraWrites stability).

## Wave 2 — P3 quick wins (2026-08-27)

- **Re-process confirm**: `processEntity` asks before recomputing when results
  exist; dismissed reviewItems (sign-offs) are carried across the wipe
  (`reviewItems:(e.reviewItems||[]).filter(q=>q.dismissed)` — `gn()` merges by id).
- **removeEntity** now also calls `ss.deleteWorkpaper()` and prunes
  `workpaperIds`, so deleted entities no longer resurrect on hydrate.
- **Duplicate uploads**: `addFiles` is async and SHA-256-digests each file
  (`EN9sha`; fallback key `nk:name|size|lastModified` off secure contexts). A
  byte-identical re-upload is refused with a toast + audit entry. All three
  call sites are fire-and-forget, so the signature change is safe.
- **Build safety**: `scripts/build.mjs` now REFUSES to overwrite a
  dist/index.html containing EN9 fixes or SheetJS unless `FORCE_REBUILD=1`.
  SheetJS is vendored at `vendor/xlsx.full.min.js` (extracted from dist) and
  emitted by the build, so even a forced rebuild keeps `.xls` support.
  `build:full` renamed `build:full-DESTRUCTIVE`. New suites:
  `tests/test_dist_integrity.cjs` (blocks + sentinel pairs + size floor) and
  `scripts/check-guide.mjs` (user-guide drift guard) — test:all is 18 checks.
- **Quota honesty**: Settings tab relabeled "Usage".
- **Few-shot examples** added to the pass-1 mapping prompt (Creditors→BS:46,
  Salaries→IS:26, Depreciation→IS:30, two subtotal→null examples).
- **docs/user-guide.md** (interim) replaces the stale docx as the authoritative
  written guide; `check-guide.mjs` extracts tab count / models / FX copy FROM
  dist so the guide cannot silently drift. Full illustrated regen = Wave 4.
- **json_schema DEFERRED (decision)**: the mapping response keys are dynamic
  row indices; OpenAI-compatible strict `json_schema` requires fixed
  properties + `additionalProperties:false`, so adopting it means reshaping
  the response to an array and rewriting `EN9parseMap`. gpt-oss support for
  json_schema on Groq is unverified. Revisit only if Wave 3 shows real-world
  `json_object` parse failures; the proxy already allow-lists both shapes.

## Wave 5 — reproducibility fixes (2026-08-27, after the live client-doc run)

The reviewed client run needed ~30 manual corrections; these fixes move them into
the pipeline so a fresh run converges on its own. Verified by four full fresh-state
reruns of the 4-document case (wipe → load → process, zero interventions):

- **q1 emits section banners.** Label-only rows ("Current Liabilities", "Cash
  Assets", "Equity") were silently dropped (`if(!c.length)continue`) so
  EN9tagSections never saw a real banner — tags only ever came from *valued*
  total rows, whose stale carry-over poisoned neighbouring sections. q1 now
  pushes EN9banner rows (raw mode excluded); stage-3 skips them
  (`if(F.EN9skip||F.row&&F.row.EN9banner)continue`).
- **EN9SECTB lexicon** covers real statement banners (current/non-current
  assets & liabilities, cash assets, inventories, current tax assets, equity,
  issued capital, P&L page titles, Dutch variants). Cross-statement scrub: the
  IS feed drops assets/liabilities tags, the BS feed drops income/costs tags.
- **Stage-3 rule veto**: a rule target that contradicts the row's banner is
  nulled and re-routed (EN9sectionRoute) or queued. EN9sectionOk now knows the
  pseudo-targets (BS:OCA=assets, BS:OCL/BS:OL=liabilities) — GST rules resolve
  to BS:OCL, which previously slipped past the side check. sectionRoute assets
  branch gained gst; Keystone's net GST asset now lands in current tax assets.
- **Fiscal year-end from the title**: "year ended 30 June 2024" scanned from the
  raw profile grids sets cyEnd/pyEnd (Feb-29 clamped) with a review note —
  before the 12/31 statement-year default. AU June-years now automatic.
- **Profile writes type-checked** at both choke points (detection q() and the
  AI profile pass): dates must parse (EN9dv), currency must be a 3-letter code;
  rejects raise review items. Kills the year-end-overwritten-with-entity-name
  corruption (source: "Balance sheet as of 2024" caption).
- Bank-account captions (account #s, IBAN, cheque/savings account) can never
  book to the income statement; stock-movement rules (opening/closing → IS:12
  with closing negated post-pass, stock on hand → BS:14); issued-capital rule →
  BS:59; negative deduction bookings raise info review items; address fields
  refuse pure numbers; sl() falls back legalName→entityShort/name for B11;
  Provenance now lists rule and manual bookings too; AI prompt shows each
  caption's banner and clarifies IS:12 is COGS-only.
- **fs-equity pages** also feed generic-bs. KNOWN LIMITATION: Keystone's
  equity page (p12) still yields no candidate rows (q1 column-ruler fails on
  the sparse 2-row page) — equity needs manual entry there; a completeness
  check is the follow-up.
- Debug tap: `window.__EN9FEED[docName]` records the tagged feed per document.
- tests/detect_test_src.cjs chunk 5 (q1) regenerated; test_wired pin updated.

Fresh-run result (run 4): Keystone assets/liabilities tie the statement exactly
both years (equity manual); Shaka balances exactly incl. negative equity; 2Hats
balances to the cent, 0 unmatched (year-end needs one manual click — no title
in the Dutch report). Manual steps left for the operator: confirm currency,
2Hats year end, Keystone equity (4 values), dismiss the $1-$3 statement-rounding
tie-outs, and the by-design judgment fields.

## Wave 6 — mixed-page classification fix (2026-08-27, from the user's gold-vs-export recon)

The user's fresh 2Hats export booked the revenue into "Other deduction 1"
(income statement unusable) while the balance sheet was exact. Trace: the Dutch
report's P&L pages classify into the generic-bs page set; the Wave-5
cross-statement scrub then deleted their income/costs banner tags and the
feed-prefix guard stopped rules from booking IS lines — the AI guessed blind.

- **Banner-driven re-feed** replaces the scrub: a row tagged income/costs in
  the BS feed moves to the IS feed (and vice versa), with a log line
  ("N row(s) re-routed ... by their statement section banners"). Rules now book
  the P&L: 2Hats IS is fully rule-mapped and lands on the gold composition
  (gross receipts 174,223.36, other income 18,503.33, compensation 186,640.63).
- **Income-statement sanity blocker** `EN9-tie-is-rev` in EN9tieOut: zero
  revenue/other income with >1,000 of deductions blocks generation
  (dismissible, same flow as the Schedule F tie-out).
- Rules: wkr expense/werkkostenregeling -> IS:26; small material/kleinmateriaal
  -> IS:OD. Negative-deduction review items upgraded info -> warn (the -49
  interest sign surfaces in the Exception center; not auto-flipped because
  genuine contra-costs exist, e.g. 40990 Other personnel costs -9.37).

Regression-verified with a full wipe-and-reprocess of the 4-document case:
Keystone/Shaka unchanged (exact statement ties), 2Hats balanced 29,641.42 both
sides with 0 unmatched and the IS now matching the preparer's workbook net of
the flagged interest sign and gold's whole-euro rounding.

### Session 2026-09-04 — boxed tax forms (Chile SII Form 22)
Two Chilean CFCs mapped **0 lines**. Root cause was not classification or
translation: it was row extraction. `extractRows` requires a caption and a
number on the same row (`if (!label) continue`), and the SII Form 22 prints a
box CODE at the far left, the CAPTION on the line above, and the AMOUNT
right-aligned inside the box — no row carries both.

- **`stackedCaptionRows` (src) / `EN9stackRows` (dist)** rebuilds caption/amount
  pairs from PDF geometry and appends them to the grid, so keyword mapping,
  translation and review run unchanged. Codes and amounts are both bare digits
  and are separated *structurally*: the page's amount columns are measured from
  cells that are unambiguously money (a grouping separator), and only cells
  landing on one of those right-edges — or carrying a separator themselves —
  may be read as amounts. A code glued onto a neighbouring amount
  ("928.368.104 1409") is split off and used as the next box's boundary; a code
  glued in front of wrapped caption text opens its own box. A caption that
  opens lower-case is a wrap fragment, not a heading, and is refused.
- **`applyRowHygiene` bracket guard.** A caption with unmatched brackets is the
  tail of a wrapped sentence. "…deberá declarar por Internet)" was nine words —
  inside the existing prose guard — and booked the annual tax settlement as
  telephone expense on the word "Internet". A leading enumerator ("a) Cash") is
  discounted first.
- **Mapping rules the reader exposed.** "Otros gastos deducibles **de los
  ingresos**" hit only the keyword "ingresos" and was booked as revenue — an
  expense on the wrong side of the statement. Added a Spanish deduction floor
  ("gastos", "egresos", "de los ingresos"), cost-of-sales terms ("costo
  directo", "existencias, insumos"), "remuneracion", "arriendo", "otros
  ingresos" → Other income, the return's own totals → SKIP, and
  "depreciación **tributaria**" → SKIP (the return states depreciation twice,
  book and tax, and both matched the depreciation rule).

Measured on the two client filings: 0 mapped lines → 11 and 12, and both
income statements now reconcile **exactly** to the figures on the face of the
return (Charlie Brawn: components tie to Total de ingresos/egresos anuales and
to Base Imponible; Cecilia: income less deductions = Resultado financiero to
the peso).

**Limit worth stating: the Form 22 carries no line-by-line balance sheet.** It
reports Total del Activo, Total del Pasivo, Capital Efectivo, Activo
Inmovilizado and Patrimonio financiero as single boxes — there is no cash,
receivables or inventory detail. Schedule F cannot be built from this document;
financial statements are still required for the balance sheet.

Tests: `tests/test_stacked_form.cjs` (17 assertions), wired into `test:all`
(now 866). The fixture uses the real form's layout and the real form's
wording with invented amounts — a client's filed figures do not belong in a
repository. One assertion runs the SHIPPED `EN9stackRows` out of
`dist/index.html` against the same geometry and requires it to return exactly
what `src` returns.
