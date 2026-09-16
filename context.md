# context.md

Persistent memory for this project. Read before any change; update after any
meaningful change. See `CLAUDE.md` for the rule.

## Project

Form 5471 work paper (`form-5471-workpaper`, v2.1.0). Populates a Form 5471
master workbook from client documents entirely in the browser. No backend is
required to use the app.

This repository is `jaynilagrawal1103-lang/5471-work-paper`, the original. A
mirror lives at `squadai90-dot/Linkedin-Post-Automation`; the two client
reconciliations were carried out there and ported back here on 2026-09-12.
All of that work, and the 2026-09-14 OCR rebuild, is merged. `main` is at
`985ce6b` (2026-09-15, the local UX pass and Parnasa remediation). Work branch:
`claude/inspiring-bardeen-k08w1q`, which carries `origin/main` merged in on
2026-09-16 plus this file's corrections.

## Layout

- `dist/index.html` — the shipped app, one self-contained ~3.2 MB file, no
  external scripts or stylesheets. It is committed as reviewed.
- `src/`, `layer-src/` — sources. Some session fixes live in `dist/` only and
  are not yet ported back to `src/`. See `PROJECT-NOTES.md`.
- `server/` — optional Fastify server plus an AI proxy and the OCR proxy
  (`/api/ocr/*` → `OCR_SERVICE_URL`). Not needed to run the app.
- `ocr-service/` — Python OCR service (FastAPI, :8472): PaddleOCR 3.x primary
  (PP-OCRv6/PP-OCRv5 native, or PP-OCRv5 via ONNX Runtime offline), Surya
  second, Tesseract last. `python -m ocr_service`; pytest in `ocr-service/tests`.
- `scripts/` — build, bundle, and local-serve scripts (`serve-local.mjs` also
  proxies `/api/ocr/*`).
- `tests/` — plain `node` `.cjs` tests, one npm script each; `tests/e2e/` holds
  the Chromium end-to-end OCR run; `tests/fixtures/ocr/` the OCR PDFs.

## Commands

- `npm run start:local` — serve `dist/` on http://localhost:8080, Node stdlib
  only, no install and no network. Optional port argument.
- `npm run bundle` — write `dist-bundle/5471-work-paper-local.zip`: `dist/`, the
  server, `start.sh`, `start.cmd`, `README.txt`. `dist-bundle/` is gitignored.
- `npm run build` — intentionally a no-op that keeps the reviewed `dist/`. Use
  `build:full-DESTRUCTIVE` only after porting fixes to `src/`.
- `npm run test:all` — the full test chain (56 suites, 1,367 assertions).
  Needs `npm i` first, and `npm run build:server` once (test:aikey reads
  `dist-server/server.cjs`).
- `npm run start:ocr` (or `python -m ocr_service` inside `ocr-service/`) —
  the OCR service; `npm run test:ocrservice` runs its pytest suite (needs the
  Python deps from `ocr-service/requirements.txt`, and Tesseract for the
  fallback engine). `npm run test:e2e-ocr` drives Chromium through
  upload → detect → OCR → process → generate against `serve-local` + the
  service; not part of `test:all`.

Node 18 or newer. Verified on Node 22.

## Decisions

- Every engine rule lands in BOTH trees: `src/prototype/wp/*` and a surgical
  patch to `dist/index.html` (EN9-prefixed identifiers, paired
  `/*EN9NAME-BEGIN*/…/*EN9NAME-END*/` sentinels, anchored on unique minified
  strings). Ten suites eval those regions, so never run `npm run build:app`
  or `build:full-DESTRUCTIVE` — esbuild strips the sentinels.
- A dist patch must be valid in its syntactic context: the `autoFillRates`
  rate block is a comma expression, so a `var` declaration there breaks the
  whole bundle. Check with `npx esbuild` on the extracted script (lines
  449-1091) before running the suite.
- Mapping rules live in `DEFAULT_RULES` (engine.ts) and the identical `P1`
  literal in dist; regenerate the dist literal from src rather than editing
  it by hand, escaping non-ASCII as uppercase `\uXXXX` as esbuild does.

