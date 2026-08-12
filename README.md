# Form 5471 Work Paper

Populates a Form 5471 master workbook from client documents, entirely in the browser.

The tool reads trial balances and statutory accounts, maps their captions onto the
work paper's schedule lines, and writes the values into **your** master template —
preserving all 19 sheets, every formula, the styling and the hidden tabs. It does not
create a new output format, and it never computes a US-dollar figure: the template's
own formulas do that from the three exchange rates the tool supplies.

Everything runs client-side. Documents are parsed in the browser and are never uploaded.

---

## Quick start

```bash
npm install
npm run build      # writes dist/index.html
npm start          # build, then serve dist/ on localhost
```

`dist/index.html` is the entire application — one self-contained file with the master
template, the exchange-rate tables and all code inlined. Open it directly, or drop it
on any static host.

---

## What it does

| | |
|---|---|
| **Reads** | `.xlsx` `.xlsm` `.csv` `.tsv` `.txt` and **text-layer PDFs** |
| **Maps** | 43 multilingual keyword rules onto Schedule C and Schedule F lines |
| **Detects** | Legal name, address, country, formation date, currency, ownership, categories |
| **Rates** | IRS yearly averages (2017–2025) and US Treasury 12/31 spot rates, 151 currencies |
| **Validates** | Refuses to generate while an exchange rate is missing |
| **Writes** | Only designated input cells; flags the workbook to recalculate on open |
| **Records** | A full audit trail, exportable as JSON |
| **Reviews** | Editable mappings and exceptions, policy-driven levelling, task board |

Multiple entities are supported. Each keeps its own documents and produces its own
workbook — Form 5471 is filed per foreign corporation, so nothing is consolidated.

### PDF extraction

PDFs are parsed by pdf.js, bundled and inlined at build time — no CDN, no separate
worker file, no network access; the worker runs on the main thread. Glyph positions
are reconstructed into rows and columns, so the existing mapping engine works on
PDFs unchanged.

A dependency-free fallback parser (the browser's own `DecompressionStream` for
FlateDecode) is kept for producers pdf.js rejects. It handles compressed object
streams, text inside Form XObjects, and Identity-H CID fonts with no ToUnicode map
(recovering characters by inverting the embedded TrueType `cmap` table).

Scanned PDFs have no text layer; the tool reports that plainly rather than returning
an empty result.

### Review workflow

Every caption can be re-bound to a different template line from **Mapping &
adjustments** (or sent back to the review queue) — the decision persists and
survives re-processing. Exceptions in the **Exception center** can be signed
off, or **edited and resubmitted**: the linked workbook cell takes the
reviewer's number and the audit trail records old → new. **Settings ▸
Policies** holds ordered rules that decide each exception's level (or
suppress it); suppressing a blocking exception is a standing acknowledgement
and is logged on every generation. The **Multilingual evidence** table leads
with the current-year value and keeps the full multi-year figures as audit
subtext.

---

## Backend (optional)

The standalone `dist/index.html` needs no backend. Add one and the app gains
persistence (state, documents, sign-offs survive reloads and machines), the
**Task management** board (pending → in progress → completed, auto-advancing
as workpapers are processed and generated), and shared policies.

```bash
npm run build            # builds dist/index.html AND dist-server/server.cjs
DATABASE_URL=postgres://… node dist-server/server.cjs
```

One service serves both the API and the app (default port 8471). Env:
`DATABASE_URL` (Postgres), optional `PORT`, `MAX_UPLOAD_MB` (default 25),
`CORS_ORIGINS` (only for split hosting). SQL migrations in
`server/migrations/` run at boot.

**Railway**: create a project with a Postgres plugin, set the build command
to `npm ci && npm run build` and the start command to `npm run start:server`,
and reference the plugin's `DATABASE_URL`. A static Netlify/Pages build can
attach to it via Settings ▸ Tool configuration ▸ Backend URL.

**Sign-in is deliberately absent for now** — one shared workspace, task
assignees are plain names. The schema and the auth seam are ready for
Microsoft Entra ID: registering a *Web* app (redirect
`https://<host>/api/auth/oidc/callback`) and adding the OIDC routes turns on
per-user isolation without restructuring.

---

## What it does not calculate

By design, and for three different reasons.

**Arithmetic that belongs to the template** — USD columns, subtotals, cross-schedule
links, rounding. One source of truth; if the tool also computed these, two answers
could exist for the same cell.

**Judgment** — filer category, book-to-tax adjustments, E&P, Subpart F and GILTI,
foreign tax credit, previously taxed E&P, functional currency determination.

**Data the documents don't contain** — prior-year carryovers, rates for non-calendar
year ends, text in scanned images.

`docs/5471-workpaper-user-guide.docx` covers all of this in detail.

---

## Where data lands in the template

| Content | Cells |
|---|---|
| Client, entity, addresses, activity, currency | `Basic Information` B1:B4, B11:B27 |
| Ownership facts | `Basic Information` C33:C40 |
| Filing categories 1a–5c | `Basic Information` B42:B50 |
| Exchange rates | `Basic Information` C59:C61 |
| Income statement, local currency | `Income Statement` F7:F59 |
| Balance sheet, local currency | `Balance Sheet` D10:D62 and F10:F62 |

Nothing else is touched.

---

## Optional services

None are required; all are keyless except Groq.

| Provider | Use | Free allowance |
|---|---|---|
| MyMemory | Translation | 5,000 characters/day |
| Lingva | Translation fallback | none published |
| OFX | Live FX, tried first | none published |
| Frankfurter (ECB) | Live FX, historical | none published |
| ExchangeRate-API | Live FX, latest only | none published |
| Groq | Translation and mapping | your own API key |

Keys are entered by the user at runtime and are never bundled into the build.

**Serve over HTTPS.** Browsers block these calls from `file://`.

---

## Project layout

```
assets/master-template.xlsx     the Form 5471 master workbook, inlined at build time
scripts/build.mjs               bundles and inlines everything into dist/index.html
src/entry.tsx                   mounts the app
src/prototype/Shell.tsx         navigation shell (14 tabs)
src/prototype/PrototypeApp.tsx  view routing
src/prototype/wp/
  store.ts                      state, actions, validation, generation
  engine.ts                     template cell map, mapping rules, spreadsheet reader
  pdfText.ts                    PDF text extraction
  detectProfile.ts              entity-detail detection
  fxRates.ts                    IRS and Treasury rate tables
  providers.ts                  translation and live-rate providers
  xlsxPatch.ts                  template-preserving OOXML cell writer
src/styles/                     base and application stylesheets
docs/                           user guide
```

### Replacing the master template

Drop your own workbook at `assets/master-template.xlsx` and rebuild. If its layout
differs, update the cell coordinates in `src/prototype/wp/engine.ts` — they are
declared in one place at the top of the file.

---

## Deploying

Any static host. `dist/` is the publish directory.

- **Netlify** — drag `dist/` onto <https://app.netlify.com/drop>, or connect the repo (`netlify.toml` included)
- **Vercel** — import the repo (`vercel.json` included)
- **GitHub Pages** — commit `dist/` and serve from the branch, or use an Actions workflow

---

## Notes

- Work is held in the browser session. Generate before closing the tab.
- Deep links work: `?view=fx`, `?view=entities`.
- Eleven `#DIV/0!` cells on Schedule E and Entity Structure exist in the master
  template before the tool touches it; they divide by inputs a preparer supplies.
