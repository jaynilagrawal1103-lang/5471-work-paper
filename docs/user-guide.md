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

### The AI Mapping & Review Agent

The leftovers go first to the **AI Mapping & Review Agent** — a LangGraph
state graph (gather → understand → suggest → terminology → critique → route)
running on the Groq key already configured in Settings ▸ AI platform. There is
no second key: the agent shares that one, and the Settings ▸ AI platform tab
shows only whether a key is present, never the key itself.

The agent reads what the earlier stages cached — the extracted text, the
section banners and any translations — and never re-reads a document. It
suggests a work paper line for each caption, with the document, page, figures
and its confidence attached; it checks the English used for translated
captions; and it reports information that is missing, conflicting or
ambiguous. Its confident suggestions are handed to the ordinary mapping gate,
which can still refuse them. Everything else — a low-confidence answer, two
captions proposed for one line, a caption with no figure — goes to the
Exception center with its evidence.

The agent reads the documents **before** the rules run: it records what each
document is, how much of it carried figures, what language it is in, and it
translates when translation is needed, so the rules map through the English
rather than a translation that arrives afterwards. It then names every figure
the pipeline would otherwise let past — one with no rule and no heading, or one
dropped as a subtotal although the caption never calls itself a total. Those
reach the Review tab with the agent's reason instead of disappearing; the
agent never books them itself.

After the mapping is booked the agent reads the balance sheet back and reports
what is missing: an empty Cash line, fixed assets that were read but never
booked, cost carried with no accumulated depreciation, and a balance sheet that
does not tie — naming the unbooked caption whose figure equals the difference,
so it can be fixed in one move. It also checks the period: a year end that was
assumed, or rolled forward from last year's return, or that contradicts the
period printed on the statements, is raised rather than left to be noticed.
This half needs no key.

Every item the agent flagged before mapping is then accounted for: booked,
waiting in Review, or — if neither — reported. Anything the agent could not
read, translate, understand or check is listed with the document, the page,
the reason and what you need to do about it. The **AI Agent activity** card on
an entity's Review & log tab shows all of it in order.

The agent never changes a figure, an exchange rate, a calculation or a
validation, and it cannot sign anything off. With no key configured it still
runs its document checks and reports the gaps it can find without a model.
Switch it off on the same Settings tab.

### The tax year check

Before anything is mapped the agent places every document against the year the
work paper is for: the year it reports on, the period it covers, whether it is
this year's figures or the prior-year input the opening balances come from, and
which work paper year it supports. A document whose year does not fit, or whose
year cannot be read, is flagged with its name and what to do — it is never used
on the quiet. The check is on the **AI Agent activity** card of an entity's
Review & log tab.

### The period the work paper is filed for

Basic Information B1 and B2 take the period end from the statements themselves
("for the year ended 30 June 2024", "as at 31 March 2025" — both date orders).
Only when no document states one does the tool fall back to a prior-year
5471's accounting period rolled forward, and only then to 31 December. Which
of the three was used is written in the field's own provenance line, and a
year end that was assumed or that contradicts the statements is raised as a
review item. The year end selects the exchange-rate tables and dates Schedules
E and J, so a fiscal entity dated 31 December is wrong throughout.

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