- OCR runs BEFORE processing, never after it. The layer probes every new PDF
  page by page (`__WPACT.EN9_probePdf`), OCRs the scanned pages through the
  service (in-browser Tesseract.js only when no service answers), replaces the
  scan in intake (`EN9_replaceFile`, new file id, sidecar on `EntityFile.ocr`),
  and `processEntity` awaits `globalThis.EN9OCRGATE.wait(id)` first. A failed
  OCR releases the gate with the error: processing does not start on the
  unread bytes, the original stays attached. The dist patches are the
  `EN9OCR*` sentinels plus the `EN9RDPATH` block; the layer is re-injected
  with `npm run inject:layer`.
- The service is discovered, not assumed: `EN9OCR.service.health()` tries the
  typed address (localStorage `en9OcrUrl`) → `/api/ocr` (http/https pages
  only) → `http://127.0.0.1:8472` → `http://localhost:8472` → the page's host
  on 8472, and posts to the first that answered with an engine. A page opened
  from disk or a static host therefore still reaches a local
  `python -m ocr_service`. The OCR card has a Service address box + Check;
  offline is worded as a status with the next step, never as a fetch error.
- No service → PaddleOCR runs INSIDE the browser (`EN9PPOCR` in the layer):
  PP-OCRv5 det/rec/cls from the `onnxocr` 3.1.0 wheel, fetched from the
  OnnxOCR GitHub LFS store at a pinned commit (sha256 pinned in the layer),
  run by onnxruntime-web 1.29.0 from cdn.jsdelivr.net, cached in IndexedDB.
  Turned/skewed pages are corrected from detection results and the copy
  carries the upright image. Tesseract.js is only the last resort. `off` as
  the service address forces the browser path. Tests: `test:ocrbrowser`
  (jsdom, in test:all) and `test:e2e-ocr-browser` (Chromium from file://,
  CDN/GitHub answered from node_modules and `.cache/`).
- `npm run build:standalone` → `dist/index.offline.html` (gitignored, ~32 MB):
  the same page plus one `<script id="en9-ocr-assets">` of gzipped base64
  holding ONNX Runtime (loader, .wasm, .mjs), pdf-lib and the PP-OCRv5 files.
  `EN9OCRASSET` unpacks it; `EN9PPOCR` asks it before the network, so
  `dist/index.html` is unchanged in behaviour. On a `file://` page the wasm
  goes in via `ort.env.wasm.wasmBinary` and the .mjs via a **data:** URL —
  a `blob:` URL cannot be imported from an opaque origin. Proof:
  `npm run test:e2e-ocr-offline` (every non-file request aborted, 91 checks).
- int8 quantisation of the models was tried and rejected — it loses whole
  lines and mangles figures. Ship fp32.
