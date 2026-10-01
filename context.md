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
  the Chromium end-to-end OCR and AI-agent runs; `tests/fixtures/ocr/` the OCR
  PDFs.

## Commands

- `npm run start:local` — serve `dist/` on http://localhost:8080, Node stdlib
  only, no install and no network. Optional port argument.
- `npm run bundle` — write `dist-bundle/5471-work-paper-local.zip`: `dist/`, the
  server, `start.sh`, `start.cmd`, `README.txt`. `dist-bundle/` is gitignored.
- `npm run build` — intentionally a no-op that keeps the reviewed `dist/`. Use
  `build:full-DESTRUCTIVE` only after porting fixes to `src/`.
- `npm run test:all` — the full test chain (57 suites). `test:peg` is the one
  known failure; see Open issues.
  Needs `npm i` first, and `npm run build:server` once (test:aikey reads
  `dist-server/server.cjs`).
- `npm run start:ocr` (or `python -m ocr_service` inside `ocr-service/`) —
  the OCR service; `npm run test:ocrservice` runs its pytest suite (needs the
  Python deps from `ocr-service/requirements.txt`, and Tesseract for the
  fallback engine). `npm run test:e2e-ocr` drives Chromium through
  upload → detect → OCR → process → generate against `serve-local` + the
  service; not part of `test:all`. `npm run test:e2e-agent` drives Chromium
  through the AI agent in the shipped file (Settings card + a full processing
  run with the model stubbed at the network boundary); also not in `test:all`.

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

2026-09-28 in-browser PaddleOCR asset loading (layer only, NOT committed at
owner's request; extraction/mapping/calculation untouched):
- Root cause of "Could not download …/ppocrv5_dict.txt (404)" and the silent
  switch to Tesseract.js: the dictionary is an ordinary git file in the pinned
  OnnxOCR commit, but the page fetched it from media.githubusercontent.com,
  which serves only Git LFS objects. det/rec/cls are LFS (media.* is right
  for them; raw.* returns a 132-byte LFS pointer). `EN9PPOCR.urls()` now
  returns a list per file: weights from media.*, dictionary from raw.* then
  cdn.jsdelivr.net/gh. A hand-set `en9OcrModelsUrl` still serves all four.
- `MODEL_SHA` was pinned but never checked. Now `EN9PPOCR.check()` refuses an
  empty file, an LFS pointer, an HTML page or a sha256 mismatch for built-in,
  stored (IndexedDB) and downloaded copies; a bad stored copy is deleted and
  fetched again. Dictionary pinned: sha256 d1979e9f…af1b, 18,383 lines.
- `fetchFile(urls,label,asset,sha)`: each place tried twice on a network
  error (1.5 s apart); a 4xx or wrong file moves to the next place; every
  reason is kept in the thrown error. Network errors name the URL.
- After the sessions start, `recClasses()` must equal blank+dictionary+space
  (18,385 for this commit) or the engine stops with the reason.
- Tesseract.js is still the fallback when PaddleOCR cannot be recovered; its
  row reads "Primary OCR unavailable — fallback OCR used; review recommended."
  with the real error in Details. A later successful load clears the reason.
- `scripts/build-standalone-ocr.mjs` and `tests/e2e/ocr_browser_e2e.mjs`
  fetched the dictionary from media.* too (the e2e hid it by serving every
  media.* path from a local cache); both use raw.* now and the e2e route
  answers 404 for non-LFS paths on media.*, as the real host does.
- `test:ocrbrowser` +5 cases (hosts, refusal matrix, purge, retry, classes).
  `test:e2e-ocr-browser` 89/89 (it had been failing at its first wait since
  the engine line moved into the closed Advanced disclosure; now waits for
  "attached", and reads `urls().rec[0]`).

2026-09-28 (7) OCR: Tesseract.js second opinion when PaddleOCR fails or is
unsure (layer only; NOT committed).
- `en9OcrRun` page loop: PaddleOCR's page result goes through
  `en9OcrSecondOpinion`. Unsure = error on the page, no text, mean word
  confidence < `EN9OCR.UNSURE_MEAN` (0.85), or > `EN9OCR.UNSURE_LOW` (25%) of
  words under 0.80 (`en9OcrUnsure`, `en9OcrPageConf`). Then
  `realIO.fallbackRecognize` reads the same rendered page with Tesseract.js
  (loaded on demand, one worker per run, terminated at the end). Tesseract is
  used when PaddleOCR failed/read nothing, or it is surer AND reads ≥ 60% as
  many words; otherwise PaddleOCR's reading stays. Tesseract unavailable
  (offline build) → PaddleOCR kept; crash + no Tesseract → page fails
  visibly. Sidecar: per-page `engine`, info flag `engine-fallback` with the
  reason, `chain` [paddle, tesseract.js], backend "… · Tesseract.js 5 on
  page(s) N (PaddleOCR failed or was unsure there)". A confident page is
  unchanged (Tesseract never loaded).
- Verified in Chromium on a 3-year scan: normal (no fallback), forced unsure
  (Tesseract 96% < Paddle 99% → Paddle kept), forced crash (Tesseract read
  both pages, 2023 booked). `test:ocrbrowser` +6 (29), e2e-ocr-browser 89/89.
- Investigation same day: 3-year statements — OCR reads every year and
  amount correctly; the year the preparer sets controls the column. The
  gluing of tight columns and the Andrew Ban gaps are fixed in (8).

2026-09-30 (18) Jacob Kelt / SHORI CORPORATION. QuickBooks P&L + BS printed as
"Power Real Group, LLC"; 2023 US return with ONE 5471 (SHORI CORPORATION,
SHORI01). Harness `$SP/kelt2.mjs` (MODE none | confirm | diff; accepts the
re-process dialog). Gaps 1-3 FIXED in both trees, NOT committed:
- `booksNameAlias` (dist `EN9booksAlias`, `EN9BOOKSALIAS`): one named 5471 in
  the prior return(s) + exactly one other company name on the current papers
  (none naming the CFC itself, no other entity owning either name, preparer
  did not answer "different") = the same company's books/trading name. The
  page scope counts both names as this entity's (`namesOf`, entry `names`;
  dist `EN9ALIASSCOPE`), so no page is held back; warn `entity-books-name`.
- The prior return is used PROVISIONALLY in that case (currency USD, Belize,
  SHORI01, opening balances, holders; `EN9BOOKSPROV`) and `nameMismatch`
  stays set until answered (`EN9BOOKSASK`) → `cf-name-unconfirmed` blocks
  generation. Without it the statements alone gave currency PHP from the
  account "1024 Paypal PHP".
- Fan-out: the block waiting for the name answer is not an additional 5471
  (`pendingBlock`, dist `EN9pend`/`EN9PENDBLOCK`) → no duplicate entity.
- `confirmLegalName(same)` stores `Entity.nameAliases` (dist `EN9ALIASKEEP`);
  "different" clears what the prior return supplied (detected values still
  unchanged, holders, categories, card name; `EN9DIFFCLEAR`). Agent case
  context/risks and insights read the aliases (`EN9ALIASHINT/CTX/RISK`).
- Result: first run = 1 entity "SHORI CORPORATION", 30 lines, all Sch C/F
  figures, opening balances, only blocker the name question; confirm → no
  blocker. "Different company" → Power Real WP + separate SHORI entity.
  Other 10 clients identical (lines, contributions, unmatched, writes, review
  items). Suite 75: 74 pass (`test:peg` as at HEAD); new `test:booksname` (6);
  e2e 45/45, 89/89.
- Kelt gaps 5-16 (second pass, both trees, NOT committed):
  - FX: plain "exchange gain/loss" → IS:19 (8a; Sch I-1 subtracts 8a); only
    "realised/realized exchange" → 8b. Catalogue v14 (move 13 → IS:19;
    dist `EN9RULEV14MOVE`). Martinez FX -81.37 moves 8b → 8a.
  - Statement sub-groups: `tagStatementGroups` (sections.ts; dist
    `EN9tagGroups`, `EN9GROUPS`, call `EN9GROUPCALL`) tags accounts with the
    innermost group a proven total closes (not section banners, not outer
    groups); `resolvePool(…, group)` gives a group one row, captioned with
    the group from its 2nd account (dist `EN9POOLGROUP`). Zero-value rows
    take no pool row (`EN9POOLZERO`). Kelt: "Credit Cards", 6790/7300
    groups; 2Hats: "Office costs" 132.12 as its reviewer.
  - Opening split: prior attached statement lines kept (`statementCaptions
    .lines`, dist `EN9STMTLINES`) and each opens on the row with the same
    words (`EN9BOYSPLIT`, vars EN9bs*). Kelt 11,410 / 51,481; HMC OCL split.
  - PTEP: `readPriorPtep` (carryForward.ts; dist `EN9readPtep`) reads prior
    Sch J line 14 columns (b)-(d) and (e)(i)-(x) (headings glued in one cell
    placed by width; amounts by right edge; glued figures split) → Sch J
    row 15 H/J/L, N..AF, info `cf-opening-ptep`. Matches reviewed WPs: Kelt
    AB15 9,321; HMC X15 -2,416; TEZ H15 -16,680,312.
  - USD rounding: `usdRoundingGaps` (src validate; dist `EN9usdRound` in the
    tie-out) warns `usd-rounding-eoy/boy` with the RE fix; template row 64
    still shows it (reference hides it by rounding its total).
  - One rate (USD or 3 equal rates): `re-equity-movement` (F25) replaces
    `re-translation-adjustment`; sign-off writes F25 (`EN9EQMOVE*`).
  - Categories written "X" (`EN9CATX`); Sch Q C57 = books name when the
    entity has one (`EN9SCHQBOOKS`).
  - Lesson: dist `var`s are function-scoped — a loop named EN9q overwrote
    the questionnaire var and froze processing; new dist names are unique.
  - Left, reviewers disagree: line 16 vs 19 (prior return filed 16), Sch E
    nil row (2Hats fills, others blank; template formulas stay), category
    5a, C36, address split, date format, "4000 Cost of goods sold" row,
    accounting+legal merged by the reviewer. Also open: "different company"
    answer sniffs PHP from "Paypal PHP".
- Tests: new `test:keltr18` (9); suite 76: 75 pass (`test:peg` as at HEAD);
  e2e 45/45, 89/89. Live A/B: only the intended changes above.

2026-09-29 (17) Full regression of rounds (6)-(16), then its gaps fixed. Both
trees, NOT committed. Live UI flow on 10 clients / 13 entities
(`$SP/reg2.mjs` waits for EVERY entity; the old harness waited for the first
only, so a fan-out sibling read 0 lines — a harness artefact, not a defect).
- Regression fixed: `missingDocuments` said "a balance sheet was found … could
  not be read" from a balance sheet inside the prior-year U.S. return
  (Santmyer) or a sister company's statements (DELINK). `seen` now counts only
  this entity's current statements (not prior-year-us-return, not a document
  naming another company). dist = EN9INSIGHTS rebuilt.
- Catalogue v13 (dist `EN9RULEVER=13`, `EN9RULEV13`, `EN9RULEV13MOVE`):
  short-term debt/loans/borrowings → BS:OL (line 19) like every other
  borrowing (Macroroots' filed return: line 16 blank, line 19 = the debt);
  taxes payable stay BS:OCL; v12 catalogues get a MOVE. Section route under a
  non-current heading no longer forces "short-term" to OCL — only "current
  portion" (`EN9SHORTTERM`). New group "deudores diversos / deudores varios /
  otros deudores / sundry debtors" → BS:OCA (not trade receivables; "trade and
  other debtors" unchanged).
- Prior Sch F parser: "20 Capital stock: a Preferred stock" (heading + first
  sub-line in one row) is line 20a (`EN9SUBLINE`, both matchers). Capital
  printed without a class keeps the prior return's class: prior 20a > 0 and
  20b blank → BS:59 moves to BS:58 unless the caption names a class, the
  preparer assigned it, or 20a is already filled (`capitalClassFromPrior`,
  dist `EN9CAPCLASSFN`/`EN9CAPCLASS`, info `capital-class-prior`).
- Result: Macroroots IS+BS = reviewed WP (ALL MATCH); EL KIJ other current
  assets = reviewed WP. Every other client identical (lines, contributions,
  unmatched, writes). Suite 74: 73 pass, `test:peg` as at HEAD; new
  `test:r17` (8); `test:multiyear` updated; e2e 45/45, 89/89.
- Left, NOT changed (existing catalogue rules or reviewer disagreement; owner
  decision): "gastos financieros"/interest → line 13 (EL KIJ/TEZ/2Hats WPs use
  17, Joyce/HMC use 13); FX loss on 8a (2Hats WP: 17); taxes/social-security
  payable OCL (Wiener/2Hats WPs: AP; Andrew/Joyce/HMC: OCL); TEZ advances to
  suppliers, prepaid taxes; HMC staff wages split; C36 "10% corporate
  shareholder" (no formula uses it; reviewed WPs answer Yes and No for the
  same ownership pattern).

