# Form 5471 Work Paper — User Guide

> **Status: interim.** This Markdown guide replaces
> `5471-workpaper-user-guide.docx`, which predates the current UI and contains
> statements that are no longer true. The facts below are verified against the
> shipped app by `scripts/check-guide.mjs` (run in `npm run test:all`), so this
> file cannot silently drift. A full illustrated regeneration is planned; until
> then the in-app copy remains authoritative for anything not covered here.

## What the tool is

The tool populates **your** Form 5471 master workbook from client documents —
trial balances and statutory accounts — entirely in the browser. It maps each
caption onto the work paper's schedule lines, writes local-currency values into
the designated input cells only, and supplies the three exchange rates. The
template's own formulas compute every US-dollar figure.

## Navigation

The app has **16 tabs**: Executive overview, Task management, Portfolio
dashboard, Entities & documents, Entity workspace, Document intake,
Multilingual evidence, Ownership & category, Mapping & adjustments, FX policy &
rates, Workpaper preview, Workpaper readiness, Exception center, Audit trail,
Review & sign-off, and Settings.

## Documents

- Reads `.xlsx` `.xlsm` `.csv` `.tsv` `.txt` and text-layer PDFs.
- **PDFs are parsed locally, in the browser** (pdf.js, bundled — no CDN, no
  upload).
- **Scanned pages are detected at upload and OCR'd before processing.** Every
  PDF you add is probed page by page; pages without a text layer are read
  automatically — by the PaddleOCR service when one is running, otherwise by
  **PaddleOCR (PP-OCRv5) running inside your browser** — and **Process entity
  waits until the recognised text is in place**. Nothing needs installing for
  the in-browser engine. In the **offline build** (`index.offline.html`, made
  with `npm run build:standalone`) the engine and its models are packed into
  the file itself: double-click it and OCR works with no internet at all. The
  ordinary build downloads them once instead (about 36 MB, from
  cdn.jsdelivr.net and github.com) and keeps them in the browser. Either way
  the document never leaves your computer. A turned or skewed
  scan is put upright and straightened before it is read. If that download is
  blocked, Tesseract.js is the last resort and the sidecar says so. The service
  is found on its own: the app's own server (`/api/ocr/*`) first, then
  `http://127.0.0.1:8472` on this computer — so a page opened straight from
  disk still finds a locally started `python -m ocr_service`. The OCR card
  shows which engine will read; if the service runs elsewhere, type its
  address in the card's **Service address** box and press **Check**; type
  `off` to always read in the browser. A mixed PDF is OCR'd only on the pages that need it. The scan is
  replaced in intake by a searchable copy named `… (OCR).pdf`, its Read
  status shows **text read (OCR)**, and the review lists the engine, the
  pages and every reading the engines disputed — the primary engine's reading
  is kept, the alternative is offered, nothing is corrected silently.
- **Manual OCR** stays available on the OCR card of Document intake: pick an
  attached file or one from disk, name the pages (`auto`, `all`, `2,4-6`),
  and optionally re-read pages that already carry text. It uses the same
  service and the same fallback as the automatic path.
- A byte-identical re-upload of a document already attached to the entity is
  refused, because booking the same file twice would double every figure.
- Re-processing an entity asks for confirmation when results already exist.
  Your dismissed exceptions (sign-offs) are preserved; hand-typed schedule
  values are replaced by freshly extracted figures.

## Mapping

Processing runs multilingual keyword rules first, then — when a Groq API key
is present in Settings ▸ AI platform — one automatic AI pass over everything
the rules left behind (models: `openai/gpt-oss-120b`, falling back to
`openai/gpt-oss-20b`). Low-confidence AI results are booked **and** raised as
review exceptions; only captions the model rejects twice come back for manual
assignment. Structural subtotal/total rows detected in PDFs are dropped before
mapping so they are never double-booked.

## Exchange rates

Rates follow a fixed chain: bundled IRS yearly-average and US Treasury 12/31
tables first, then OFX daily data — a period average for the average rate, and
for date-pinned rates **the last rate published on or before the requested
date (10-day search)** — then the other configured live providers, then manual
entry. Every rate shows its source (IRS / Treasury / OFX / ECB / Manual)
throughout the app.

## Generation blockers

Generation is refused while:

1. any of the three exchange rates is missing, or
2. the balance sheet **does not balance** (assets vs liabilities + equity, per
   column). The balance block appears in the Exception center and **can be
   dismissed with a note** by the preparer — the acknowledgement is recorded in
   the audit trail and the workbook's Provenance sheet.

## Output

The generated workbook is your master template — all sheets, formulas, styling
and hidden tabs preserved — plus a **Provenance** sheet listing every value the
tool wrote (source document, rule or AI, confidence) and every exchange rate
with its source and date. Figures read by OCR carry three more columns — the
engine, its confidence and the position on the page the figure was read from
— and an **OCR DOCUMENTS** section names each OCR'd file, the scan it
replaced (with its SHA-256), the engines used and the number of disputed
readings.
