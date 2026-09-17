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

On 2026-09-16 the OCR path was measured end to end (report:
`OCR_Workflow_and_Accuracy_Report.xlsx`, delivered to the owner; scripts and
outputs stayed in the session scratchpad, nothing in the repo changed). Host:
4 cores, no GPU, PP-OCRv5 via ONNX (weights inside the `onnxocr` wheel, no
download), Tesseract 5.3.4 eng+spa. Evidence: pytest 25/25; `test:e2e-ocr`
107/107 against the shipped dist + service; 18 OCR'd pages x 2 engines on the
same cleaned images; 26 in-app processing runs (digital original vs PaddleOCR
copy vs Tesseract copy). Results: PaddleOCR figures 98.3% (100% on clean
scans, 39/42 on hard pages), Tesseract 92.8% (29/42 hard); work-paper
bookings identical to the digital original from PaddleOCR copies 56/57,
from Tesseract copies 30/57 - Tesseract's word boxes split captions
("Accounts", "Deferred", "Trade") so lines land on wrong rows even when the
digits are right. Keep PaddleOCR primary. Engine time per 300 dpi page with
no contention: PaddleOCR 0.6-1.1 s, Tesseract 0.4-1.8 s; two Tesseract
processes on one 4-core host thrash (55-580 s a page).

On 2026-09-17 the U.S. Shareholders block (Shareholding Details rows 7-14) was
made reachable. It had never received data: `FORMULA_REFS[shareholding]`
marked rows 7-16 as formula cells so `buildWrites` refused every write, no
writer targeted those rows, and the master template ships B7/H7/J7 as
`=B19/=H19/=J19` — a one-row mirror of the FIRST direct holder. On HMC
Communications that printed a New Zealand trust as a 100% U.S. shareholder
while Schedule B Part I's two U.S. shareholders appeared nowhere and the
Subpart F column stayed blank (Part I column (e) is its only source).
Schedule B Part I was already parsed into `CarryForward.usHolders`; it simply
had nowhere to go. Now: rows 7-14 columns B/F/H/J/P are writable (L/N and the
15-16 totals stay formulas); `Entity.usShareholders` holds Part I, kept apart
from `shareholders` (Part II) so a person counted both directly and through a
trust is not double-counted; `usShareholderWrites()` fills rows 7-14, writes
column (e) into the Subpart F column as a fraction, and clears every row it
does not use so a stale mirror cannot survive; an empty list writes nothing
and a warning explains that the mirror is still showing. Both save paths (a
processing run and a Shareholders-tab edit) write the block. Two review items:
`cf-us-holders-absent` (warn) when Part I is unreadable, and
`cf-us-holder-base` (warn) when Part I and Part II share totals disagree — the
% columns divide by the DIRECT total, so they cannot match the stated pro rata
% when the two differ (HMC: Part I 51 shares, Part II 98). dist mirrors all of
it under EN9USSHREF / EN9USSH / EN9USSHR / EN9USSHW / EN9USSHF / EN9USSEED /
EN9USSHRV. New suite `tests/test_us_shareholders.cjs` (`test:usshare`, 20
checks, in `test:all`) covers both trees and asserts they agree exactly.
Same day, the missing half: there was no UI for the block, so nothing changed
on screen. The Shareholders tab now carries a SECOND card, "U.S. Shareholders
rows 7-14", with a Subpart F % column and its own add/edit/remove actions
(`addUsShareholder`, `updateUsShareholder`, `removeUsShareholder`). The direct
card keeps rows 19-26. dist mirrors both under EN9USSHACT and EN9USSHUI
(hand-written minified React using the page's own jsx runtime, Callout and
source-badge components). Verified in Chromium: 15 checks covering the card
rendering, the empty-state warning about the template mirror, and the values
reaching B7/B8/H7/J8 with P7/P8 = 0.255.

Two follow-on defects, found by generating a real workbook rather than trusting
the write list (2026-09-17):

1. Row 7 still showed the DIRECT holder while rows 8+ showed the U.S. ones.
   `xlsxPatch.setCell` has a second, independent guard — a P0 audit fix — that
   refuses to replace a cell holding a formula with a plain value. B7/H7/J7 are
   the template's `=B19/=H19/=J19` mirror, so those three writes were silently
   dropped while the empty rows below took theirs. `applyWrites` now takes
   `mayReplaceFormula(sheet, ref)`; `REPLACEABLE_FORMULA_REFS` (engine.ts) is
   the whole allow-list and contains exactly one entry: Shareholding Details
   B/F/H/J/P rows 7-14. Everything else stays protected, and the injection hole
   the P0 fix closed stays closed — `buildCell` still cannot emit `<f>`, so no
   user string can become a live formula. A first attempt keyed the allowance
   off FORMULA_REFS, which was far too broad and rightly failed `test:gen`.