2026-09-29 (16) 2Hats / William Phillippe feedback (fixture 2hats_rows.json = the
real annual accounts' rows). Both trees, NOT committed.
- "Short-term liabilities 27.032,10" is a liabilities banner (was not → the
  equity banner ran on and every creditor went to retained earnings).
- Cash group headings printed with totals ("Liquid assets", "Checking
  accounts", "Saving accounts") open the cash section (`CASH_GROUP`, dist
  `EN9CASHGRP` + tagSections branch) → both IBAN accounts to cash 28,447.17.
- deductionMagnitudeFlip only when the row's parent total is not positive
  (`parentTotalSign`, dist `EN9parentSign`/`EN9DEDPARENT`): "40990 Other
  personnel costs -9,37" under "Other personnel costs 2.390,63" keeps its sign
  → compensation 186,640.63 = the reviewed WP.
- Result: BS balances 29,641.42; RE -1,890.68; common stock 4,500 once;
  9a 1,449.37 / 9b -1,390.12. Placement differs from the reviewed WP only
  inside liabilities (tool: creditors 259.24 → AP, NSSO 6,087 → OCL, director
  current account 5,568.69 → line 18; WP: NSSO → AP, the rest OCL).
- Banner count 49 (`test:sections`); `test:veillon` 16. Suite 72/73 (peg as at
  HEAD), e2e 45/45 + 89/89, A/B other clients identical.

2026-09-29 (15) AI-agent review priorities (owner: "fix all priorities"). Both
trees, NOT committed. Rules decide; the wording is the agent's style; no
figure is changed by any of it.
- New pure module `insights.ts` (dist: the same module compiled by esbuild
  into `/*EN9INSIGHTS-BEGIN/END*/`, global `EN9INS`; rebuild with
  `$SP/rebuild_ins.py`). Called from `validateEntity` (dist `w8`,
  `EN9INSCALL`) and, for the two summaries, from `allReviewItems` (dist
  `gn`, `EN9INSSUM`, shown FIRST in the Exception Center). Each check runs in
  its own try; all items are warn/info, never block.
  - `missingDocuments`: doc-missing-balance-sheet / -pnl / -prior-return /
    -ownership, each naming the schedule it blocks ("Balance Sheet is
    required because Schedule F …").
  - `ocrSummary`: ocr-summary-<file> (overall, tables, figures, per page,
    figures < 90%) and ocr-page-low-<file>-p<n> for pages < 85%.
  - `documentDiagnosis`: doc-diagnosis-<file> for a statement document that
    booked nothing — why (no text / low OCR / tax return / wrong year /
    captions unmatched / unidentified), next step, document needed. Skips
    documents naming another company.
  - `calculationExplanation`: calc-explain (gross profit → net income, tied
    to the statement's own result; reads src `value` or dist `values/years`).
  - `ownershipExplanation`: ownership-basis (sources of %, CFC, 10% corp).
  - `memorySuggestions`: memory-doctype-<file>, memory-fx-<CCY> from
    localStorage `en9ChoiceMemory` (recorded by setDocKind and by typing the
    average rate; dist `EN9MEMDOC`, `EN9MEMFX`). Suggestions only.
  - `summarizeReview`: review-priorities (top 5 by block/category/amount)
    and reconciliation-summary (✓/✗ per cross-document check).
- Duplicates: a caption+figure already booked to the same line from ANOTHER
  document (current-year fields) is not booked again; warn dup-doc-<line>-<cap>
  (src; dist `EN9DUPDOC`). The existing document-level dedupe (value
  fingerprint ≥80% / containment ≥90%) already drops whole duplicate files in
  any format; this catches partial overlaps (tested live: an extract repeating
  "Services 312,687" keeps IS:7 at 366,772).
- Translation: `bilingualLabel` ("English (original: …)") on the Provenance
  source caption, the attached-schedules sheet, the "Caption remapped" log
  and the Mapping screen (dist `EN9BILABEL`). Shared translation memory in
  localStorage `en9TermMemory`: every stored translation is remembered
  (updateEntity / dist `rt`, `EN9TERMMEM`) and reused before mapping
  (`termsFromMemory`, dist `EN9TERMREUSE`).
- Kept: a manual assignment still also learns a global keyword rule (existing
  behaviour; turning it into a suggestion is the owner's call).
- Tests: new `test:insights` (10). Suite 73: 72 pass, `test:peg` as at HEAD;
  e2e 45/45, 89/89. A/B all clients: lines, contributions, unmatched, writes
  identical. Veillon live: ocr-summary 95% overall / tables 97% / figures 98%,
  calc-explain ties to "GANANCIA O (PERDIDA) NETA DEL PERIODO" -621.

2026-09-29 (14) Veillon / Pacific Malibu Properties (Panama, Spanish, scanned).
Both trees, NOT committed. First pass on a stand-in rebuilt from the tool WP's
Provenance (`$SP/veillon/gen.mjs`); then verified live on the real PDFs.
- Defect: pages 6 (cash flow), 8 (notes) and 9 (ID card) inherited the balance
  sheet page kind and its sticky equity banner → 14 rows (cash-flow lines, the
  note's "Descripción 2024", note Total 621, ID digits) booked to RE = 3,357;
  P&L (Anualidad de Agente Residente 321, Tasa Única 300) not booked.
- Sections (`tagSections`, dist `EN9SECRESET`): section resets at every new
  page and at a cash-flow / notes title (`SECTION_RESETS`, dist
  `EN9SECTRESET`), EXCEPT a page that repeats the previous page's statement
  title (a banner-matching furniture row): `dropFurniture` marks its first row
  `continuesSection` (dist `EN9CONTTITLE`). A strict reset broke HMC page 7
  (Team Building etc. → Review); the title rule keeps it.
- Spanish P&L banners: Estado de Resultados / Ingresos → income, Costo(s) de
  Venta(s) → cogs, Gastos (+ generales/administrativos/…) → costs (dist
  `EN9ESPNL`); banner count 44 → 48. Side banners accept plurals ("Activos no
  Corrientes").
- Page kinds (`nonStatementKind`, dist `EN9NONSTMT`): `fs-cashflow` (title in
  the first six figure-less rows, no BS/P&L title there), `fs-notes`
  ("Notas a los estados financieros", bare "Notas"), `non-financial` (ID card:
  identity word + birth/issue/expiry date). Signature page after a statement
  → `non-financial` instead of inheriting it (`EN9SIGNPAGE`). Feeds:
  non-financial none, fs-cashflow profile, for every document kind.
- Column-header year row ("Descripción 2024": header word + only years
  1990-2100) dropped as furniture (`isYearHeaderRow`, dist `EN9YEARHDR`).
- `sameIndentSubtotals` tests single-column rows too when the caption is a
  total word (note "Total 621" = 321 + 300; dist `EN9NOTETOTAL`).
- Booking: the P&L's own result line with no rule ("Pérdida del Periodo") is
  SKIP, never an expense (`EN9RESULTSKIP`); a BS:46 payable naming
  accionistas/socios/shareholders/related parties → BS:52 (`EN9SHLOAN`).
- Stand-in result = corrected WP: IS 321 + 300 (line 17), BS 9a 175,000,
  line 18 175,621, RE -621 (corrected WP shows it on its extra "CY net income"
  row). Pages 6/7/8/9 book nothing. A/B (HMC, Rise, Wiener ×2, Santmyer ×2,
  Romy, Joyce, 2Hats, Martinez, Andrew Ban): identical.
- Tests: new `test:veillon` (9); `test:sections` banner count 48;
  `test:spanish` finds the figure row (banner rows now kept). Suite 72: 71
  pass, `test:peg` as at HEAD; e2e-agent 45/45, e2e-ocr-browser 89/89.
- Real PDFs received (scanned, PaddleOCR). Live run found 4 more gaps, fixed
  in both trees:
  - OCR drops spaces in bold capitals ("TOTAL DEACTIVOS", "PASIVOSNO
    CORRIENTES", "GANANCIAO (PERDIDA)ANTES DEIMPUESTOS"). `deglue()`
    (sectionBanners.ts, dist `EN9DEGLUE`) splits a word only when every piece
    is a known statement word ("no"/"mas" only before corrientes/patrimonio);
    used for MATCHING in `bannerKey` (dist `EN9bk`), `matchRuleScoped` (dist
    `Tv`) and `isProfitLine`; the stored caption is unchanged.
  - "Notas" column: note refs under it are not amounts (`NOTES_HEAD`, dist
    `EN9NOTESH`).
  - Spanish running results (GANANCIA O (PÉRDIDA) BRUTA / OPERATIVA / ANTES DE
    IMPUESTOS / NETA) are SKIP when no rule matched (`isResultSubtotal`, dist
    `EN9RESULTSUB`); PROFIT_LINE knows "ganancia o (pérdida) neta del periodo".
  - "Índice" contents page (page numbers were booked as gross receipts) →
    fs-cover (`CONTENTS_TITLE`, dist `EN9CONTENTS`), also when OCR joins
    "Pages" onto the heading.
- Live real result = corrected WP: IS line 17 G&A 621; BS EOY 9a 175,000,
  line 18 175,621, RE -621; BOY (prior return) 173,000 / 163,650 / 10,000 /
  -650. Pages 2, 6, 7, 8, 9 book nothing. Left: C36 "10% corporate
  shareholder" No (holders are individuals) vs WP Yes; "Estado de Cambios en
  el Patrimonio" reads as a balance-sheet page (its rows go to Review only).
- Veillon feedback round (same day): country of incorporation is read from
  the cell under the item 1c caption (first row below, never a caption
  fragment; the old last-word rule is the fallback), source "5471 item 1c"
  (`EN9COUNTRYCOL`). A first version read two rows down and gave Rise
  "h Functional currency code" — caught by A/B, fixed. Spanish dated balance
  rows ("Balance/Saldo al 1 de enero de …", "saldo inicial/final") count for
  movement pages (`EN9DATEDES`); the Veillon equity page still shows 2 rows in
  Review because its opening row prints no figure. C36 left as is: the
  reviewed WPs disagree (individual holders → Yes for Macroroots/Veillon,
  No for Barnomadics), no rule fits all.
- `test:veillon` 15; `test:detect` snapshot chunk 4 (EN9NOTESH) re-synced;
  `test:feedback10` loads EN9DEGLUE. The `.cache/pdfjs-3.11.174` harness cache
  was re-fetched from npm (gitignored).

2026-09-29 (13) Andrew Ban feedback gaps (book2 rows 76-84). Both trees, NOT
committed.
- Ownership: item C is lowered to the Part I U.S. total (rule from (6)/(11))
  only while the filer's own Part I stake is >= 10%. Below 10% the filer is a
  filer only through attributed stock, so item C stays as filed and
  `cf-own-pct` warns with the 958(b)(1) caveat (dist `EN9KEEPITEMC`). CFC =
  Yes also when item C (as kept) > 50 (`EN9icc`). Andrew 100/Yes (matches the
  reviewed WP); Joyce 40/No and Charlie Brawn 20/No unchanged.
- Equity dividend line: `equityDividendLine().addsToEquity` (sum of printed
  values > 0; dist `EN9DIVSIGN`). Printed POSITIVE (Andrew "Dividend Payouts"
  43,478 adds to equity) → Dividends tab + RE only; Schedule R keeps the
  prior NONE row, Sch J F33 and Sch M are not written (`EN9fromEq`,
  `EN9EQNOSCH`). Printed NEGATIVE (Martinez "Dividend disbursed" -100,000) →
  paid: Dividends tab, Sch R, Sch J, Sch M as before, with its own
  `dividend-from-equity-line` warning (`EN9DIVPAID`).
- Schedule E tax branch: O16 = |IS:62| and E57 (E-1 line 4) = same, warn
  `sch-e-current-tax` (was a zero-placeholder block). M16 is a template
  formula. HMC now gets 179 (FY2025 column; 5,235 with WP year 2024, = its
  reviewed WP).
- Provenance: new last column "Where it was read" — page or spreadsheet, row
  caption, year column, and every year the row prints (`EN9WHERE`,
  `EN9whereCol`).
- Average rate chain: IRS → OFX → ECB → currency-api public market mid-rates
  (1st and 15th of each month via jsdelivr, then pages.dev; ≥12 dates;
  `fxCurrencyApiAverage`, dist `EN9CAPIAVG`/`EN9CAPICHAIN`, tag "Market") →
  estimate offer. Andrew with real 2024 npm data (19 dates from 03/15): 4.600619.
  The reviewed WP's 4.788045 is close to the 12/31 spot, not an average.
- Remaining vs reviewed WP: C36 "10% corporate shareholder" No (both holders
  are individuals) vs WP Yes; Sch M line 19 112,680 (related-party
  compensation, not in the statements).
- Tests: `test:andrewban` 7; `test:p5` expects the new Sch R NONE condition.
  Suite 71: 70 pass, `test:peg` fails as at HEAD. e2e-agent 45/45,
  e2e-ocr-browser 89/89. A/B vs round 12 (HMC, Rise, Wiener ×2, Santmyer ×2,
  Romy, Joyce, 2Hats, Martinez): lines, contributions, ownership, dividends
  identical; only Sch E O16/E57 now filled for HMC (179) and Barnomadics
  (23,813 — book2 row 56 asked for it).

2026-09-28 (12) Andrew Ban live (real xlsx names + 2023US). Both trees, NOT
committed.
- C59 average: IRS table has no RON; OFX does not carry it. Chain is now IRS
  → OFX → ECB daily average (`fxFrankfurterAverage`, frankfurter.dev time
  series, ≥40 points; dist `EN9ecbAvg`/`EN9AVGCHAIN`) → nothing: an ESTIMATE
  (mean of prior/current Treasury year-end) is stored on
  `fxMeta.avgRateNote.estimate` and offered as `suggestedValue` on the
  `fx-avg-missing` blocker — never written (dist `EN9AVGEST`, `EN9ESTOFFER`).
  Stored on the note, not a review item: processing overwrites reviewItems.
- Work paper year: `deriveCaseYears` also uses a prior return with no period
  end read yet (face period is read later) when nothing else states a year
  (dist `EN9PRIORONLY`); before `materializeCaseWrites` the year is resolved
  again if still unknown (dist `EN9CYAGAIN`). Andrew Ban's step 1 said "not
  established", so schedules were built with no year and the dividend skipped.
- Dividend line inside equity ("Dividend Payouts") → the year's distribution
  (`equityDividendLine`, dist `EN9eqDivLine`/`EN9DIVEQ`): Dividends tab,
  Sch R, Sch J F33; `dividend-from-equity-line` warns (and the filer's share
  when < 100%). Sch F keeps the statement as printed.
- RE roll-forward: distributions use the planned dividend; new local check
  `re-books-not-rolling` (opening + NI − dividends ≠ closing in functional
  currency) and then NO translation-adjustment offer (dist `EN9BOOKSROLL`).
  `re-opening-mismatch` is now info: E&P vs book RE differ by nature.
- "Other revenues/sales" in the income section (feed ≠ bs) → IS:7 (dist
  `EN9OTHERREV`).
- Period: agent facts pick this year's accounts, not the prior return
  (dist `EN9STMTDOC`); agent period findings skipped when those accounts
  confirm the period (`EN9PERIODOK`); stmtPeriod accepts trial-balance grids
  (`EN9TBPERIOD`), so no false `period-end-assumed`.
- The early `entity-name-differs` warning is skipped while the entity still
  has its default "Entity N" name and a prior return is present — the
  existing name sync renames it to the legal name later (dist `EN9AUTONAME`;
  an auto-rename was tried and dropped: it pre-empted HMC's legal-name case).
  Kind label "Trial balance / statement spreadsheet".
- `re-books-not-rolling` uses only an opening RE READ from the statements'
  own prior-year column (BS:61 boy contributions); an opening carried from
  the prior return keeps the translation comparison (Rise unchanged).
- Result: MACROROOTS…, 12/31/24; IS:7 366,772 (= Total net sales); dividend
  43,478 recorded; ECB mocked → C59 4.5895 (261 points); offline → estimate
  4.639 offered. Remaining blockers are the preparer's: confirm RON, answer
  officer/director.
- Tests: new `test:andrewban` (5). Full suite 72: 71 pass, `test:peg` fails as
  at HEAD. e2e-agent 45/45, e2e-ocr-browser 89/89. A/B (9 entities, 2Hats,
  Martinez, Romy real): every line, contribution identical. Differences:
  Rise loses a false agent period note (its 2024 statements state the
  period); Romy (no-OCR impact run) now knows its year → days owned 366,
  transition No, and a true `period-end-assumed`.

2026-09-28 (11) Martinez real files received (2023 return, DFRNT BS, P&L).
Both trees, NOT committed.
- 5471 face items d-g printed as ONE cell ("10/25/23 UNITED ARAB EMIRATE code
  no. 512100 DESIGN & VIDEO PR"): place, code and activity now parsed from
  it (carryForward, dist `EN9ACTGLUED`). PBA and principal place now filled.
- Banner "Other Income(Loss)" (bracketed) → otherIncome: "Other operating
  income (expenses) 2,763.40" was booked as a cost (swing 5,526.80).
- `numericCell` reads an ISO-currency-prefixed amount ("AED -47,183.90",
  "AED2,424,658.93"; grouped/decimal only, "USD 5" stays text; dist
  `EN9curCell`/`EN9CURCELL`).
- `Entity.statedResults`: the P&L's own bottom line (last isProfitLine row per
  P&L doc, not pre-tax), captured in a pre-pass before booking because
  structure drops remove it (dist `EN9STATEDPRE`, saved `EN9SRSAVE`).
  `pnlTieOut` prefers it over the BS equity line; new `resultsDisagree` →
  `pnl-bs-result-differ` (Martinez: P&L NET EARNINGS -47,183.90 vs BS Net
  Income -36,033.71, 11,150.19 apart — the client's reports disagree).
- Martinez now: Schedule C -47,185.64 = P&L within tolerance (1.74 = the
  -0.87 Discount Allowed made positive by dist step 4, pre-existing).
- Tests: `test:feedback10` 9; detect snapshot chunk 1 re-extracted. Full suite 70:
  69 pass, `test:peg` fails as at HEAD. e2e-agent 45/45, e2e-ocr-browser 89/89.
  A/B (9 entities, Andrew Ban, 2Hats): lines, contributions, ownership identical.

2026-09-28 (10) Martinez (DFRNT, QuickBooks) + Romy Cuadras feedback — the
partially fixed gaps (owner: "fix, use logic and agent"; NOT committed). Both
trees. Martinez source PDFs are NOT in the sandbox: a stand-in rebuilt from
his WP's Provenance (`$SP/martinez/gen.mjs`) reproduced every gap.
- Sections: a figure-carrying "Total Bank Accounts" closes the cash group
  (next rows → assets); "Total Fixed Assets"/"Total … Liabilities" close their
  narrow group too (`CLOSES_TO`; dist `EN9TOTCLOSE`). Banners: "Other Current
  Assets", "Accounts Receivable" (dist `EN9ARBANNER`; lexicon now 44).
  Martinez A/R, inventory, prepaid no longer booked as cash.
- Equity result: `PROFIT_LINE` adds bénéfice/perte/résultat de l'exercice,
  Jahresgewinn/-verlust/-überschuss/-fehlbetrag/-ergebnis, utile/perdita
  dell'esercizio (dist `EN9PROFITFR`); `isProfitLine` exported. Romy's RE
  missed "Bénéfice de l'exercice" (-9,303.78) when read with the apostrophe.
- Terms: "petit materiel …" → small material (IS:OD); squeeze folds rn→m
  (OCR "foumitures"); doubled final e ("comptabilitée") retried (dist
  `EN9DOUBLEE`).
- AI veto `statementSideVeto` (dist `EN9sideVeto`, both AI paths): a caption
  read on an income-statement page can't go to Sch F and vice versa (Romy's
  "Petit matériel" → inventories).
- Tax sign by result: negative IS:62 flipped only when the flip makes
  Schedule C equal the stated result exactly (`tax-sign-by-result`; dist
  `EN9TAXBYRESULT`, which mirrors dist-only step-4 negative-deduction abs).
- Checks (validateEntity, both trees): `pnl-net-income-tie` (booked NI vs
  BS:61 "Net Income"/"Bénéfice…" contributions, names unassigned P&L rows of
  that amount; `pnlTieOut`), `basic-activity-missing`, `category-5-expected`,
  `category-4-expected`, `category-3-carried`; CFC warn now at ≤50% filer.
- Filer → U.S. Shareholders rows 7-14 when no Sch B Part I and the filer is a
  direct holder (`us-holder-filer`; dist `EN9USFILER`; excluded from the
  Part I pro-rata note).
- PBA: face item f/g "512110 MOTION PICTURE…" in one cell, or words under
  the code caption, now read (dist `EN9ACTIVITY`); code only → NAICS
  description (`naicsDescription`, dist `EN9NAICS`, labelled "confirm").
- Results: Romy real inputs — every P&L line booked, tax 84.80, Schedule C =
  stated -9,303.78, Sch F balances 26,027.29 / 35,378.04. Martinez stand-in —
  cash 285,588.12, A/R 422,111.77, prepaid 23,346.15 on line 6; US block row 7
  WILLIAM MARTINEZ 25,000/25,000; with the P&L line missing, the tie check
  reports exactly the WP's 16,678.73. `__EN9MAP.EN9validate` exposed for tests.
- Tests: new `test:feedback10` (8); `test_sections` lexicon 44. Full suite 70:
  69 pass, `test:peg` fails as at HEAD. e2e-agent 45/45, e2e-ocr-browser 89/89.
  A/B HMC, Rise, Wiener ×2, Santmyer ×2, Romy, Joyce, Andrew Ban, 2Hats: lines,
  contributions and ownership identical (DELINK gains the us-holder-filer note).

2026-09-28 (9) Work paper year as the single source (owner request; NOT
committed). Both trees. Builds on "The work paper year controls the run"
(2026-09-22: `resolveCaseYears` = typed year wins, documents vote otherwise).
- Year anchors added (`YEAR_ANCHORS`, dist `EN9YEARANCH`): "Balance sheet as
  of 2024", "Results until end of 2024", and the END year of a numeric range
  "01/01/2024 - 31/12/2024". 2Hats Consulting 2024 accounts had no year at all
  (activity card: Identified —, Unclear, Unknown) — now 2024, period
  01/01/2024–12/31/2024.
- `detectStatementPeriod` reads numeric ranges (`numericRange`, dist
  `EN9NUMRANGE`/`EN9numericRange`): day/month order only from a part > 12,
  otherwise not read; valid dates, start ≤ end. The first page counts when it
  is `unknown` and later pages are `fs-*` (a statement set's cover).
- `deriveCaseYears`: no statement year but a calendar prior return → cy =
  prior + 1 (dist `EN9PRIORONLY`); reason text names statements only when
  there is dissent.
- Agent year check: a prior return with NO work paper year shows "Unclear",
  not "Mismatch" (dist `EN9NOYEARPRIOR`).
- Year change after a run (store `setField`, dist `EN9YEARCLEAR`): clears
  lines, contributions, sourceLabels, unmatched, extraWrites, dividends (and
  auto FX), sets `yearStale`, and re-processes the entity 1.5 s after the
  last edit (`yearRerun` debounce; dist `window.__EN9YR`). Documents, profile,
  overrides and sign-offs kept.
- "Unknown → 0 figures": already a BLOCK review item with the reason when an
  unidentified document carries figures, and its rows go to Review
  unassigned (2026-09-23). The 2Hats case was a missing year, not a missing
  identification; fixed above.
- Results: 2Hats rebuilt PDF, no year entered → WP 2024, same 16 lines, no
  `period-end-assumed`. Andrew Ban auto (2024) and WP 2023 identical to (8);
  process at 2023 then switch to 2024 → cleared at once, re-read, equal to a
  fresh 2024 run. A/B HMC, Rise, Wiener ×2, Santmyer ×2, Romy, Joyce:
  lines, contributions, ownership and profile identical. Wendorf and Kelt
  source files are not in the sandbox — covered only by their existing tests.
- Tests: `test:multiyear` 16 (+5). Full suite 69: 68 pass, `test:peg` fails
  as at HEAD. e2e-agent 45/45, e2e-ocr-browser 89/89.

2026-09-28 (8) Multi-year statements + Andrew Ban / Macroroots (owner said
"fix all gaps"; NOT committed). Both trees; catalogue v12.
- Glued figures: two COMPLETE amounts (grouped thousands or cents, engine
  `COMPLETE_AMOUNT`) are never one cell/number — pdfText cell grouping
  (`TWO_FIGURES`; dist `EN9TWOFIGCELL`), `numericCell` returns null for a
  cell holding two (dist `EN9TWOFIG`), layer `en9OcrRuns` never joins two
  (`EN9OCRFIG`). "1 234 567" / "12 345,67" still read.
- Grids: `extractRows(grid, {banners:true})` emits value-less heading rows
  ("Revenues:"), store runs `tagSections` on the grid feed (dist `EN9GRIDBANNER`,
  `EN9GRIDSECT`). `bannerKey` strips a trailing colon everywhere banners are
  tested (dist `EN9bk`); banners gain "revenues", "shareholder's equity".
  Line-number heuristic never drops a value under a year heading (dist
  `EN9YEARCOLNUM`: AP 2022 97, wages 2022 153).
- A VALUED row matching the "cash" banner tags itself only (dist `EN9CASHOWN`):
  "Cash and cash equivalents 65,029" had made receivables cash.
  Spreadsheets use `tagSections(rows, {headingsOnly:true})`: only value-less
  heading rows open a section (a title row "Income statement, 2024" had put
  every unknown caption in gross receipts — caught by `test:e2e-agent`).
- Routes: liabilities "…tax…" → BS:OCL before payable (`EN9TAXOCL`);
  termLiabilities "short-term"/"current portion" → BS:OCL (`EN9SHORTTERM`).
  Rules v12: IS:OD "other expenses"; BS:OCL short-term debt/loans/borrowings,
  taxes payable; BS:OL long-term debt/loans/borrowings.
- "Taxes"/"Income tax(es)"/"Taxation" directly after an operating-result /
  before-tax line books IS:62 (store `PROFIT_BEFORE_TAX`, dist `EN9TAXAFTER`).
- Year: `deriveCaseYears` — a prior-year return with a 12/31 period end and
  statements ≥ 2 years newer → cy = prior + 1 (`afterPrior`, reason text says
  so); fiscal years untouched (dist `EN9AFTERPRIOR`). Grid docs get
  `statementPeriodEnd` from "December 31," over the newest year
  (`gridPeriodEnd`, dist `EN9GRIDPERIOD`); the agent brief uses its year
  (`EN9GRIDYEAR`); cf-seed-only counts trial-balance docs (`EN9TBSEED`).
- Ownership rule from (6) now needs Part II evidence: item C is lowered only
  when non-U.S. Part II holders own the difference (`EN9NONUS`). (Andrew's
  5% → see (13): kept at 100 now.)
- Results: Andrew Ban 19 lines, 0 unmatched (WP 2023 and 2024); WP 2023 IS
  equals the filed 2023 Sch C (258,728 / 10,859 / 58,515 / 36,467 / 58,326 /
  2,352); OCL 12,251 + 262,997; RE opens 66,715. Tight 3-year scan and
  digital: 2023 column booked correctly. A/B HMC, Rise, Wiener ×2, Santmyer ×2,
  Romy, Joyce: every line, contribution and ownership identical.
- Tests: new `test:multiyear` (11); integrity +EN9GRIDPERIOD; detect snapshot
  chunks 1 and 5 re-extracted. Full suite 69: 68 pass, `test:peg` fails as at
  HEAD. e2e-ocr-browser 89/89, e2e-agent 45/45.

2026-09-28 (6) Joyce Langan / Barnomadics Ltd — UK (Companies Act) accounts
(owner asked "fix all these gaps"; NOT committed). Both trees; catalogue v11.
- Year header: `detectRulers` ignores a "Notes" cell (remembered as
  `ruler.notes`) and a company registration number on a line that names it
  ("Company No. SC240721"); `extractPositionedRows` drops small whole numbers
  under the Notes column (note refs). dist `EN9NOTESHDR`, `EN9NOTECOL`.
- Sections: banners "Capital and reserves" (equity), "Provisions for
  liabilities" (liabilities). `SELF_SECTION_ROWS`: a figure-bearing
  "Creditors: … within one year" / "… after more than one year" sets
  liabilities / termLiabilities for itself and below. "Profit and loss
  account" WITH figures is the reserve, not the P&L title banner. dist
  `EN9UKBANNERS`, `EN9SELFSEC`.
- Summary + detailed P&L: pages titled "Detailed Profit and Loss Account"
  (first 4 lines) are set aside when ≥ max(3, half) of the face P&L's rows
  reappear on them with identical CY+PY pairs (`supplementaryDetailPages`,
  dist `EN9DETAILPNL`). The face is booked (as the manual paper does).
- "Cost of sales" is SKIP (a total) — except a collapsed banner row that is
  the FIRST figure of its section (`collapsedLead`); then it takes the
  section route (IS:12). dist `EN9COLLLEAD`, `EN9COSLEAD`.
- Rules v11: SKIP UK subtotals (profit for the financial year, total
  comprehensive income, net current assets, total assets less current
  liabilities, …); IS:15 "interest receivable"; IS:29 "interest payable";
  IS:OI "other operating income"; IS:62 "taxation" (BS keeps BS:OCL via the
  sheet-scoped scan); new IS:OD group distribution/selling/administrative
  expenses; BS:14 "stocks". `upgradeRules` now treats a keyword as known per
  LINE (`knownOn`), so "taxation" already on BS:OCL does not block IS:62.
  dist `EN9KNOWNON`; rules array regenerated from src (EN9FEEOD kept).
- Brackets as presentation: per document, cost-line figures (IS:10-12,
  26-50, OD) all printed negative (≥2, none positive) → COGS, deductions and
  tax (IS:62/63) booked positive; creditors (BS:44-56, OCL, OL) all negative
  (≥2) → liabilities positive (eoy+boy). Removes the tax-sign warning; one
  info item `bracket-convention-<doc>`. dist `EN9SIGNTALLY`, `EN9BRACKETS`.
- Fixed assets: `movementFixedAssetSplit` reads the UK movement note (classes
  across; Cost / Depreciation / Net book values blocks; Total column last);
  returns only when cost − dep = NBV in both years; tangible title required.
  dist `EN9MOVEFA`.
- Opening balances: when the statements' prior-year column already opened
  ≥3 BS lines, the prior return's closing balances are NOT added (they only
  cross-check, cf-boy-*); a multi-row group the statements opened is never
  topped up. dist `EN9STMTOPEN`.
- Equity statement: dated balance rows ("At 1 December 2023", ≥2 distinct)
  mark a movement page (dropped from the BS feed); `columnarEquityFacts`
  reads the CY block between the last two dated rows (dividend, profit) when
  the page has no year header. dist `EN9COLEQ`.
- Ownership/CFC: item C is lowered only when it exceeds what ALL Sch B Part I
  U.S. shareholders hold together (non-U.S. relatives are not attributed for
  CFC purposes; a U.S. spouse is): Joyce 90 → 40, HMC stays 51 (25.5+25.5).
  CFC = category 5 checked ? Yes : Part I ≥10% U.S. holders > 50% ? Yes : No
  (no Part I data → Yes as before). CFC No → days left blank. Warn `cf-own-pct`.
  dist `EN9OWNPARTI`, `EN9NOCFCDAYS`.
- Sch M dividends paid = dividend × filer's share (`filerShare`) ÷ avg rate;
  also filled at generation when the avg rate was entered after processing.
  dist `EN9FILERSHARE`, `EN9SCHMLATE`.
- Language: hint words that are English homographs ("charges", "capital")
  count only as whole words beside a foreign word/letter; "loyer", "costi"
  whole words only ("Employer's NIC" read as French). dist `EN9HINTHIT`
  (EN9detLang, EN9srcLang, U8). Agent: a dropped row whose caption the
  catalogue calls SKIP, or a movement-page drop, is not "at risk".
- Result (shipped file, real PDFs): Joyce 19 lines, 0 unmatched; IS and BS
  equal the manual paper line for line (857,408 / 502,806 / 1,726 / 29,891 /
  25,772 / 3,034 / 275,327 / 23,813; BS BOY+EOY incl. 1,139,281/−296,027);
  Basic C33/C34 0.4, CFC No, days blank; Dividends C3 70,000; Sch J F33
  −70,000; Sch R 70,000; Sch M E32 35,760. Differences kept: debtors on
  BS:11 (manual: other current assets), stocks on BS:14 (manual: OCA).
- Impact (A = build before this entry): HMC, Rise, Wiener ×2, Santmyer ×2,
  Romy — every booked line and contribution identical. Unmatched fell only
  for totals/movement pages (HMC shareholder current-account page, Wiener
  SUMA DEL rows). Ownership: Santmyer/Charlie Brawn 60 → 20 and CFC Yes → No
  (Part I lists only Ricardo 20%; mother 40% and Dante 20% are NRA) — the
  same rule as Joyce; confirm with the owner.
- Open: Sch E — manual reports the non-CFC tax in Section 2 "Other" (row 38);
  the tool keeps row 16 (preparer decision). Sch M compensation 24,158.37 in
  the manual has no source in the documents.
- Tests: new `test:ukaccounts` (19); integrity +8 sentinel pairs;
  `test:sections` banner count 41 → 43; `detect_test_src.cjs` chunks 4-5
  re-extracted (e8 with the Notes header, q1 with the note column). Full
  suite 68 scripts: 67 pass, `test:peg` fails exactly as at HEAD (pre-
  existing). `test:e2e-agent` 45/45, `test:e2e-ocr-browser` 89/89.

2026-09-28 (5) French/Swiss statements mapped offline (owner approved after
an impact check; NOT committed):
- `terms.ts CAPTION_TERMS` gains 65 French leaf captions (English chosen so
  each hits an existing rule; checked in `test:frenchterms`). Deliberately
  absent: subtotal captions (Trésorerie, Passifs de régularisation, Autres
  dettes/créances à court terme, Charges et produits financiers) and
  "Bénéfice/Perte de l'exercice" (equity on a balance sheet; its English is
  a skipped total). "capital social" keeps the existing Spanish entry.
- `translateCaption` second look-up: whole caption with spaces/apostrophes
  removed and i/l/1/|// merged (OCR: "Reporta nouveau", "CIC Associe"); keys
  ≥5 chars only; never partial. dist `EN9TERMSQ`.
- The glossary now runs on every statement row (store loop before
  `termTranslations` is written; dist `EN9STMTTERMS`). A raw rule match still
  wins and an entity translation (typed/AI) still overrides.
- `sections.ts sameIndentSubtotals` (dist `EN9SAMEINDSUB`, called after
  structRows): a row is a subtotal when EVERY year column (≥2 columns) equals
  the sum of the row(s) directly above it since the last heading/total/page,
  and it is not all zero. Single-column statements are never tested.
- Impact check (real documents, before/after, full app in Chromium): HMC 46=46,
  Rise 26=26, Wiener EL KIJ 13=13 / TEZCATLIPOCA 12=12, Santmyer Charlie
  15=15 / Cecilia 16=16 — identical booked lines and unmatched items; only
  side effect: Spanish captions gain entries in the entity translation list
  (they already map by rule). Romy: 10 → 20 lines, balance sheet ties
  (26,027.29), P&L revenue/expenses/interest/tax booked; "Petit matériel et
  fournitures de training" 549.54 and OCR-misspelt "Frais de comptabilitée"
  1,300 stay in Review. Not testable here: Boating, Collaborate & Eight,
  Wendorf (no source documents in session).
- Also fixed: `service.health()` returned a bare object when the service is
  "off" and the 60 s cache expired, so the OCR job's `.then` threw and the job
  stayed "running" for ever (Process waited for ever). Now always a Promise,
  and `EN9ocrStart` starts the engine inside a promise so any throw fails the
  job visibly. Test in `test:ocrbrowser` (fails on the old build).

2026-09-28 (4) OCR'd statement "could not process — no caption/figure
pairs" (owner screenshot, Romy Cuadras / Athletic Prime SARL); NOT committed:
- Root cause: the scan prints each figure ~half a line off its caption
  (below on the P&L, above on the balance sheet) and OCR boxes add ±3 pt of
  noise, so the text layer put captions and figures on different lines —
  "Loyer" had no figure, "Frais de publicité" took the communication line's
  2,525.23, most captions read with nothing. OCR words themselves were right.
- `en9OcrAlignRows` (layer, text layer only; sidecar keeps boxes as read):
  figures grouped into rows (one value per right-aligned column), the page's
  own caption/figure offset measured on unambiguous rows, then rows aligned to
  captions left of the figure columns by a monotone DP (nearest, never
  crossing, one row per caption). Pages already aligned are returned
  untouched. Result on Romy: every one of the 23 BS and 20 P&L lines carries
  its printed figures (43 pairs read, was 24).
- `en9OcrRuns`: the text layer draws each run of words as one string with
  real spaces; word-by-word drawing made pdf.js read "Totaldes produits".
- Section banners `capitaux\s*propres`, `capitaux\s*étrangers`,
  `actif\s*(circulant|immobilisé)` (src + dist): PP-OCRv5 drops the space in
  letter-spaced headings ("CAPITAUXPROPRES"), which had put equity rows under
  liabilities. Equity now books Capital 20,000 + retained 4,624.26.
- Tests: `test:ocrbrowser` +4 (real Romy boxes), `test:swiss` +1.
- (French leaf captions and Swiss same-indent subtotals: done in (5) above.)

2026-09-28 (3) OCR card said "No OCR service found" after a successful
PaddleOCR read (owner screenshot); layer only, NOT committed:
- A missing local service is the normal case, not an error. The engine box is
  now built from `EN9OCR.service.statusParts()` → {main, details}: main leads
  with the engine that reads ("PaddleOCR (PP-OCRv5) runs in this browser…
  Optional: an OCR service…"); details hold "Service looked for at … — none
  running." and, after a fallback, "PaddleOCR could not be loaded here: …".
  `statusText()` still joins both (tests, Settings). Fallback main line:
  "Primary OCR unavailable — fallback OCR (Tesseract.js) is reading instead;
  review recommended." The job progress line no longer prints probe errors.
- "N readings to check" counts distinct flagged WORDS (`en9OcrFlaggedWords`),
  not flags: one word flagged for a glyph and for low confidence was counted
  twice (Romy: 4 → 2, both in the handwritten "Genève 30 Mai 2025"). Review
  items are unchanged (one per flag).
- Failed row: the real engine error is kept (`EN9OCR.lastError`), not "no
  result"; Details list the primary (PaddleOCR) and fallback (Tesseract.js)
  reasons; a download failure reads "OCR engine could not be loaded — check
  the internet connection…" instead of "add a clearer scan".
- Details no longer repeat "Engine: …" when the message already names it.

2026-09-28 (2) page-2 classification + Wilbur items 5-7 (owner approved; NOT
committed):
- `EN9PNLTITLE`: dist band P&L title test lacked "compte de profits et
  pertes" and "erfolgsrechnung" (src had them). A French P&L page fell to the
  shape tests, came out fs-balance-sheet 1, every P&L line booked to BS:50.
  Now fs-pnl 3 on Romy Cuadras' statement. Guard in `test:swiss` (fails on the
  old dist).
- Item 5: `PROFILE_FIELDS` gains refId→B5 and principalPlace→B29 (template
  rows 5 and 29 were empty and unreferenced); `buildWrites` always writes the
  labels A5 "Reference ID:" and A29 "Principal Place of Business". dist
  `EN9BASICREF`/`EN9BASICPPB`/`EN9BASICBOX`. The profile form hides the two
  from the generic list (`EN9PROFDUP`) because EntitiesView already has
  dedicated inputs for them. `cf-refid` message now says "carried to Basic
  Information B5".
- Item 6: B4 (header, read by 19 sheet titles) is written as `=B11` whenever
  a legal name exists — one name, entered once. dist `a8` refuses formulas by
  design (injection guard pinned in `test:gen`); `EN9CELLREF` allows exactly
  the constant "=B11" and nothing else, pinned in `test:gen`.
- Item 7: Provenance sheet gains "CARRIED FORWARD FROM THE PRIOR-YEAR RETURN"
  listing every extraWrite with a `prov` snapshot (today: Schedule J F15 from
  prior Sch J line 14) with document, page, row text (dist `EN9CFPROV`).
- New `test:basicboxes` (8 cases), wired into `test:all`.
- Verified on Romy Cuadras' files: B4 formula, B5 CUADRATHLETIC9469, B29
  SWITZERLAND, Provenance row "Schedule J F15 … p.48 … -3127"; LibreOffice
  recalculation resolves B4 and the sheet headers to ATHLETIC PRIME SARL.
- Still open for this client (not asked): French P&L/BS captions have no
  mapping rules and no AI key, so 14 lines stay unmatched and the balance
  sheet is out; "Capital-actions"/"Réserve légale" rows lose their figures
  because the scan prints amounts ~5 pt below the caption.
- Live check 2026-09-28 on Romy Cuadras' scanned BS/P&L: all four assets 200
  from GitHub, engine ppocr, 2 pages in 43 s, 4 flags (Tesseract gave 56).
  Sandbox note: this container's egress proxy refuses browser-marked requests
  to media.githubusercontent.com and blocks cdn.jsdelivr.net, so the test
  relays media.* through Playwright `route.fetch` and serves ort/pdf-lib from
  node_modules (same pinned versions).

2026-09-25 OCR card presentation pass (layer only, NOT committed at owner's
request; no OCR/engine/fallback/processing/API change):
- Job rows (`en9OcrJobRow` in `layer-src/enhance.js`): badge · file · time on
  one line, one plain result sentence under it, diagnostics (full engine
  message, `Engine:`, `Reason:`) folded in a `Details` toggle whose open state
  survives re-renders (`en9OcrOpenDet`). Badges: Checking / OCR required /
  Reading / Not needed / Completed / Needs review (flags > 0) / Failed. Page
  and flag counts come from the file's `ocr` record, else the app's sentence.
  Long names get `<wbr>` after `_ - . )` and space. Stacks at <=520px.
- `EN9ocrSay`: a message for a file goes only to its row; the card status line
  takes file-less messages and hides when a row names the same file; toasts
  only for outcomes (done/failed/no job). Intro line hides once rows exist.
- Pill shows "Needs review" when an active-entity job failed.
- Card anchors under the ACTIVE entity's dropzone (`en9ActiveEntityCard`); the
  "Waiting for OCR to finish: …" hint goes only in that entity's run panel.
- Engine status box: the "(… could not be loaded … URL …)" fallback text moves
  into Details (`en9OcrEngineText`); textContent keeps it.
- CSS: manual OCR controls wrap by card width (flex) with natural-size
  checkboxes; doc-list rows wrap long names (Remove stays visible); ⌘K hint
  hidden <=420px (it caused sideways page scroll); Settings `.view-stack`
  holding `.en9-ocrset` uses `minmax(0,1fr)` so the rate table no longer cuts
  the OCR settings card off.
- Verified with Playwright at 1440/1024/768/414/360: no page overflow, no
  clipping/overlap in card, rows, doc list, run panel or settings card.

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

## HMC FY2025 reconciliation (2026-09-17)

A tool-generated FY2025 work paper was reconciled against the client's
hand-prepared FY2024 work paper, the signed 2025 accounts and the filed 2023
return. Shareholding reconciled in full; Schedule C and Schedule F did not.
Fourteen findings. The first three — all mapping-pipeline defects — are FIXED:

1. **A repeated statement title reset the section at every page break.**
   `tagSections()` ran BEFORE the furniture drop, and a multi-page P&L reprints
   its own title at the top of each continuation page. That title IS a banner
   ("Statement of Financial Performance" → income), so the section flipped from
   `costs` back to `income` and every page-2 caption with no keyword match was
   booked as gross receipts — six rows, 326,669. Fix: `dropFurniture()` now runs
   first, in store.ts and behind `EN9FURNFIRST` in dist. `dropFurniture` already
   knew how to spot a caption repeating across pages; it was simply too late in
   the order. No new logic.
2. **A subtotal printed FLUSH with the rows it adds was booked as data.**
   `structRows()` only walked rows indented DEEPER than the total, so Xero-style
   groups ("Total Purchases" level with "Contractor Labour Costs") were counted
   twice — 270,737 across Schedule C and F. New fourth test in `structRows`
   (`EN9FLUSHTOT` in dist): a total-word caption whose value equals the sum of
   the consecutive rows immediately above it AT THE SAME indent. The walk stops
   at a shallower row, at a row already found to be structure, at a caption
   with no figure, and — the part that took a second pass to get right — at
   ANOTHER total, proved or not. These accounts print "Total Expenses" as the
   sum of 27 whole-dollar lines: 642,791 against a printed 642,794, three
   dollars out, so it stays data; without that stop the next group's total
   walked past it and summed 29 rows instead of its own one.
3. **A movement schedule was read as a balance sheet.** The accounts'
   "Shareholder Current Accounts" page (opening balance, funds introduced,
   drawings, closing balance) put twelve non-balances on Schedule F line 16 —
   113,062, the whole year-end imbalance. New `dropMovementSchedules()`
   (`EN9MOVSCHED`): a page carrying BOTH an opening- and a closing-balance row
   and NONE of the totals a balance sheet exists to state is a movement
   schedule, and its rows are marked rather than deleted so the log can say so.

Proved by re-running the real client documents through the shipped file:
Schedule C gross receipts 1,044,522, cost of goods sold 152,418, compensation
707,012, rents 33,800, interest 84, depreciation 15,862 — every one exactly the
signed accounts. Schedule F liabilities and equity at 31/03/2025 land on
179,864, the accounts' figure to the dollar, where the supplied file had
291,614. `test:sections` is 41 checks and both trees are compared on the new
behaviour; `test:all` 1301, the one failure still `test:peg`.

One existing test asserted the old behaviour ("at the same indent as its
siblings it is not a total of them") while its own name said the opposite. It
was locking in the defect, and is rewritten to require the drop, with the
no-arithmetic-tie case kept as the guard.

### Findings 4-14, fixed 2026-09-18

All eleven remaining findings are fixed. Schedule C now ties to the signed
accounts on every line (net income before tax 2,866, per books 2,687) and
Schedule F reconciles to the hand-prepared work paper line by line at
31/03/2024 with no classification difference; the only residuals are 1 and -2
of the statement's own rounding between the fixed-asset note and the face.

**Two more sections, on the pattern the module already used for `cogs`.**
`otherIncome` (banner `^(total )?other income$`): a caption printed there is a
receipt, so it may reach lines 4-9 but never gross receipts and never a
deduction. Motor Vehicle Contribution matched the motor-vehicle EXPENSE
keyword and was deducted, moving the bottom line by twice itself.
`termLiabilities` (banner `^(total )?(non-current|long-term|term|deferred)
liabilit(y|ies)$`, which MUST precede the general liabilities pattern): line 19,
not line 16. Both vetoes had to admit what prints underneath them — equity
follows the long-term liabilities and the banner is sticky, so
`NON_CURRENT_LIABILITY_TARGETS` includes rows 58-62 and the route runs the
equity tests first. Without that, the boating fixture's retained earnings
landed on a liability line.

**The notes are read, never booked** (`statementNotes` / `fixedAssetSplit` /
`noteLookthrough` in engine.ts, `EN9NOTES` in dist). Note headings carry no
figure so the row reader drops them; a note is read BACKWARDS from its closing
"Total X" line, stopping at the previous total at the same or a shallower
indent and at a page break. Two uses, each of which proves its arithmetic
against the note's own total first: the fixed-asset note supplies cost and
accumulated depreciation for Schedule F 9a/9b, which the face prints only as a
net; and a note holding exactly ONE thing renames the face caption to that
thing ("Other Non Current Assets" is the note's "Intangible Assets", line 12c).
The split is applied by REWRITING the evidence — the face row becomes the cost
and a depreciation row is spliced in immediately after it, so the ordinary
rules book both. Two things that cost a pass each: the face row carries the
note NUMBER as its first value (`[4, 23353, 28667]`), so the comparison and the
rewrite use the TRAILING columns; and the spliced row must sit beside its host,
because appended at the end it fell under the Equity banner and the
liabilities-side veto threw it away.

**The accounts' own shareholder register** (`directoryShareholders`,
`EN9DIRSH`) is read from the directory page and outranks the prior return's
Schedule B Part II, which named one of the three holders. Names are matched on
a prefix, because the form truncates at the column edge: "ARCK TRUST (ARCK
LEGACY TRUS" is "ARCK Trust", and counting them separately doubled the trust.

**The prior return must close where the work paper opens.** A FY2023 filing
does not open FY2025. `cf-year-gap` is now a BLOCK and gates both the
Schedule F seeding and the Schedule J opening (`cfStale`, `EN9cfStaleG`).

**Template.** Line 21a carries a POSITIVE expense and row 22 subtracts it
(F52-F54-F55 became F60-F62-F63 after the row shift); `taxBookValue` no longer
flips the sign and warns only when the statement printed a tax negative.
Schedule E M16/O16/Q16 carry formulas, so the USD tax computes instead of
dividing by an empty rate. The Retained Earnings roll-forward opens at
`'Balance Sheet'!D61` and row 24 COMPUTES the currency translation adjustment
— the opening balance, the year's income and the closing balance translate at
three different rates, so without it the US dollar column can never close;
N() guards make a blank row nought rather than #VALUE!. Schedule F's
out-of-balance row is labelled and computed in all four columns.

**Line 17 has 25 detail rows, not 17** (this client has 21 captions and five
were merged into one). Rows 51+ shifted down by eight. What that touches, and
what caught me: the shared-formula `ref` ranges live on the `<f>` TAG, and a
shared MASTER also carries its formula in its body, so both need moving; and
cell refs must be renumbered EITHER by the row rewrite OR by the formula
rewrite, never both. Code that moved with it: `IS_LINES` rows 51-67,
`FORMULA_REFS[is]` [9,13,21,25,33,59,60,64,68], `POOLS["IS:OD"]` 34-58,
`bookNetIncome` (rows 61-63, and it now SUBTRACTS the tax), the tax rules and
`TAX_TARGETS` (IS:62/IS:63), and three test files.

**Acknowledging a blocker asks only that the preparer says something.** The
first version of that check demanded fifteen characters and rejected a list of
filler words. It was wrong twice: it refused real answers for being short
("Rod confirmed" is thirteen characters, "Client confirmed" is sixteen, and
that is not a difference worth anything), and it left no way to acknowledge a
blocker in order to see what the workbook looks like. A reason can be
anything; the preparer signs the return. What the original defect actually
needed was for the problem to stay VISIBLE afterwards, which the labelled
out-of-balance row on Schedule F and the Provenance sheet now do. A thin note
(`isThinNote`) is recorded, never refused: the Provenance line for that
blocker gains "NOTE GIVES NO REASON: check this figure before filing".

Also: `property, plant and equipment` added to the line 9a keywords (only the
Spanish was there), catalogue version 7; an asset-side shareholder current
account routes to line 6, mirroring the liabilities branch, so it no longer
needs the AI; an empty
acknowledgement note is refused, but nothing else is.

**Basic Information, 2026-09-18.** Three defects, one of them a src/dist
drift the earlier reconciliation never looked at.

The shipped build carried an address splitter (`Ov`) that src did not have at
all: it sorted the lines into street / city / region and wrote them to address
lines 1, 2 and 3 by that classification. On a two-line address -- "49 SHRULE
PLACE" then "HAMILTON 3210 NEW ZEALAND" -- nothing looked like a city, so B14
was left blank and the country printed on B15 with a hole above it. The three
template cells sit under one "Entity Address" label: they are LINES, not
fields. `addressLines()` now fills them in printed order in both trees.

"Does the entity have a 10% corporate shareholder?" answered No although a
trust holds 98%. `isCorporateName` is anchored on the END of the name, and the
form truncates at the column edge: "ARCK TRUST (ARCK LEGACY TRUS" does not end
in "trust". The test now reads the accounts' shareholder register first, where
the name is whole.

"Is the filer a director or officer?" was left blank: it is proposed from the
prior return's Item H boxes, which did not resolve. The accounts name their
directors on the same page as the register, so `directoryDirectors()` reads
them and `samePerson()` matches the filer past a middle initial ("RODNEY W.
CLAYCOMB" is "Rodney Claycomb"). First and last name words must both match, so
a shared surname is not enough.

Left alone deliberately: the filer categories come from the prior return's
Item B, and that return ticks 1a and 4 only where the hand-prepared work paper
also ticks 5a. The tool is faithful to the document and warns; which categories
apply this year is the preparer's determination, not something to infer.
Likewise `legalName` follows the accounts ("HMC Communications Ltd") where the
return says "LIMITED", and the books-keeper's name loses its "LP" to the same
column truncation as the trust.

`tests/test_notes_register.cjs` (`test:notes`, 27 checks) covers the note reader, the
register, the directors, the address lines and the acknowledgement rule in
both trees. `test:sections` is 49 and `test:notes` 21. `test:all` 1336,
the one failure still `test:peg`.

### src-only defect fixed 2026-09-21

The `profile-year-vs-documents` block added on 2026-09-18 had landed inside
`pruneRemovedDocData` in `src/prototype/wp/store.ts`, where neither `caseYears`
nor `rv` exists — `npm run typecheck` failed and a src build would have thrown.
Moved to the detection block beside `updateEntity(... unmatchedProfile ...)`,
which is where dist's `EN9YEARVSDOCS` already had it. dist was correct
throughout, so no shipped behaviour changed.

## AI Mapping & Review Agent (2026-09-21)

Added; nothing existing was rewritten.

- Where it sits: documents → OCR/extraction → translation → **agent** → the
  existing 5471 rules and mapping → validation → review/exceptions → work
  paper. It runs at processing step 6, BEFORE `aiRun`, on rows the rules could
  not place. It reads only cached extraction — no document is re-read.
- It never books anything itself. Every confident suggestion goes through
  `manualApply` (src) / `bF` (dist) with the same two document vetoes the AI
  pass uses (bank-account caption, section banner). Low confidence, a conflict
  and an invalid line id are refused and land in the Exception Centre with
  document, page, caption and figures (`citeEvidence`).
- Framework: the LangGraph state-graph API — `StateGraph`, channels with
  reducers, `addNode`/`addEdge`/`addConditionalEdges`, `START`/`END`, a
  recursion limit, a step callback. The runtime is local
  (`src/prototype/wp/agentGraph.ts`, ~90 lines) because `dist/index.html` is a
  single offline file that is patched and never rebuilt, and the npm package
  needs a bundler and a Node runtime. The graph itself is the published shape,
  so it can be moved onto the real library if a server is ever added.
- Nodes: `gather` → `understand` → (model? `suggest` : `critique`) →
  (translated? `terminology` : `critique`) → `critique` → `route`.
  `understand` and `critique` are deterministic, so a key-less deployment
  still gets gap and conflict findings.
- Credentials: the existing Groq key only. No second key system anywhere.
  Settings ▸ AI platform shows connection status, never the key.
- Files: `src/prototype/wp/agentGraph.ts`, `src/prototype/wp/agent.ts`,
  `agentRun`/`agentInfo`/`setAgent` in `store.ts`, `AgentCard` in
  `SettingsView.tsx`, `enhanceAgentSettings()` in `layer-src/enhance.js`
  (+ `.en9-agent` CSS), dist sentinels `EN9AGENT`, `EN9AGENTCALL`,
  `EN9AGENTACT`, markers `EN9AGENTDEF` and `EN9AGENTSEEN`.
- `aiRun` now skips rows carrying `agentSeen` / `EN9agentSeen`: the agent uses
  the same two prompts, so re-asking would spend the tokens twice and would
  book what the agent deliberately held back. The profile pass is unchanged.
- State: `state.agent` (src) / `te.EN9agent` (dist) — `{enabled?, lastRun}`.
  Defaults to on; a project saved before this loads with `{}`.
- Tests: `npm run test:agent` (29 checks, src vs dist parity included),
  `npm run test:e2e-agent` (22 checks in Chromium). `test:aiparity` gained the
  `agentSeen` pin; `test:integrity` gained the three sentinels and four
  wiring guards.

## Period end and the agent's balance review (2026-09-21)

Raised by a live client (Rise Digital Marketing, 30 June year end): the tax
period was wrong, cash and fixed assets were missing from Schedule F, and
equity did not tie. Fixed generally, not for that client.

- **The statements' own period end is now read.** `detectStatementPeriodEnd`
  (classify.ts / `EN9stmtPeriodEnd`) parses "for the year ended 30 June 2024",
  "as at 31 March 2025", "as of December 31, 2023" — both date orders, ordinal
  suffixes — from the head of every `fs-`/`ato-` page, and prefers the date
  agreeing with the detected statement year, because every set of accounts
  prints the comparative beside it. `DocClass.statementPeriodEnd` carries it.
- **Seeding priority for B1/B2 changed**: the statements' printed period end
  first, then a prior 5471's period rolled forward, then 12/31 last. Before
  this the day and month could only come from a prior 5471, so a fiscal entity
  with no prior return was silently dated 12/31 — wrong FX tables, wrong
  Schedule E and J dates, wrong period filed.
- **Provenance no longer implies a quotation.** A rolled-forward year end now
  cites "… annual accounting period ended 06/30/2023, rolled forward one year",
  and the 12/31 fallback says "no period end stated, 31 December assumed".
  New review items `period-end-assumed` and `period-end-disagreement`.
- **The agent gained a review phase.** `reconcile` is a seventh node reached by
  a router at START (`phase: "review"`): the store runs the graph a second time
  after booking, with `BookFacts` (period end and its provenance, EOY assets /
  liabilities+equity / equity, the filled targets) and the still-unmatched
  captions. Deterministic — it needs no key. It reports an empty Cash line, a
  fixed-asset caption never booked, cost without accumulated depreciation, an
  assumed or contradicted period end, and an out-of-balance sheet **naming the
  unbooked caption (or pair) whose figure equals the gap exactly**.
- `agentRun` no longer returns early when nothing is unmatched: a balance sheet
  can be out with every caption mapped, and the review is the only thing that
  reads it back.
- Tests: `npm run test:period` (33 checks, src vs dist), `test:agent` now 49,
  `test:e2e-agent` 26 including a real balance-sheet run in Chromium.
- Still dist-only: the `EN9-fiscal-title` grid scan that reads a year end from
  a CSV/Excel title row. It now runs as a fallback behind the PDF reader.

## The work paper year controls the run (2026-09-22)

Raised by a 12-gap diagnostic on Rodney W. Claycomb: 2025 statements (with a
2024 comparative) and a 2023 return, for a 2024 work paper. The tool took 2025
because it was the newest year in a document, and correcting the year end in
Basic Information changed nothing downstream.

- **`resolveCaseYears(ent)` is now the one source.** The year the preparer
  entered wins; the documents vote only when nobody has entered one.
  `selectedYear()` distinguishes a typed year from one the tool proposed by
  comparing `profile.cyEnd` with `detected.cyEnd` — the record of who chose.
  Every consumer reads it: step 1's `caseYears`, `entityYear`,
  `materializeCaseWrites`, `manualApply`'s column routing and the agent.
  `deriveCaseYears` keeps its old meaning as the document vote.
- **A year change after a run invalidates what the old year produced.**
  `setField` sets `yearStale`, drops auto-fetched rates, logs the change;
  `validateEntity` blocks generation until the entity is processed again;
  a completed run clears the flag.
- **A column outside the current/prior pair is named, not dropped quietly**
  (`year-columns-unused`), with the year and how many figures it carried.
- **Next year's accounts are the comparative source, not a stray.** The agent
  gives a document reporting `required + 1` the role `comparative`: its prior
  column is this year's closing balance sheet. `required - 1` is
  `prior-year-input`, and nothing covering `required - 1` is a named failure.
- The prior return's own accounting period is copied onto its `DocClass`, so
  it is placed by the period it states rather than by its label year.
- A sibling entity created from a prior return inherits the chosen year.
- The activity card shows the chain: detected years, work paper year, current,
  prior, who chose.
- Evidence, Claycomb, one run with 2024 selected: current year `BS:10` 110,171
  (the 31 Mar 2024 column, was 41,165), `IS:7` 1,120,054 (was 1,044,522), the
  2023 return accepted as prior-year input (the `cf-year-gap` block is gone),
  and "Columns not booked: 2025 (46 figure(s))". Ashley Elliott, where
  detection already worked, is unchanged: 2024 from the documents, 0 unmatched.
- Tests: `npm run test:caseyear` (19, src vs dist), `test:agent` 91,
  `test:e2e-agent` 45.
- Two stale text pins were found failing and fixed: `test:wired` and
  `test_sections`. `test:wired` prints `FAIL:`, not `FAILED:` — grep for both.

## Tax-year check and the agent dashboard (2026-09-21, third pass)

**Root cause of wrong-year selection.** Year detection and period detection
were two separate anchor lists, and only the year list fed `deriveCaseYears`.
Xero heads a P&L "For the 12 months ended 31 December 2024" — which says
neither "year ended" nor a bare year — so `detectStatementYear` returned NULL
and the document voted for no year at all. With only a P&L uploaded the case
year is null, Basic Information falls back to 31 December, and the whole work
paper is dated on an assumption. Verified live on Ashley Elliott: `pl.pdf` read
as year `null` before the fix, `2024` after.

Fixed at the root:
- `YEAR_ANCHORS` gained the "N months ended" shape.
- `detectStatementPeriod` reads a printed RANGE whole ("for the period 1 July
  2023 to 30 June 2024") and returns both ends; a single-date reader would
  take the first date, which is the period START, and date the work paper a
  year early. `DocClass.statementPeriodStart` carries it.
- When no year anchor matches, the year is taken from the period end. A
  document can no longer be read for its figures while reporting no year.

**Tax year check** is a new node (`yearCheck`) between `survey` and
`spotlight`, so it runs before mapping, carry-forward and generation. Each
document gets `role` (current-year / prior-year-input / reference / unclear),
`supportsYear` and `match` (match / mismatch / unclear / unchecked). A
mismatch or an unreadable year is a named failure with the document and the
action; nothing is used silently. Graph is 12 nodes.

**Agent dashboard.** The activity card was a wall of text; it is now a compact
dashboard: status badge, five counts (documents, items reviewed, issues, sent
to Review, could not process), activity chips, the tax-year table, document
cards with View details and Open document, finding cards (title, one short
line, source, impact, status, View source + Evidence), a separate "Important
information not used" block, failure cards (what, source, stage, reason,
action), and the workflow strip. "AI Mapping & Review Agent:" is no longer
printed on every line, and no paragraph exceeds ~200 characters (asserted).
**View source / Open document opens the real file** — the project holds the
bytes, so it is a blob URL with `#page=N`, which PDF viewers honour.

Not re-tested: Rodney W. Claycomb, whose documents are not in this session.
The defect class was the same (year read from a prior return rather than from
the statements' own period) and is covered by the same fix.

## Agent across the whole lifecycle (2026-09-21, second pass)

The agent was a post-pass; it is now three phases of one graph, entered by a
router at START.

  documents → reading/OCR → language → translation → **understand** → the
  existing 5471 rules and mapping → validation → **map (leftovers)** →
  **review** → work paper

- **understand** (end of step 2, before any mapping): `survey` → `spotlight` →
  (model? `interpret`) → `handoff`. It reads only what extraction already
  cached. It records a `DocBrief` per document (kind, pages, figures, rows
  dropped as structure, language, period end, OCR), detects the language and,
  when it is not English and a key exists, **translates before mapping** so the
  rules read the English rather than a translation that arrives too late.
  `spotlight` names every figure the pipeline would let past: no rule and no
  heading, dropped as structure although the caption does not call itself a
  total, or non-Latin with no translation. `interpret` asks the model what
  those are; a low-confidence answer becomes a FAILURE, never a guess.
- **Acting on it without overriding anything**: a row the structure pass
  dropped that the agent reads as a line item is marked `agentImportant` and
  step 3 pushes it into `unmatched` with the agent's reason. It is never
  booked — the arithmetic that dropped it may be right — but it stops being
  invisible and reaches Review, the Exception Centre and the AI pass.
- **review** closes the loop: every important item is marked `booked`,
  `unmatched` or `unused`, and an `unused` one is a finding. Every earlier
  failure is re-stated there with stage, what, source, page, reason and the
  action required. Nothing the agent could not do is dropped quietly.
- `translateCaptions()` is now shared by the agent and the Translate action —
  one translator, one set of guards.
- New state: `Entity.agentBrief` / `EN9agentBrief`.
- **AI Agent activity** card (layer) on the entity's Review & log tab and in the
  Entity workspace: steps run, what was read, what was translated, what was
  flagged and what happened to it, what needs review, what failed and why.
  Settings ▸ AI platform gained where the agent sits in the lifecycle, that it
  runs twice, where to watch it, and what happens when it cannot do something.
- Graph is 11 nodes. Tests: `test:agent` 71, `test:e2e-agent` 38.
- A blind string replace damaged `enhanceCategoryAuthority` in the layer (its
  `if(!host)` guard became `if(!seat)`), which silently killed the whole
  enhancement pass. Caught by the browser e2e, not by any unit test — anchor
  layer edits on their enclosing function, not on a line that repeats.

## Rise Digital Marketing — live test (2026-09-21)

Four real documents (Xero balance sheet, Xero P&L, the 2023 US return, the
Bright!Tax questionnaire). Before the fixes below: period 06/30/24 (rolled
forward from the prior return), 4 captions unmapped, Schedule F out by
44,660.64. After: period 12/31/24 read from the statements, **0 unmatched**,
Schedule F ties to the client's own totals (assets 44,933.33, equity
32,940.38), 147 cells written.

What the documents exposed, all fixed generally:

- **A bare "Bank" heading.** Xero prints the group as "Bank" (QuickBooks prints
  "Bank Accounts", which was the only pattern in the lexicon) and names the
  accounts after the product — "Cheque Account", "Remote Boss Lifestyle". No
  keyword can reach the second; the heading is the only evidence. New banner.
- **"Cheque Account".** The cash rule knew "checking account" (US) but not the
  Commonwealth spelling. Added with four more package defaults.
- **A "Fixed Assets" heading was only "assets".** New `fixedAssets` section,
  vetoed to the non-current asset lines, routing to BS:28 by default. Its
  accumulated depreciation booked on 9b while the assets themselves stayed
  unmapped, so the balance sheet was out by the cost of everything the entity
  owns. The rule catalogue also gained the account names a package prints
  ("Computer Equipment", "Office Equipment", "Motor Vehicles", ...).
- **"Equity" was routed as "liabilities".** So Drawings, Current Year Earnings
  and Opening Balances fell to the current-liability catch-all (BS:50) — money
  owed within twelve months. New `equity` section, vetoed to BS:58-62.
- **"Capital - <person>" claimed by the bare "capital" keyword** on the
  common-stock group. A capital account in a named person's name is line 21
  (paid-in or capital surplus), not line 20b. Added to the BS:60 group, which
  precedes BS:59.
- Rule catalogue **v7 → v8**; `RULES_ADDED_SINCE[7]` registers the three new
  keyword groups so saved projects receive them.
- Banner lexicon 29 → 34 patterns, both trees.

Judgement call left alone: "Paypal Fees" (20.87) books to cost of goods sold
by the payment-processor rule, although this P&L prints it under Operating
Expenses. Changing that rule would push genuine cost-of-sales captions off the
COGS lines for statements with a single "Expenses" banner, so it stays and is
reported to the owner instead.

## Rule catalogue upgrades

Adding a group to `DEFAULT_RULES` is not enough. `upgradeRules` reaches a saved
project only for groups registered in `RULES_ADDED_SINCE`, and only while
`RULE_CATALOGUE_VERSION` is ahead of what that project stored. Both were missed
on 2026-09-10 and six groups shipped that no existing user could ever receive;
dist had no upgrade path at all until 2026-09-11. `tests/test_rule_upgrade.cjs`
now fails if it recurs, comparing against the baseline in
`tests/fixtures/rules_v3.json` — refresh that file and bump the version when
cutting a release.

### 2026-09-22 — gap-report remediation (uncommitted)

Driven by the HMC FY2024 reconciliation and the earlier
`OCR_Workpaper_Gap_Report.xlsx`. Both trees patched, no rebuild.

Verified first, then fixed. Re-running HMC through the shipped file showed
that most of the 14-finding gap report is already closed: gross receipts
1,044,522 (page-7 rows no longer flip to income), statement subtotals dropped,
the page-11 movement schedule dropped with a reason, Motor Vehicle
Contribution on other income, income tax positive on line 21a, 25
other-deduction rows, three direct shareholders read, `cf-year-gap` already a
BLOCK, Schedule E M16/O16/Q16 carrying formulas, the 8992/Worksheet cells
already pointing at `Shareholding Details!N16`, and Retained Earnings opening
already `='Balance Sheet'!D61`. The gap report's "reject a note under 15
characters" is deliberately NOT implemented — see the comment in
`dismissReviewItem`, which records why that check was removed.

Reconciliation finding 1 ("Income Tax Expense 5,235 booked to Other deduction
21") does NOT reproduce on this build: `matchRule("Income Tax Expense")`
returns `IS:62`, only one rule in the catalogue hits that caption, and the
rule has been in `engine.ts` since its first commit, so no saved catalogue can
lack it. The workbook that showed it came from an older build. Re-run
generates 21a = 5,235 and net per books 4,514 against the manual's 4,509.46.

What actually changed:

1. **Prior year end follows the work paper year.** `priorPeriodEnd()`
   (`EN9priorEnd` in dist) plus a step at the end of the period-proposal chain
   and in `setField`. Period proposals only fill BLANK fields, so a prior year
   end proposed for the year the documents report on survived a change of the
   work paper year: a 2024 work paper built from FY2025 statements kept
   03/31/24 — its own closing date — as its opening date. The prior year end
   now follows the current one unless the preparer typed it (`detected.pyEnd`
   is present exactly while the value is the tool's proposal). Verified live:
   selecting 03/31/24 gives 03/31/23; changing the year after a run moves it
   immediately, sets `yearStale`, and re-processing switches gross receipts
   1,044,522 → 1,120,054, cash 41,165 → 110,171 and tax 179 → 5,235.
   The dist-only `EN9-fiscal-title` notice no longer claims the statements'
   period was adopted when the preparer chose a different one.

2. **A shared "attach schedule" row names every account on it.** `resolvePool`
   used to count only the captions that arrived AFTER the first occupant of the
   last slot, so a row holding three accounts was reported as holding two; the
   notice was `info` and raised inside the loop, where the first message won
   the review id and froze the count. The allocator now records the first
   occupant too (`shared`, was `overflow`), the notice is raised once after the
   loop from the final pool state at `warn`, and generation writes an
   **"Attached schedules"** worksheet listing every caption with its own BOY /
   EOY / amount, document and pages. The row's total is unchanged — Form 5471
   line 16 is one line — but it is no longer silent. Pool state key renamed, so
   `tests/fixtures/harness*.cjs` were updated; `resolvePool` tolerates the old
   shape.

3. **A rule on the wrong sheet is re-asked, not dropped.** `matchRuleScoped`
   (`Tv(label, rules, sheet)` in dist) restricts the scan to rules that can
   land on one sheet; feed scoping calls it instead of setting the target to
   null. "Motor Vehicle" is a depreciable asset on a balance sheet and a
   running cost on a P&L and both catalogues own the words, so the loser used
   to fall through to the banner fallback or the unmatched list. SKIP stays
   reachable from either sheet.

4. **Schedule E (d) and (e).** Both cells take the corporation's accounting
   period, which is right for a 31 December CFC and an assumption otherwise.
   A non-calendar year end now raises `sch-e-tax-year-pair` naming the
   difference between the foreign tax year and the U.S. tax year.

Deliberately NOT changed (presentation, no effect on net income): the wages
split between line 11 and other deductions, netting the loss on sale into
other income, and merging non-deductible expenses into donations. The opening
column rebuilt from the prior return is a document problem, not a code one —
supply the FY2024 statements, whose comparative column IS 31/03/2023, and the
agent already says so. The fiscal-period average rate (OFX daily, cited in
Provenance) is a house-convention choice, not a defect.

Tests: `test:poolshare` is new (10 assertions); `test:caseyear` gained four
groups including a step-back over every year 2000-2099. `test:all` is 60
suites / 1,500 assertions, `test:peg` still the one known failure.

### 2026-09-23 — Wiener gap-report remediation (uncommitted)

Driven by `Wiener_2024_Tool_vs_Manual_Gaps_and_Fixes.xlsx` (22 rows). Both
trees patched, dist hand-patched as always. `test:all` 1,500+ assertions green
except the pre-existing `test:peg`.

Root causes fixed, each general rather than Wiener-specific:

- **Two facing panels on one page.** `splitSidePanels` / `EN9splitPanels`
  re-cuts a page whose geometry shows a vertical band no cell crosses with
  captions AND figures on BOTH sides. The band is measured only on rows
  carrying two or more figures, because the letterhead runs the client's name
  straight across the gap. Straddling cells go to the side holding more of
  them. Without it every liability on a Mexican balance sheet was swallowed as
  a second period column of the asset printed beside it.
- **Columns named by period type.** `detectPeriodRulers` reads a header row of
  column TYPES ("Periodo | % | Acumulado | %", "MTD | YTD", the CJK
  equivalents) and keeps only the cumulative column, dropping the percentage
  columns. The year ruler cannot tag those headers, so every P&L row arrived
  with four numbers and no year identity and nothing could book.
- **Spanish dates and titles.** `MONTH_ALIASES` gives `parseLongDate` the
  non-English month names, including the `dd/Mmm/yyyy` form; PERIOD_ANCHORS
  and YEAR_ANCHORS read "al 31/Dic/2024" (and the "del … al …" range, anchored
  on `al` so the range can never be read backwards). `STATEMENT_TITLE` allows a
  short lead-in ending in a comma, colon or dash, so "Posición Financiera,
  Balance General" classifies.
- **Entity identity from the statements.** `COMPANY_SUFFIX` carries the
  non-Anglo company forms and `findCompanyNames` tests each CELL as well as the
  joined line, because a package prints its own name and the sheet number on
  the client's line. `NAME_ROW_NOISE` rejects the form's own captions.
- **`entitySimilarity` ignores legal-form words.** "S DE RL DE CV" is shared by
  every Mexican corporation; counted as tokens, any two scored 1.0 similar. That
  merged two different CFCs into one 5471 block AND one carry-forward candidate.
  STOPWORDS now carries the international forms.
- **Every Form 5471 face page is recognised.** The form prints Schedule A at the
  foot of its own page 1, so the Schedule A test claimed every face and a
  multi-CFC return had no face page to segment on. Two page-1 markers are
  tested first. Carry-forward candidates are also deduplicated by NAME when both
  are named, so a reference ID bleeding across scan bands cannot merge two
  corporations.
- **After the fan-out the parent is processed again**, so page attribution can
  keep each corporation's pages to its own entity. The parent had been mapped
  while it was the only entity in the case.
- **Structure ranking when indent inverts.** A Spanish package indents the group
  TOTAL one level in from its members. `EN9DEEPTOT` ranks by caption when the
  arithmetic ties; a non-total row is never dropped as the "summary" of rows
  that are all total-worded; a nil total is skipped; and a zero amount no longer
  "proves" a zero sum.
- **Abbreviations are not prose.** `applyRowHygiene` treated "…de Eq. de Se.." as
  a sentence and discarded the row. A stop after a token of three letters or
  fewer is an abbreviation.
- **Mapping.** `SUMA DE(L) …` returns SKIP; a trailing ellipsis is stripped
  before the scan; catalogue v9 adds the Mexican chart (terrenos, equipo de
  transporte/servicios, edificios, maquinaria, the impuestos accounts,
  resultado de ejercicios anteriores, depreciación contable, gastos de
  servicio) and the Spanish result captions join the SKIP group. Seven Spanish
  section banners (ACTIVO / PASIVO / CAPITAL, letter-spaced, plus corto/largo
  plazo) route current versus non-current.

**The agent now acts before generation.** A `risks` node runs between
`yearCheck` and `spotlight` and returns `AgentRisk[]`: a corporation the
documents name that the case has no entity for, a document belonging to a
different corporation that is feeding this one, a set of accounts that produced
no figure, and documents that disagree about the period. Each carries what, why,
the recommended action and whether the tool may take it. Critical risks become
BLOCKING exceptions before a line is booked; the second-entity block clears when
the tool creates the entity, which is logged.

Verified on the live Wiener documents: two entities created, each reading only
its own two statements. Every amount agrees with the two manual work papers, and
both Schedule Fs tie (0.00 and -0.01) where the manuals are out by 8.62 and
35.24 of their own rounding. Remaining differences are line placement (trade
receivables 2a vs 5, finance costs 13 vs 17, taxes payable 15 vs 16, prepaid
taxes 5 vs 13) and the manual's whole-peso rounding.

New sentinels: EN9PANEL, EN9MONTHALIAS, EN9SUFFIX, EN9AGRISK, EN9CASECTX,
EN9DEEPTOT. The `test:detect` q1 snapshot was refreshed for the period-column
filter; the agent node list gained `risks`; the banner lexicon is 41 patterns.

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

**Found during the verification rerun, and fixed (2026-09-23, later):**

- **`fanOutSiblings` asked the reference ID before the name.** A stapled
  multi-CFC return prints both corporations' reference IDs inside one scan
  band, so the sibling's `refIds` carried the parent's ID too; the freshness
  test then matched the plan against the entity already being prepared and the
  second corporation was never created. It now applies the same rule the
  candidate dedupe does — when both are named the NAME decides, identifiers
  only settle it when a name is missing, and a placeholder ("Entity 1") is not
  a name. Sentinel `EN9FANNAME`.
- **Page attribution existed only in `dist`.** `EN9_norm` / `EN9_vars` /
  `EN9_attr` had never been back-ported, so a build from `src` added both
  corporations' balance sheets together (accounts payable 69,525,052.97 =
  53,983,795.40 + 15,541,257.57) while `dist` was correct. `src` now carries
  `entityNameVariants` and `attributePagesToEntities` and filters the IS, BS,
  equity, targeted-ATO and profile feeds through them, raising the same
  `entity-scope` warning. `tests/test_entity_scope.cjs` (`test:entscope`) pins
  the behaviour and asserts dist and src agree page for page.
- **`DocBrief.entityName`** is populated in `src` as it already was in `dist`,
  so the agent can tell a document kept for another corporation from one that
  genuinely carried no figures.
- **"produced ZERO mapped line items" is not raised** for a document whose
  pages were all attributed to another corporation; the `entity-scope` item
  already says where they went. Sentinels `EN9ZEROSCOPE`, `EN9ZEROSCOPE2`.

After these, `src` and `dist` book identical lines for both corporations
(TEZCATLIPOCA 12, EL KIJ 13) and the review lists carry no false failures.

### 2026-09-23 (2) — document reading, identification and mapping (uncommitted)

The diagnostic found one gate doing all the work: a document's type came only
from a title matched against a written-down phrase list, and an unidentified
document fed nothing. Both trees now carry the fixes.

- **Identification by SHAPE, as a last pass.** `classifyPages` gains pass 4,
  which runs only on pages every other pass left unknown — so a continuation
  page still inherits its statement and nothing that booked before stops
  booking. It asks what the page IS: `looksLikeBalanceSheetShape` and
  `looksLikePnlShape` read the section-banner lexicon (six languages, already
  trusted by the mapper) and require the statement's sides; `titleRowIndex`
  finds a title anywhere on the page, accent-folded, when there are at least
  three amount rows beneath it; `looksLikeQuestionnairePage` runs the
  spreadsheet questionnaire test over a PDF page; `looksLikeSchedulePage`
  catches a page of MONEY (grouping separator or two decimals — a mobile
  number is not money) that names no section.
- **New page kinds.** `fs-schedule` feeds `unassigned`: never booked, every
  row surfaced in Review with the page it came from. Not on a US return —
  those unnamed pages are the filer's own 1040 and 1120 schedules.
  `questionnaire` feeds the profile, so the client worksheet reaches the work
  paper whether it arrives as a spreadsheet or a PDF.
- **An unidentified document that carried figures BLOCKS.** One that carries
  none stays a warning: there is nothing to lose.
- **Read status tells the truth.** `readDetail` prints characters, lines,
  lines with figures and where they went ("NOT USED — type unknown"). The
  status word is unchanged, so a document that read fine but could not be
  placed still reads green — with the reason underneath it.
- **The intake screen separates two questions**: which entity HOLDS the file,
  and which company the document NAMES. They disagree in red.
- **Page attribution is driven by the paper, not the entity count.** The scope
  is built from entity names AND company names read from the documents. Two
  companies in one pile are never added together, even with a single entity in
  the case. A company the papers name that has no entity has its pages held
  back with a blocking item. One company named throughout is never held back:
  an entity called "Client 1" is a naming question, not a contamination risk.
- **A heading with no legal form is a candidate, not a name**
  (`entityNameGuess`). It takes part in attribution only once the case is
  known to hold two or more companies.
- **A form caption is never a company.** `isGenericCompanyName` rejects
  "foreign corporation", "any corporation" and Schedule M's own title, which
  had been read as corporation names and reported as second corporations to
  prepare. The name scan also skips `fs-schedule` pages, so a US return's own
  schedules cannot supply the CFC's name.
- **The agent can see the failures now.** Three risks added: a document read
  but unidentified (critical), money on pages that name no section (warn), and
  a set of accounts with no readable period (critical). Its "produced nothing"
  finding skips a document whose pages were kept for the company they name.

Measured on the documents in this session: the questionnaire PDF that read
2,440 characters and classified UNKNOWN is now a client questionnaire and
names the corporation; HMC's Shareholder Current Accounts page reaches Review
instead of vanishing; DELINK LIMITED no longer inherits HMC's 35 lines
(it books 0 and says so). Wiener, HMC and Ashley Elliott book exactly the
lines they booked before. `test:all` green except the pre-existing `test:peg`.

New suite `test:entscope` (15 assertions) pins page attribution, the fan-out
rule and the shape tests, and compares the shipped file with the source on the
same pages. New sentinels: EN9SHAPE2, EN9SHAPEFALL, EN9PASS4, EN9FEEDLOOSE,
EN9KINDPROMO, EN9NAMESCOPE, EN9GENERIC, EN9GENERICNAME, EN9COMPANYSCOPE,
EN9LOOSE, EN9HOMELESS, EN9PDFQUEST, EN9UNCLASSBLOCK, EN9READDETAIL,
EN9ENTCELL, EN9READCELL, EN9AGRISK2.

### 2026-09-23 (3) — the remaining UNKNOWN: boxed tax forms (uncommitted)

Two Chilean client documents still read perfectly and classified UNKNOWN. The
cause was not the title gate fixed earlier — it was that the pipeline had no
way to read the shape of document they are.

- **A numbered-box form carries no caption-and-amount rows at all.** The SII
  Form 22 prints the caption on one line and the box CODE and the AMOUNT on
  the next, so every test that looks for a caption beside a figure returned
  nothing: 6,249 characters read, `amountRows` 2, every shape test failed.
- **The pairs were already being rebuilt and then thrown away.**
  `stackedCaptionRows` has rebuilt them from page geometry since the Chilean
  work in 2026-09-04, into `parsed.grid` — and only a `trial-balance`
  document ever reads the grid. A PDF is never a trial balance, so the
  figures existed and nothing could reach them.

Fixed, generally:

- **`src/prototype/wp/terms.ts` (new)** — the terminology layer. `DOC_TERMS`
  says what a document calls itself in seven languages and what that MEANS;
  `CAPTION_TERMS` gives 68 accounting captions their English, whole phrase
  only. `detectTextLanguage` votes on function words. All offline: no key, no
  network, nothing to wait for. Translation now happens BEFORE identification,
  because identification is what needs it.
- **`tax-form` page kind**, found two ways: the document says what it is
  (terminology), or `boxedFormPairs` counts code-then-amount pairs and needs
  no vocabulary at all. It is tested BEFORE the statement band, because a
  return prints statement headings inside its own boxes.
- **`boxed-form` feed.** The rebuilt pairs are mapped on the INCOME STATEMENT
  side only. A return states balance-sheet totals that a statement itemises,
  so those boxes go to Review — the 2026-09-04 decision not to auto-map them
  stands.
- **Tax year to income year.** "Año tributario 2025" is the 2024 income year.
  Derived, and said out loud in a note.
- **The company name on a form is a VALUE, not a heading.**
  `boxedNameCandidate` reads the line under "razón social" / "denominación
  social" / "company name"; single-letter runs are glued ("S P A" → "SPA");
  a leading tax identifier is stripped.
- **The document says whose it is, and that outranks the letterhead.** Page
  attribution now takes the document's own company name first: a form printing
  "CORP EDUCACIONAL CHARLIE BRAWN" against an entity called "CORPORACION
  EDUCACIONAL CHARLIE BRAWN LIMITADA" shares no substring, so page-level
  matching left every page unowned and both companies were read into both
  work papers.
- **Dots as thousands, decided per document.** A value with two or more dot
  groups can only be dots-as-thousands, and that settles the ambiguous
  single-group values in the same document: 622.624 was booked as 622.62.
  `dotThousandsDocument` is language-free and now decides for the grid reader
  and the positioned reader alike.
- **One name comparison everywhere.** The agent compared names by substring
  while the scoping used `entitySimilarity`, so it raised a cross-entity
  block against a document the tool had correctly kept.

Measured: both Chilean documents now classify `cfc-tax-return` (Spanish,
identified by "impuestos anuales a la renta"), two entities are created and
fully isolated, and 16 and 15 schedule lines book with the original caption,
its English, the value and the source document all recorded. Wiener, HMC,
Ashley Elliott and DELINK book exactly what they booked before. `test:all`
green except the pre-existing `test:peg`; `test:entscope` is 21 assertions,
eight of them comparing the shipped file with the source.

New sentinels: EN9TERMS, EN9TAXFORM, EN9TERMSHAPE, EN9TAXMETA, EN9BOXED,
EN9TERMWRITE, EN9DOTTHOU, EN9NAMEKEY, EN9BOXNAME, EN9GLUE, EN9FEEDBOX,
EN9DOTDOC, EN9SAMECO.

### 2026-09-24 — Documents and Review & log, UX only (uncommitted)

No OCR or document-processing logic was touched. The changes are in
`layer-src/enhance.js` (DOM structure) and `layer-src/enhance.css`, re-injected
with `npm run inject:layer`.

**What the OCR flow actually does, confirmed before changing anything.**
`EN9ocrIntakeTick` probes every new PDF at upload and starts OCR on the pages
with no text layer; `EN9autoOcrTick` is a second net for a scan that reached
processing unread; `EN9OCRGATE` holds processing until the reading is done.
The service address is discovered automatically (this server, then
127.0.0.1:847/8472) and, failing that, PaddleOCR runs in the browser with
Tesseract.js behind it. So the address field and the run-by-hand controls are a
fallback, never a requirement — and the manual path is genuinely useful (a file
detection missed, specific pages, another language, re-reading pages that
already carry text). Nothing was removed.

- **The OCR card is a status line first.** Heading, one status word
  (Not needed / Processing / Completed / Needs review, from the jobs and the
  OCR sidecars the app already holds), one sentence, and the live job list.
  Everything else — engine names, the privacy model, the service address, the
  entity/file/pages/language controls, the drop area and the result actions —
  moved inside a closed `Advanced · run OCR by hand` disclosure. The card no
  longer competes with the dropzone above it.
- **Empty is empty.** The status line and the job list collapse when they have
  nothing to say, instead of holding open a band of white space.
- **The advanced controls are fluid.** Fixed pixel widths on the service
  address and page inputs pushed them past the card on a phone.
- **Documents understood.** The filename is a heading that wraps
  (`overflow-wrap:anywhere`) and the badge keeps its size instead of being
  squeezed out of the card; the meta line is one chip per fact.
- **The year-check table measures ITSELF.** The panel lives in a column whose
  width has nothing to do with the viewport, so the old viewport media query
  left five columns wider than the card and `overflow:hidden` clipped the last
  one. It is a container query now: above 558px the grid reads as a table,
  below it the same markup stacks into labelled rows. No font size was reduced
  and nothing is hidden. A `@supports` fallback scrolls instead.
- **The tax-year chain had no CSS at all** — "Detected2025, 2024›Work paper
  year2025". Labels and values are now spaced and weighted.

Verified in Chromium against the shipped file at 2200, 1600, 1440, 1180, 1024,
900, 768, 600, 414 and 360 px, with documents uploaded and processed: zero
elements outside their container, zero clipped scroll areas, no console errors.
The disclosure is closed by default and holds all 11 original controls.
`test:layer` 29 groups pass.

### 2026-09-24 — dated year headers and payment-processor fees (uncommitted)

Two client-reported defects, both fixed at the root and in both trees.

**1. A column header that names a year without printing it bare.**
`detectRulers` accepted only `/^(19|20)\d{2}$/`, so the HMC balance sheet,
headed `NOTES | 31 MAR 2025 | 31 MAR 2024`, got no ruler: every row reached
`routeRow` with no year, returned `"ambiguous"` and went to Review. Twelve
balance-sheet lines were unbooked, and the two rows whose comparative column
printed a dash collapsed to one value and were booked as CURRENT year
(Unearned Income 24,690 and Shareholder Current Accounts 1,385, both FY2024).

This was a **src/dist parity gap, not a live defect**: `dist/index.html` has
carried `EN9_HY` / `EN9_CYW` / `EN9_PYW` since commit `c18f5cd`, so the shipped
app always read those headers. Only the source tree was behind, which made
src-based testing report gaps the client never saw. Now back-ported:

- `engine.ts` — `headerYear()` (bare year, `FY24`, `FY'24`, a dated caption
  once the date, period and month words and a trailing currency code are taken
  out; refuses anything with a remainder, two years, or a two-decimal tail),
  `CY_WORD`/`PY_WORD`, `resolveWordRulers()` (turns the −1/−2 placeholders into
  real years, and DROPS the ruler when the engagement years are unknown rather
  than guessing), `inheritRulers()` (a continuation page up to three pages
  below its header, within its own feed).
- A non-bare header needs a second year column to agree, so a lone statement
  title cannot rule a page.
- `store.ts` — `resolveWordRulers(detectRulers(pdf), caseYears)` and
  `inheritRulerFrom: inheritRulers(...)` on the is / bs / unassigned reads.
- `tests/test_year_header.cjs` (`test:yearhdr`, 8 groups) pins the reading and
  the src↔dist parity. NOTE: jsdom returns cross-realm arrays, so dist results
  must be `JSON.parse(JSON.stringify(...))`-ed before `deepStrictEqual`.

Claycomb FY2025 now books 46 lines, 9 unmatched (was 35 / 22). Schedule F
column (b) carries all 13 figures and ties to the statement.

**2. "Paypal Fees" booked as cost of goods sold.**
The payment-processor keywords lived in the line-2 "other costs" group, so Rise
Digital Marketing's $20.87 reached Schedule C line 2 instead of other
deductions. A blanket move would have been wrong: the SHORI QuickBooks chart
prints `4500 Shopify Payment Fees` INSIDE "Cost of Goods Sold" and the
hand-prepared paper agrees. So the statement's own banner decides.

- `engine.ts` — `PROCESSOR_FEE_KW` + `isProcessorFee()`, named once; the
  catalogue group now targets `IS:OD`, carriage/freight keeps `IS:12`.
- `store.ts` — beside the `patentes` override: a processor fee printed under a
  cogs banner goes back to `IS:12`. Mirrored in `dist` as `EN9FEECOGS` and in
  both test harnesses.
- **Retargeting needs a migration, not just a version bump.** Adding a group
  cannot fix a caption the saved catalogue already claims for the wrong line.
  New `RULES_MOVED_SINCE` (dist `EN9RULESMOVED`) takes the keyword off the
  group it is moving OFF and adds it to its new target, and is applicable only
  while the keyword is still on the old line — so a current catalogue is
  returned untouched, by reference. `RULE_CATALOGUE_VERSION` 9 → 10, with
  `"paypal fee"` registered in `RULES_ADDED_SINCE[9]` for catalogues that never
  had the group at all.

New dist sentinels: `EN9FEEOD`, `EN9FEEFN`, `EN9FEECOGS`, `EN9RULEMOVED`,
`EN9RULEMOVE`, `EN9RULEMOVE2`; `EN9_HY`, `EN9detectRulers`, `EN9isProcessorFee`
and `EN9FEEKW` exposed on `window.__EN9MAP`.

Suite: 64 scripts, all pass except the documented pre-existing `test:peg`
("the approved prior-year end rate outranks a prior return's printed rate",
0.833 !== 0.82 inside `openingRateFor`) — confirmed failing on the unmodified
tree as well.

### 2026-09-24 (2) — Thompson / Boating Made Easy findings (uncommitted)

Tested the delivered Boating Made Easy Ltd. work paper against the QuickBooks
exports and the reconciled manual paper. The current-year P&L and balance sheet
are right to the cent (other deductions 254,161.06, net income 12,875.74, the
balance sheet is a summary and the tool booked all of it). Two silences were
not right, and both are now spoken.

**Schedule M shipped blank with no reason.** The books-only inference is
deliberately narrow — sole shareholder, majority filer — because with two
holders the counterparty is a guess. Correct, but the work paper went out with
an empty Schedule M and nothing to say why, and 72,067.40 of wages was booked
on Schedule C line 11. New `schm-compensation-not-inferred` (warn): names the
amount, converts it at the year-average rate, says whether the reason is the
shareholder count or a missing questionnaire, and points at line 19 (what the
corporation PAID) with line 6 as the alternative the preparer's paper may use.
It never guesses the counterparty. Mirrored as `EN9SCHMBLANK`.

**A negative opening ASSET carried in silence.** The prior return seeded
−36,173.86 onto other current assets (Sch F line 16 column (a)), which made
opening assets equal opening retained earnings and left the column out by 0.01
— the only symptom was "Schedule F does not balance at the beginning of the
year", with no indication which line was wrong. An asset is negative only in a
contra account, and those already carry `negate` in `boyMap`; anywhere else it
is a liability read from the wrong column of that return. New
`cf-negative-asset-<row>` (warn) names the line and the figure. The value is
still carried exactly as filed — a carried balance is evidence, not ours to
correct. Mirrored as `EN9NEGASSET` / `EN9NEGASSET2`.

Already handled, left alone: ownership 100% on Basic Information against 50%
from the shareholder register raises `cf-ownership-mismatch` (both this client
and Rise Digital Marketing), and Country of Incorporation reads correctly
("Cayman Islands", KYD, pegged 0.833).

Tests: `test:schm` 13 groups (the two-shareholder and minority-filer cases now
assert the explanation, and a pre-filled schedule must NOT also complain),
`test:boy` 24 groups (the negative-asset detection, the contra accounts and a
negative liability, plus a src↔dist presence guard). Suite 64 scripts; only the
documented `test:peg` failure remains, confirmed pre-existing.

### 2026-09-25 — dot-grouped thousands reached the shipped grid reader

The Charlie Brawn work paper generated from the 24-Sep bundle booked box 1588
"Otros ingresos percibidos o devengados" 49.943 as **49.94** and box 1424
"Otros gastos deducibles" 622.624 as **622.62**, on the same form where
928.368.104 came out right. A third src/dist parity gap:

- `numeric` / `numericCell` in dist took NO options argument, while the grid
  reader `Jv` (extractRows) had been mirrored and was already calling
  `Oa(String(d),{dotThousands:EN9dt})`. The object was silently dropped, so
  the document-level opt-in never reached the parser. Both now take the flag
  and normalise either shape (boolean or `{dotThousands}`), because callers in
  the bundle use both.
- `EN9dotDoc` mirrors `dotThousandsDocument`. The positioned reader already
  had its own page-level test (`EN9clNum`) and is unchanged.
- A single dot is still a decimal point on its own. It becomes a thousands
  group only when the document elsewhere prints two or more groups, which no
  ordinary decimal statement does.

Verified in the shipped bundle: `Jv` on the three real captions returns
928,368,104 / 49,943 / 622,624, and on `["Sales","1.234"]` still returns 1.234.

Three snapshot tests pinned the old one-argument signatures and broke:
`test:stacked`, `test:swiss` and `test:detect` now locate `Ii` and `Oa` by
NAME, and `tests/detect_test_src.cjs` carries the refreshed chunks. Pinning a
parameter list was pinning the wrong thing.

### 2026-09-25 (2) — one figure, read twice off one page

Collaborate and Eight B.V. 2024 (scanned Dutch annual statement, OCR at 93.3%)
booked gross receipts 31,212 where the face says 10,400: the catalogue booked
"Net turnover 10,400" from page 10, and the OCR of the SAME page also yielded
the fragment "Gross 10,400", which the model proposed for the same line. Both
were added. Same document, same page, same line, same amount is the same
money, whatever caption the reader attached to it.

`figureAlreadyBooked(contributions, target, row)` (dist `EN9dupFigure`) is
consulted before BOTH places that book a model proposal — the AI mapping pass
and the agent-suggestion pass — and the proposal is refused with the figure
and the page named, so the preparer sees why it was not added.

Deliberately narrow, because a second reading is the only thing being stopped:
- the RULES path is untouched, so two different accounts that happen to print
  an identical figure still book separately;
- a different page is left to the existing `dupe-page-*` rule, which reports
  it in its own words;
- a different document, a different line, a zero, or a one-cent difference all
  book normally.

`test:dblread` — 12 groups, including a src↔dist answer-for-answer comparison
of the guard. The existing page-dupe rule is unchanged.

### 2026-09-25 (3) — the cross-page echo

The other half of the Wendorf double counting: "Interest 2,468" on the profit
and loss and "Interest 4% a year 2,468" in the note beneath it, and "Wages and
salaries 65,868" (p.10) with "Wage tax 1,032" (p.16) — the same money reaching
one line from two pages under two captions.

The existing `dupe-page-*` rule only fires on an IDENTICAL caption, where
counting once is safe. With different captions the rules cannot tell a note
restating the face from two real accounts that agree to the cent, so the
figure is booked as read and a WARN item (`echo-page-*`, `applied: true`)
names both captions, both pages and the amount the line would be overstated
by. Dropping it would be a guess; saying nothing is what produced the
complaint. Mirrored as `EN9ECHOPAGE`.

NOT fixed, and not fixable without the source PDF: on that document the notes
pages (14–18) fed the income-statement mapping at all, which is how balance
sheet captions ("Issued", "Subscribed", "Other reserves", "Long term loan")
and a date read as 312,024 reached Schedule C other deductions. The design
already says notes restate the face and are not booked; those pages were not
classified `fs-notes`. Needs the scanned statement to reproduce.

### 2026-09-25 (4) — Schedule B Part I: one cell holding both share counts

TEZCATLIPOCA's prior return prints Part I as
`TODD A WIENER | COMMON | 2,999.000 2,999.000` — the two counts in ONE cell,
because nothing but white space separates the columns. The shipped Part I
reader (`EN9parseUsShareholders`) classified the whole cell with numericCell,
which read it as the single number 2999.0002999, saw fewer than two figures on
the row and skipped the holder. The U.S. Shareholders block came out empty
while Part II — which splits on white space before reading — was right.

Fixed in dist (`EN9P1TOK`): a cell whose whitespace-separated tokens are ALL
numbers contributes each token, so the glued pair reads as 2,999 and 2,999.
Anything else is classified as before. `test:usshare` covers the glued pair,
the separate-cell shape that always worked, and a name that carries a number.

This is the FOURTH src/dist parity gap found the same way. The source tree has
its own Part I path (`scanHolderRows(partI)` via `parseSharePair`, which has
always split on white space) and never reproduced it — as with the dated year
headers, the dot-thousands flag and `setRelabel`. A src-only test cannot see
these. Everything below was therefore verified by driving the SHIPPED
dist/index.html headlessly with the real client documents.

#### End-to-end verification on the shipped file (2026-09-25)

| Client | Checked | Result |
|---|---|---|
| Claycomb / HMC | dated column headers | 14 Schedule F lines, boy AND eoy, ties to the statement |
| Elliott / Rise | Paypal Fees $20.87 | books to IS:44 (other deductions); IS:12 empty |
| Santmyer / Charlie Brawn | dot-grouped thousands | 49,943 and 622,624, not 49.94 / 622.62 |
| Wiener / TEZCATLIPOCA | Schedule B Part I | TODD A WIENER 2,999 / 2,999, Subpart F 99.97% |
| Wiener / EL KIJ | Schedule B Part I | TODD A WIENER 2,970 / 2,970, 99% |

#### FIXED — Cecilia's own pages excluded from her entity (dist only)

With BOTH Chilean statements loaded onto ONE entity, and the second company
created by fan-out, Cecilia's log reads
`b1e34a21-…: 2 page(s) excluded (belong to CECILIA GONZALEZ ACUNA S P A)` —
her own document is attributed to a DOCUMENT company rather than to her, and
she books nothing from it (8 carried opening balances only). Charlie is
correct. src does not reproduce it: there the same set gives Cecilia 8 booked
lines and excludes only Charlie's pages.

`entitySimilarity("CECILIA GONZALEZ ACUNA SPA", "CECILIA GONZALEZ ACUNA S P A")`
is 1, and `EN9_norm`/`EN9_vars`/`EN9_attr`/`Wh` are byte-identical to src, so
the company comparison is not the cause. Re-processing does not clear it:
`processedAt` does not change, so the second run appears not to start — that is
the next thread to pull.

The first attempt (let an unnamed entity keep pages owned by a document
company) was written, tested and REVERTED: it made Cecilia book CHARLIE's
figures — 928,368,104 of gross receipts in both work papers. Cross-entity
contamination is worse than an empty schedule.

The actual cause, found by logging the scope into the entity's own log:
processing an entity that was the only one in the case gives it every page,
so attribution never runs. The tool knows this and re-reads the parent after
the fan-out (`/*EN9REPARENT*/await Be.processEntity(t)`), and THAT run is what
keeps each corporation's pages to its own work paper. But the shipped build
asks the preparer to confirm a re-process — right for a button press, wrong
for the tool re-reading its own work. The modal appeared mid fan-out, and a
Cancel (or a headless browser, which answers no) abandoned the re-read. The
parent kept the first pass's scope, where it was still called "Entity 2",
was therefore absent from the company scope, and had BOTH statements
attributed to document companies.

Fix (`EN9REASKFAN`): the confirm is skipped while `d8` — the fan-out flag —
is set. It is set for exactly the length of the self-read, so it is the honest
test of "the tool asked for this, not the preparer". The prompt itself is
unchanged for a preparer pressing the button.

Verified on the shipped file with the real documents: Cecilia re-processes
AFTER her sibling and books her own 1,973,582,648 / 703,095,833 / 779,000,384
/ 97,509,381 / 31,464,925 / 115,585,728 / 59,235,438 / 184,913,638, excluding
only Charlie's two pages; Charlie excludes only Cecilia's. Neither carries the
other's figures. `test:entscope` pins the guard and that the preparer's own
prompt survives.

### 2026-09-30 (19) — Catherine Mancuso / Blue Water Grill: 18 gaps fixed (both trees, uncommitted)

Owner decision: a staff-cost group goes to line 11 (compensation) as ONE group,
even under Cost of Sales. No template rows are added (1a/line 2 stay single
lines; detail lives on Provenance/Attached schedules).
- Sections: cash group opens only on the assets side (`EN9CASHSIDE`); "long-term
  assets" is a fixedAssets banner; a narrow group's total returns to the banner
  that held before it (`opened` stack / `EN9CLOSEBACK`).
- Catalogue v15 (`EN9RULEVER=15`, `EN9RULEV15A-D`): checking/bank checking/cash
  on hand → BS:10; staff loan/due from → BS:OCA (due from shareholder/director
  → BS:19); equipment rental/lease payment → IS:27; donation → IS:OD; business
  tax → IS:32; furniture and equipment → BS:28. `payroll → IS:OD` unchanged.
- Group heading inheritance: `tagStatementGroups` also sets `groups` (dist
  `EN9gchain`), every group a "Total <heading>" line proves, incl. outer,
  innermost first — NOT "summary of the rows beneath it" groups (OCR indents;
  Romy regression) and never a total row itself. Booking loop
  (`EN9GROUPHEAD`, `EN9HEADAFTER`): order = rules → banner veto → banner
  route → heading (only when still unplaced) — heading before the banner
  route broke 2Hats (referral fee → 1a, directors → 17) and HMC (contract
  labour → purchases). A heading → IS:26 overrides a child's IS:OD/10/11/12
  from a rule or the cogs catch-all (info `group-compensation-*` under cogs).
- Rent under a Cost of Sales banner stays cost of goods sold (`EN9RENTCOGS`;
  Martinez "Equipment rental" 177,409.50).
- Questions/flags (`EN9CAPQ`): `business-tax-question-*` (BLOCK: remap to 21a
  or acknowledge to keep line 16); `freight-in-cogs-*` (info); `due-from-
  related-*` (warn, non-zero only). A remap answers/removes them
  (`EN9REMAPANS`).
- Shared pool row label counts group members joining it (`EN9POOLCOUNT`).
- BOY/EOY: an EOY-only BS line equal (±rate×1.01) to a BOY-only line the prior
  return opened on the same side moves to the prior-return line (`EN9BOYALIGN`,
  info `boy-eoy-line-*`). Mancuso: Due to Shareholders 18 → 19.
- Dividends: `equityDividendLine` returns the dividends ACCOUNT movement —
  opening from the statements' prior-year column, else (unclosed books: RE
  account + result line, BOY RE from prior return) RE account − filed RE
  (`EN9DIVMOVE`, message `EN9DIVMOVEMSG`). `distributionSplit` (dist
  `EN9distSplit`): Schedule R one row per direct holder when ≥2 holders and
  all are U.S. shareholders (`EN9SCHRSPLIT`, edit `EN9SPLITEDIT`); Schedule M
  E32 uses the filer's direct share (`dividendShareOfFiler`/`EN9divShare`).
- Schedule Q H57/J57/X57 = VALUES of Sch C line 10 − 8a / line 18 / 21a,
  computed in buildWrites at GENERATION (dist `EN9SCHQLATE`), so a remap made
  after processing reaches them; materialize only raises `schq-figures`
  (`EN9SCHQFIG`). Not formulas: `test:gen` pins that the cell builder emits
  <f> only for =B11. Schedule H donations add-back is OFFERED, not written
  (warn `schh-nondeductible`, suggestedValue; confirming it writes C21/E21,
  `EN9SCHHNDWRITE`): HMC's reviewer leaves a 114,000 donation in E&P, BWG's
  adds it back.
  `hte-candidate` warn when 21a / pre-tax > 18.9% (`EN9HTE`); election never made.
- A/B 10 clients (Wiener ×2, Andrew Ban, 2Hats, HMC, Joyce, Veillon, Rise,
  Santmyer ×2, Romy, Martinez) + Kelt: identical except the new Sch Q values
  and Martinez "IT Equipment 88,184.25" now on 9a (was unassigned).
- Live dist run on the two PDFs (+ preparer remaps business tax → 21a, freight →
  office): every Sch C line and Sch Q equal the reviewed WP (1a 4,058,232.50; line 2
  1,958,153.64; 11 899,920.74; 12a 129,154.12; 17 761,285.23; 21a 71,019.07;
  22 238,699.70); Schedule F EOY balances at 483,365.40; Sch H E&P
  240,118.86 before the Sch E row question; Sch Q matches.
- Left, reviewer choices: tax on Sch E row 16 (tool) vs Part III row 38 +
  HTE election (reviewer) → Sch H 2g / 8992 differ until elected (flagged);
  Sch H G27 (reviewer 240,119, Kelt reviewer 0); reviewer's line-17 categories
  ("Upkeep"…), prepayments/loans lumped into Cash, all CL on line 15; Sch M
  65,456/25,000 not in the documents; prior return not supplied, so dividend
  movement (derives 352,943.90 vs reviewed 352,941.18) is unit-tested only.
- Tests: suite 77 scripts, 76 pass (`test:peg` as at HEAD); new `test:mancusor19` (9) + fixture `bwg_rows.json`; `test:keltr18`
  version assertion widened; `test:boating` OD 254,161.06 → 253,361.06
  ("Equipment rental" 800 → line 12a; no Boating reviewed WP exists).

### 2026-09-30 (20) — Tanya / Santmyer (Form 22) / Sean (Collaborate and Eight): verified, then fixed (both trees, uncommitted)

Each item was reproduced on the documents first; only confirmed items changed.
- COGS section guard: a cost-of-goods target (IS:10-12) on a row printed under
  the statement's Expenses banner goes to `sectionRoute("costs")`/IS:OD unless
  the caption itself names cost of sales/stock (`EXPLICIT_COGS`, dist
  `EN9COGSGUARD`). Boating "Shipping and delivery expense" → line 17 (Unison WP);
  Martinez shipping 619.96 moves the same way.
- Numbered-box returns read by CODE: `boxedFormCodes(pdf)` (span code → next
  code; caption only for display) + `BOXED_FORMS` table (`cl-f22`: book codes,
  balance codes 122/123/784/647/844|1494/843, distributions 1182/1699, result
  1672 or 1410+1426−1430, tax-basis note). dist `EN9BOXCODE`, `EN9FORMCODE`.
  Codes outside the table are listed in `boxed-form-*` info and never booked or
  sent to AI. BS totals are booked (`form-bs-totals-*` warn, request detail)
  ONLY when no statement itemises the BS (step 3, `EN9FORMBS`): cash, fixed
  assets 9a, rest → line 13 (BS:39), 123 → line 19, capital → 20b, RE =
  balancing figure; 843 mismatch named. MapRow `formTarget` fixes the line
  (`EN9FORMTGT`). Distributions → `equity.dividendsCY` (Dividends, Sch J 9,
  Sch M, Sch R) + warn `form-distributions-*` (Cecilia reviewer instead kept
  them as shareholder current accounts — conflict reported, not coded).
  `tax-basis-*` warn "Not GAAP book income: confirm or adjust."
- Result checks (block, validateEntity): `form-result-mismatch` (entity
  `formResults`, pre-tax = NI + 21a + 21b), `pnl-net-income-tie` now BLOCK,
  `schf-total-assets-tie` (statedResults feed "bs" from a "Total assets"
  caption, `TOTAL_ASSETS_CAPTION`/`EN9TACAP`). (The placeholder-note filter
  added here was removed — see the owner decision below.)
- Tax-register captions (`isTaxRegisterCaption`: RAI/REX/SAC/STUT/CPT/RLI/PPM,
  pérdidas tributarias, renta líquida imponible…) refused in the AI and agent
  passes (`EN9TAXREGAI`, `EN9TAXREGAG`).
- Carry-forward `matchFormLine`: a figure glued onto the caption cell is taken
  when ≥4 digits/grouped (`EN9GLUEDTAIL`). Charlie Sch J F15 −118,306,568 and
  Wiener EL KIJ −3,029,900 now carried.
- Ownership: item C/Part I absent → filer's Sch B shares ÷ all shares
  (`EN9OWNSHARES`; Sean 100%). Charlie stays 20%/CFC No: prior Part II marks
  the other holders NRA (958(b)(1)); Joyce precedent 40/No — reviewer 60/Yes
  is a DECISION for the owner, not changed.
- One prior-year rate: opening column already uses C61; fx-prior-rate message
  corrected; `fx-opening-rate-stale` block when C61 changed after processing.
- Profile: caption rows (all captions, figures beneath) never read across and
  never become AI candidates; values under caption i (pair or same position);
  "Comuna" → city, "Región" → addr3 with CL region-number names
  (`EN9CAPROW`, `EN9cleanRegion`); AI profile values equal to another caption
  refused (`EN9AIPCAP`).
- Classify: OCR-tolerant "profit and [l1i|]oss"; "Notes to the balance sheet /
  P&L" titles → fs-notes (`EN9NOTESTO`); a run of notes continues onto untitled
  pages only after such a title and only when face BS+P&L exist
  (`EN9NOTESCONT`; general "notes to the financial statements" does NOT run on
  — HMC's pages 16-18 are supplementary); covering letter (salutation, ≤2
  amount rows) → fs-cover inside the fs band (`EN9LETTERCOVER`); fiscal
  position/tax computation → fs-notes. Root cause of Sean's lost banners: notes
  pages in the BS feed repeated "ASSETS"/"LIABILITIES", so the furniture filter
  stripped the face banners.
- Rows: "[12]" note refs are never numbers (`EN9NOTEREF`, brace-free regex in
  dist for test extraction) and are stripped from labels (`EN9NOTEREFLAB`);
  OCR comma slip "-5.691" on comma-grouped whole-number pages (`commaSlipPage`,
  `EN9COMMASLIP`). Legal name strips "To the directors of / For the attention
  of / Reference:" (`EN9SALUTE`). `isProfitLine` accepts "result after taxation".
- Catalogue v16 (`EN9RULEV16A/S`, RULES_ADDED_SINCE[15], SKIP_ADDED_SINCE[15]):
  SKIP result before/after taxation, operating result, gross operating result,
  (total) financial income and expenditure, net result; housing → 12a;
  interest and similar expenditure/income → 13/5; currency/payment/exchange
  differences → 8a; selling/office/general costs → 17; debts to participants /
  shareholder loan → 18 (+ `schm-shareholder-loans` warn, `EN9SCHMLOAN`); debts
  to credit institutions, accrued liabilities, taxes and premiums social
  insurance → OCL.
- Space key (Entities & Documents): NOT REPRODUCED — no change.
- Retest: Santmyer both CFCs book every Form 22 box by code, result ties
  (197,796,083 / 203,962,026), BS totals balance, Cecilia 21a 53,367,454 and
  distributions 100,000,000 → Sch J/R; Sean (OCR path) face-only: 19 lines,
  Sch F 8,313 both sides, NI −75,460 vs stated −75,458 (2 = OCR-split interest
  income); Tanya shipping → 17. A/B 10 clients: only intended diffs (Santmyer,
  Wiener Sch J carry, Martinez shipping). Kelt/Mancuso workbooks identical.
- Tests: 78 scripts, 77 pass (`test:peg` pre-existing); new `test:round20`
  (13). Updated: `test:profile` (Comuna → addr2), `test:mancusor19` (version
  ≥15), `test:detect` snapshots (EN9NOTEREF/LAB, EN9COMMASLIP).
- Open: reviewer used ledger detail for Santmyer (P&L/BS differ from the Form
  22 by basis — flagged); Charlie ownership decision; F22 box 123 vs book
  liabilities (Cecilia) needs the trial balance.
- Follow-up (Mancuso feedback 2): outbound delivery/shipping printed under
  cost of sales → line 17 (`OUTBOUND_DELIVERY`/`INBOUND_FREIGHT`, info
  `delivery-to-deductions-*`, dist `EN9DELIVERY`); freight on purchases,
  customs, duty stay in COGS. Taxes in place of income tax
  (`IN_LIEU_INCOME_TAXES`: Belize/BZD "business tax") move line 16 → 21a
  after the profile is read in step 3 (`inLieuIncomeTax`, dist `EN9INLIEU`),
  replacing the `business-tax-question-*` block with info `in-lieu-tax-*`;
  a preparer's remap wins. Currency read from country-prefixed dollar signs
  ("BZ$", `EN9DOLLARPFX`). Mancuso with no remaps: line 2 1,958,153.64,
  17 761,285.23, 21a 71,019.07, Sch Q 2,100,078.86 / 1,790,360.09 /
  71,019.07 = reviewed WP. A/B 10 clients identical; suite 78 scripts, 77
  pass (`test:peg` pre-existing); `test:round20` 16.
- Owner decision (2026-09-30, supersedes the round-20 placeholder filter):
  the unblock reason is NEVER an obstacle. `dismissReviewItem` accepts any
  text or none (empty → "Acknowledged — no reason given"; dist `EN9ACKANY`);
  `RECONCILE_BLOCKS`/`PLACEHOLDER_NOTE` removed; the layer popup's reason is
  optional (layer-src/enhance.js, injected). Thin notes are still marked on
  the Provenance sheet (`isThinNote`). Verified live: "", "test", "x" all
  acknowledge.

### 2026-10-01 (21) — Premium Care Plastic Surgery (Colombian PUC) + audit fixes (both trees, uncommitted)

- PUC statements: expense/income headings are banners (`sectionBanners.ts`
  +5, dist `EN9PUCBANNERS`; lexicon now 54); catalogue v17 (`EN9RULEV17A/S`,
  RULES_ADDED_SINCE[16], SKIP_ADDED_SINCE[16]): "resultado bruto/operacional/
  antes de…" SKIP; advances (antic. a trabajadores, anticipo de impuestos) →
  OCA; payroll liabilities (cesantías/vacaciones/primas consolidadas, ret. y
  aportes de nómina, retención en la fuente, anticipo de clientes) → OCL;
  impuesto de renta → 21a. Abbreviated captions ("ANTIC.", "Depr.") are not
  prose. Sundry creditors ("acreedores varios/diversos") STAY on accounts
  payable: the Wiener reviewers and their filed prior returns put them there;
  the Campbell reviewer used line 17 (reviewer conflict, reported).
- Row reading: a hidden cents column (`strayCentsColumns`, dist `EN9STRAYCOL`)
  is skipped; a cell holding two figures ("0 21,170,247.42") is never one
  number (`multiNumericTokens` → numericCell null, dist `EN9MULTITOK`); row
  readers split it per figure. Prior-return readers in carryForward read such
  cells figure by figure (`cellNums`/`figureCells`, dist `EN9CFNUMS`) — without
  this Tezcatlipoca lost its carried Sch J line 14 (−18,582,369).
- `outsidePrintedTotal` (sections.ts, dist `EN9OUTTOTAL`, after
  sameIndentSubtotals): under a total-worded row whose group does not add up,
  the ONE row equal to the whole gap is left out and raised as warn
  `outside-total-*` ("DEUDORES 82,600,026" outside "TOTAL DEUDORES"; the
  duplicated "(-) Depr. Acumulada"). Guard: if a positive row explains the gap
  as a subtraction (sum − 2·row = total) nothing is excluded.
- Contra lines 2b/9b/10b/12d (BS:12/29/31/37) are booked negative with info
  `contra-asset-*` (`CONTRA_ASSET_LINES`, dist `EN9CONTRAASSET`/`EN9CONTRAL`).
- No prior return: when equity prints the year's result on its own row equal
  to booked net income, the other retained-earnings rows (dividend rows
  excluded) are the opening balance → Sch J F15 and RE tab F10 (warn
  `book-opening-ep`, dist `EN9BOOKOPEN`). RE F10 holds a template formula, so
  the write carries `replaceFormula: true`, honoured at generation
  (`mayReplaceFormula`, dist `EN9FMLFORCE`). Pre-existing: the prior-return
  `re-rollforward` F10 write is still refused by the formula guard.
- REVIEWER CONFLICT (owner decision needed): the same QuickBooks caption
  "Freight and delivery - COS" is line 17 in the Mancuso reviewed WP and COGS
  (Other costs 126,800.63) in the Kelt reviewed WP. The round-20 delivery rule
  (line 17) is kept because Mancuso's was explicit feedback; Kelt now differs
  by 76,693.12 between COGS and line 17 (net income unchanged). The info item
  `delivery-to-deductions-*` offers the one-click move back.
- Audit fixes: `pnl-net-income-tie` names booked rows that alone explain the gap
  (`tieSuspects`, dist `EN9TIESUSP`); Schedule F balance blocks
  (`EN9-tie-bs-eoy/boy`) now exist in src validateEntity too (`bsBalance`) and
  both trees name the line whose amount alone explains an imbalance
  (`bsSuspectText`, dist `EN9BSSUSP`); src `GROQ_MODELS` = gpt-oss-120b/20b
  (matches dist; retired Llama/Qwen removed; loadState migrates a saved one).
- Scorecard: `npm run scorecard -- <reviewer.xlsx> <tool.xlsx> [--sheets]
  [--cols F] [--json]` recalculates the tool workbook with LibreOffice, pairs
  rows by caption (LCS), scores lines. Client files stay local.
- Campbell (inputs: bs.pdf, is.pdf only; COP avg 4,072.15 entered): IS ties
  (deductions 90,666,928); Schedule F balances (221,841,062 both sides);
  9a 239,472,448, 9b −81,142,564, receivables group 63,493,000, OCL group
  182,497,560 (= reviewer's line 17 total), RE −60,656,498; Sch J 1a
  30,010,429 (reviewer typed 30,310,429 — the BS says 30,010,429).
  Remaining differences are inputs/policy: no prior 5471 (opening column,
  Sch M/E/Q/8992 reviewer facts), staff costs on line 11 vs reviewer line 17
  (HMC/Macroroots reviewers use line 11 too — owner decision), DEUDORES total
  on 2a (reviewer) vs other current assets (advances), CFC 50% vs "Assumed"
  100%.
- Tests: new `test:round21` (14); updated `test:spanish` (payroll liabilities →
  OCL), `test:sections` (54 banners; skip-branch window), `test:detect`
  snapshot chunks 1 and 5 re-extracted, `test:r17` (extracts EN9cfCells
  helpers). Suite 79 scripts, 78 pass (`test:peg` pre-existing).
- Retest on the final build: Campbell 12/12 key figures (was 4/12); 10-client
  A/B, Tanya, Sean identical to the previous build; Mancuso identical except
  RE tab F10 = 824,781.28 (= reviewer) and Sch J F15 824,781.28 (reviewer
  291,519 from a prior return not in the inputs); Kelt differs only by the
  freight conflict above.