- The app depends on pdfjs-dist 4.x; never install pdfjs-dist 3.x into
  node_modules (the fallback path's 3.11.174 build lives in `.cache/`).
  pdf.js is never packed into the offline build: the app already bundles it
  with the worker inlined, so the OCR path's CDN branch is dead code.
- A page the service had to turn or straighten is rebuilt upright in the
  searchable copy (cleaned image + words in that frame); text written back
  onto a sideways page scrambles the parser's baseline grouping.
- OCR readings are never corrected in place. The primary engine's text is what
  is booked; a second engine's reading, a grammar failure or low confidence
  becomes a review item with the alternative as `suggestedValue`, and the
  Provenance sheet cites engine, confidence and page position per figure.
- `dist/index.html` stays committed and is the reviewed artifact; CI must not
  rebuild it.
- `scripts/serve-local.mjs` resolves `dist/` either as a sibling (unzipped
  bundle layout) or one level up (`scripts/` in the repo), so one script serves
  both layouts.
- Unknown paths fall back to `index.html` for the single-page app; a failure in
  that fallback returns HTTP 500 rather than crashing the process.

## Status

The reconciliation test's 19 findings are implemented in both trees — see the
2026-09-11 section of `PROJECT-NOTES.md` for what each one was and where it
lives. `npm run test:all` is green, and every new rule was also exercised
against the booted shipped bundle, not only against source.

Bundle and single-file delivery verified: the unzipped bundle serves the full
page on HTTP 200, and deep links fall back correctly.

On 2026-09-15 the shipped single file was re-verified end to end for local
delivery: `dist/index.html` (3,383,443 bytes as of `985ce6b`) has zero external `src`/`href`
URLs, `node scripts/serve-local.mjs <port>` returns HTTP 200 with the whole
file at `/` and at an unknown deep path, and headless Chromium boots the page
— all 16 workspace sections render (~16 KB of text) with no console errors.
The page reports "Backend unreachable - working locally", which is the
expected no-backend state, not a fault. Serving it over HTTP is what makes the
in-page OCR service discovery reach `/api/ocr`; opening the file directly from
disk also works, and then OCR falls back to the local 8472 probe or the
in-browser engine. Re-verified on 2026-09-16 after merging `985ce6b`: 51/51
EN9 sentinel pairs intact, HTTP 200 at `/` and at a deep path, page boots with
no console errors.

A second client reconciliation (SHORI CORPORATION 2024) on 2026-09-11 found
three more defects and fixed them: QuickBooks group totals printed at the
parent account's indent were booked as accounts, a sales return kept the sign
its statement printed on a line the template subtracts, and — the one that
mattered — six rule groups shipped unreachable. `test:all` is now 54 suites and
1,344 assertions. A follow-up on 2026-09-12 closed the last three: Schedule M
line 6 is inferred from a booked wage when one person owns the corporation,
a gate that fills a required cell can no longer be acknowledged or
policy-overridden past, and an unparseable date of formation is flagged.

On 2026-09-14 the OCR path was rebuilt around a PaddleOCR service with
auto-detection at upload and a processing gate; see the 2026-09-14 section of
`PROJECT-NOTES.md`. `test:all` is 56 suites / 1,367 assertions; the Python
service has 25 pytest tests that run the engines loadable on the host.
Same day, a follow-up: the card had shown "OCR service not reachable (Failed
to fetch)" when the page was opened from disk, because the client knew only
`/api/ocr`; the service is now discovered (local 8472 fallback, typed
address). The owner then chose "OCR without installing anything", so
PP-OCRv5 now also runs inside the browser through ONNX Runtime Web, and the
offline build packs the engine into the page so a downloaded file OCRs with
no network at all (see the 2026-09-14 follow-ups in `PROJECT-NOTES.md`).
`test:all` is 58 suites / 1,378 assertions; the Python service 25. That work
is committed and merged — it is `main` at `b5d4d0c`, not a pending branch.
(These suite counts are carried over from the sessions that ran them; they were
not re-run on 2026-09-15, which had no `node_modules` installed.)

On 2026-09-15 the owner landed a local UX pass and the Parnasa reconciliation remediation, committed as `985ce6b` and merged into this branch on 2026-09-16. Those entries had been filed under Open issues and labelled uncommitted; the commit contains exactly the files they describe, so they are recorded here as done:

- 2026-09-15 local UX pass: `layer-src/enhance.js` now scopes OCR detection, visible jobs, manual results and transient selection state to `activeEntityId`; the OCR panel has a drop target, full filename wrapping, and detection/processing/completion timing. The local server's Windows OCR proxy route was corrected in `scripts/serve-local.mjs`. `src/prototype/wp/CoreViews.tsx` now gives Exception Centre a real `onNavigate("signoff")` action; the shipped enhancement layer delegates its matching button to the existing React Review & sign-off navigation control until the dist source is rebuilt. Verified service health and a real scanned-PDF OCR run. A temporary `Entity 2` was added in the browser solely to verify client switching; remove it after confirmation if no longer needed.

- 2026-09-15 local UX pass: Exception Centre blocking sign-off actions now show an in-page mandatory audit-note dialog rather than a browser `prompt`, which can be suppressed in the embedded browser and had made the controls appear inert. The original dismiss/sign-off handler still does the work after a note is provided. The single-item and selected-batch dialog flows were verified and cancelled without changing any review item.