2. The Subpart F percentage shipped as 0.26, not 0.255. `buildWrites` rounds
   every number to 2 dp unless the write says otherwise, and a percentage held
   as a fraction needs more; the P writes now carry `dp: 6`.

Proof is an end-to-end generation run in Chromium: build the HMC shape (a trust 98 direct, two individuals 25.5/25.5 at 25.5%), generate, unzip, read the
sheet. B7 = the first U.S. shareholder, H7/J7 = 25.5, P7/P8 = 0.255, row 9 empty, B19
still the trust with 98. `test:usshare` is 23 checks; `test:all` 1279.

2026-09-17, third pass — the % Ownership denominator. Every percentage in BOTH
shareholder blocks divided by `$H$27`/`$J$27`, the DIRECT-holder total, so a
sole direct holder always read 100% and the U.S. rows read shares ÷ 98 (26.02%)
rather than the 25.50% the return states. Schedule B Part I gives both a share
count (columns (c)/(d)) and the pro rata percentage (column (e)) for the SAME
holder, so the denominator the preparer used is derivable: shares ÷ (pct/100).
HMC: 25.5 ÷ 0.255 = 100 shares outstanding. `outstandingFromPartI()` returns it
only when every Part I holder implies the same figure (tolerance: half a share
or 0.5%), and it is written to new template cells H4 (BOY) / J4 (EOY) — never
when it would be below what the direct holders already hold.

The master template changed for the first time: `assets/master-template.xlsx`
and the copy embedded in `dist/index.html` (they are byte-compared by
`test:boating`, so both were rewritten). B4 carries the label, H4/J4 are the
inputs, and all seven percentage formulas became
`IFERROR(H7/IF($H$4>0,$H$4,$H$27),0)` — the entered total when there is one,
the old direct-holder total when there is not, so an existing file is
unchanged. Only `xl/worksheets/sheet2.xml` differs; the other 74 parts are
byte-identical.

Proof, by generating a workbook and recalculating it with LibreOffice: H4/J4 =
100, both U.S. shareholders 25.5 shares at 25.50% each, Subpart F 25.50% each,
U.S. totals 51 shares / 51.00%, "% held by U.S. Shareholders" 51.00% (was
126.02%), the trust 98 shares at 98.00% (was 100%). `test:usshare` is 32
checks, the end-to-end generation test 13, `test:all` 1288.

Note on BOY/EOY share counts: they are NOT calculated. They are read verbatim
from Part I columns (c)/(d), which print 25.500 — 25.5 SHARES. The 25.50% is a
different column, (e), the pro rata Subpart F share. The two look alike here
only because 100 shares are outstanding.

Verified against the client's actual return (page 41 of the 2023 filing):
parsed, generated and recalculated with LibreOffice, every cell matches the
form. The page itself was NOT kept as a fixture — it carries SSNs and a home
address, and the parse it proves is already covered by row-level fixtures.

Test data is synthetic. `test_schedule_b.cjs` and `test_us_shareholders.cjs`
previously carried the real names, street address and SSNs from that return;
all of it is now replaced (ALAN R SAMPLE / BETH M SAMPLE / TEST TRUST, 1 SAMPLE
STREET, 111-11-1111 …). The share counts and percentages are unchanged — they
are what the logic turns on. Narrative comments still name the engagement, the
way the repo's other fixtures do.

`test_us_shareholders.cjs` also drives the REAL `extractCarryForward` over a
synthetic Schedule B page and carries its output through to the cells. Sections
1-5 test the writer in isolation and `test_schedule_b.cjs` tests a COPY of the
scanner, so neither would notice the extractor changing what it hands the
writer; that seam is now covered. `test:usshare` is 34 checks.

## HMC FY2025 reconciliation (2026-09-17) — open defects

A tool-generated FY2025 work paper was reconciled against the client's
hand-prepared FY2024 work paper, the signed 2025 accounts and the filed 2023
return. The shareholding block reconciles in full. Schedule C and Schedule F do
not. Every variance is arithmetically closed; the full workbook lives with the
owner. Fourteen findings, the first three critical:

1. `tagSections()` treats a REPEATED statement title as a section banner. These
   accounts print "Statement of Financial Performance" as a running header on
   the P&L's second page, so the section flips from `costs` back to `income` at
   the page break and every page-2 caption with no keyword match is booked as
   gross receipts. Six rows, 326,669 of expenses and donations booked as
   income. Reproduced against the source, not inferred: see the probe shape in
   the reconciliation. Fix: let a statement-title pattern set the section only
   on its first appearance in a document; a repeat is page furniture.
2. `structRows()` only recognises a subtotal when its components are indented
   DEEPER than the total row. These accounts print the total at the SAME indent
   as its components, so "Total Purchases", "Total Donations paid", "Total
   Shareholders Remuneration" and "Total Term Liabilities" were all booked on
   top of the detail beneath them. 270,737 double-counted. Fix: add a fourth
   test — a total-word caption whose value equals the sum of the consecutive
   rows immediately above it at the SAME indent, keeping the arithmetic proof.
3. A movement schedule (the accounts' "Shareholder Current Accounts" page:
   opening balance, funds introduced, drawings, closing balance) was classified
   as a balance-sheet page, putting 12 non-balances on Schedule F line 16.
   113,062 of the 111,749 year-end imbalance. Fix: recognise the shape in the
   page classifier and book only its closing balance, or nothing.

Also open: PPE/intangibles have no keyword rules so they fall to the "other
assets" pool and the prior-return seeder then fills the empty lines 9a/9b with
the same asset (34,167 counted twice); the prior-return carry-forward does not
check that the return's period end matches the work paper's OPENING date, so a
FY2023 return seeded a FY2025 work paper (Schedule J opened 2,093 light and two
Schedule F lines carried 31/03/2023 balances); `'Shareholding Details'!N19` —
the first DIRECT holder — is the shareholder percentage in four template cells
(`8992!F7`, `Worksheet A!D82`, `Worksheet B!F16`/`F27`) and should be `N16`;
the master template ships Schedule E `M16`/`O16`/`Q16` empty so the foreign tax
has no rate and converts to zero; the Retained Earnings sheet's opening cell is
never written although Schedule F already holds the figure (#VALUE! and a
119,253 break); a keyword match outranks the section banner across the
income/deduction divide (Motor Vehicle Contribution deducted, not earned); the
accounts' Directory page names all three direct shareholders and is not read;
line 21a is written negative; the other-deductions block has 17 rows where the
client's own template has 25.

Schedule F did not balance at either end (52,663 and 111,749) — the tool caught
both and the blockers were acknowledged with the note "test". Consider
rejecting trivial acknowledgement notes and stamping the imbalance on the
Schedule F sheet itself, not only on Provenance.

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

- `test:peg` fails at "the approved prior-year end rate outranks a prior
  return's printed rate" (0.833 vs 0.82). PRE-EXISTING: it fails identically at
  985ce6b, before the 2026-09-17 work. Which rate should win is a business-rule
  decision for the owner, so it was left alone rather than silently changed.
- OCR: a figure corrupted to `1:100.000)` (bracketed negative on a grainy
  Spanish scan) gets no flag - `validate.py looks_numeric` rejects any token
  with a colon before the grammar checks - and the app's `numericCell` then
  refuses digit:digit as a time, so the figure is silently absent from the
  work paper. Only unflagged OCR error that reached the work paper in the
  2026-09-16 test. Fix: treat >=4 digits with one colon as numeric-like and
  flag it; raise a review item for a caption row with digits but no value.
- OCR: a wrong digit that keeps a valid shape (`61,199.37`, `443.711`) passes
  the grammar check; only the cross-engine comparison catches it, and only
  when the engines disagree. Fix candidates: always cross-check numeric
  crops regardless of page confidence; sum-to-printed-total check surfaced
  as an OCR review item.
- OCR, minor: em dash read as a middle dot and glued to neighbours
  (`SHEET·12/31/2024`, 15/18 pages); Spanish words glued
  (`Préstamobancario`, `Capital.pagado`) - still mapped. Split on dashes and
  middle dots in `split_line_into_words`.
- Mapping side, seen while testing OCR (not OCR's fault): from the DIGITAL
  fixture the rules leave Accounts payable, Deferred revenue and Retained
  earnings unmatched and route Trade receivables to BS:10 by section
  fallback; a bare 4-column trial balance and a 5-line German page classify
  as `unknown`.
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