- 2026-09-15 Parnasa reconciliation remediation: Chilean `BALANCE <entity>` pages with assets, liabilities and totals are now classified as balance sheets; Spanish suffix totals such as `INGRESOS TOTALES` and `GASTOS TOTALES` are skipped before broad mapping rules; single-dot Chilean amounts are read as thousands only when the page establishes that convention; and negative cost lines inside a proved expense total are booked as Schedule C deduction magnitudes. The mapping catalogue is v5 so saved projects receive the new total controls. The shipped `dist` has matching EN9 safeguards (no rebuild), including an accurate prior-filing FX-rate explanation. Verified with `test:spanish`, `test:sections`, `test:rulesparity`, `test:detect`, `test:srcparity`, `test:fxparity`, `test:layer`, and `test:integrity`; `test:inject` remains blocked on this Windows host because its temporary symlink requires elevated filesystem permission.

- 2026-09-15 Parnasa follow-up remediation: catalogue v6 adds Chilean balance-sheet coverage for cash, investments, buildings, tax provisions, bank loans, guarantees, other payables and capital. A P&L caption `Patentes` is context-routed to Schedule C other deductions instead of Schedule F intangibles. Schedule E now leaves a zero placeholder and blocks generation until a paid/accrued tax source or preparer assignment is supplied; a P&L tax expense alone is not evidence. Opening balances use the approved prior-year end rate in Basic Information before falling back to a prior filing's printed rate. Source and reviewed dist were patched in parity. Verified `typecheck`, `test:spanish`, `test:fx`, `test:ruleup`, `test:rulesparity`, `test:gen`, `test:boot`, and local HTTP 200.

Residue from that pass is in Open issues below.

## Rule catalogue upgrades

Adding a group to `DEFAULT_RULES` is not enough. `upgradeRules` reaches a saved
project only for groups registered in `RULES_ADDED_SINCE`, and only while
`RULE_CATALOGUE_VERSION` is ahead of what that project stored. Both were missed
on 2026-09-10 and six groups shipped that no existing user could ever receive;
dist had no upgrade path at all until 2026-09-11. `tests/test_rule_upgrade.cjs`
now fails if it recurs, comparing against the baseline in
`tests/fixtures/rules_v3.json` — refresh that file and bump the version when
cutting a release.

## Open issues

- A temporary `Entity 2` was created in the browser on 2026-09-15 purely to
  verify client switching. It lives in browser storage, not in the repo;
  delete it once switching is confirmed.
- `test:inject` could not run on the owner's Windows host: its temporary
  symlink needs elevated filesystem permission. It is not known to be broken.
- Undecided: `tests/fixtures/shori_rows.json` carries a real client entity name
  and 15 partial bank/card numbers with balances. The Boating fixture beside it
  anonymises its entity name; this one does not. The tests pin figures and
  indents, not those captions, so anonymising is safe — awaiting the owner's
  decision.
- Native PaddleOCR weights (PP-OCRv6/v5, PP-StructureV3) download from a model
  hoster on first use; this sandbox could reach none, so the real-engine tests
  ran PP-OCRv5 through ONNX Runtime plus Tesseract 5.3.4, and the Surya
  adapter was verified only as "installed, models absent → skipped". A host
  with access (or a copied `~/.paddlex`) exercises the native path.
- jsdom cannot run the bundled pdf.js text layer, so `test_ocr_workflow.cjs`
  stubs the shipped reader's probe by file name; the real probe is covered by
  the Chromium e2e only.
- `dist/` and `src/` are not in parity; some fixes exist only in `dist/` (the
  in-browser OCR engine lives in the layer, the tie-out/Schedule E helpers,
  the C35 answer from the prior return's Item H boxes). See PROJECT-NOTES.md.
- Schedule Q fills tested-income unit 1 only; a corporation with more than one
  tested unit needs the rest by hand.
- The template formats Basic Information B17 as `mm-dd-yy`, so a correct date
  displays a two-digit year. The value is a real Excel date serial and the
  style survives the patch; do not log this as a difference again.
