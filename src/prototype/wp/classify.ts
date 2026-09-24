/* Document and page classification — the anti-contamination gate.

   Every uploaded document is classified before any mapping happens, and the
   feed policy decides what each page is ALLOWED to influence. A US parent's
   Form 1120 feeds nothing; a prior-year Form 5471 feeds carry-forward
   extraction only; an invoice ledger feeds the Schedule M module only; the
   CFC's own statements feed the income statement and balance sheet. This is
   deterministic and rule-based; a Groq assist (in the store) may raise an
   unknown document to a kind, never override a confident rules result. */

import type { PdfDoc } from "./pdfText";
import { looksLikeQuestionnaire } from "./questionnaire";
import { SECTION_BANNERS } from "./sectionBanners";
import { detectTextLanguage, identifyByTerms } from "./terms";
import { looksLikeSalarySchedule } from "./relatedPartyLedger";
import type { ParsedDoc } from "./engine";
import { numeric } from "./engine";

export type DocKind =
  | "cfc-financial-statements"
  | "cfc-tax-return"
  | "prior-year-us-return"
  | "related-party-ledger"
  | "trial-balance"
  /** The preparer's client questionnaire — roles, wages received, the other
      shareholders. Feeds the profile only. */
  | "client-questionnaire"
  /** A month-by-month salary schedule for one related person. Feeds
      Schedule M only. */
  | "related-party-salary"
  | "terms-and-conditions"
  | "unknown";

export type PageKind =
  | "fs-cover" | "fs-trading" | "fs-pnl" | "fs-equity" | "fs-balance-sheet" | "fs-notes"
  | "ato-return" | "ato-calc-statement" | "ato-dividend-schedule" | "ato-franking"
  | "us-1120" | "us-5471-face" | "us-5471-schA" | "us-5471-schB" | "us-5471-schC"
  | "us-5471-schF" | "us-5471-schJ" | "us-5471-schM" | "us-5471-schE" | "us-5471-schH"
  | "us-5471-schI" | "us-5471-schO" | "us-5471-schP" | "us-5471-schR"
  | "us-5472" | "us-8992" | "us-statements" | "us-other"
  /** A page inside an identified document that carries caption-and-amount
      rows but names no section the rules know. It is NOT booked; its rows are
      surfaced in Review so money that was read can never disappear. */
  | "fs-schedule"
  /** The preparer's client questionnaire, sent as a PDF rather than a
      spreadsheet. The same document, and it must reach the profile either
      way. */
  | "questionnaire"
  /** A statutory tax RETURN printed as numbered boxes — the caption on one
      line, the box code and the amount on the next. Not a set of accounts:
      it states totals that a statement itemises, so only its income and
      expense boxes are booked and its balance-sheet boxes are offered for
      review. */
  | "tax-form"
  | "tandc" | "unknown";

export type PageInfo = { page: number; kind: PageKind; score: number };

export type DocNote = { level: "info" | "warn" | "block"; message: string };

export type DocClass = {
  fileId: string;
  fileName: string;
  kind: DocKind;
  confidence: number;                     // 0..1 — share of pages the rules could place
  method: "rules" | "groq" | "user";      // "user" = manual type override
  pages: PageInfo[];                      // one pseudo-page for grids
  statementYear: number | null;           // the year the document reports ON
  /** The period end the document PRINTS ("for the year ended 30 June 2024"),
      MM/DD/YYYY. Null when it states none. Carries the day and month that
      `statementYear` cannot. */
  statementPeriodEnd?: string | null;
  /** The period START, only when the document printed both ends. */
  statementPeriodStart?: string | null;
  /** How much text came off the document, and how much of it reads as a
      caption with an amount. "Text read" on its own says only that the reader
      ran; these say whether it found anything, and the intake screen prints
      them so a green status can never hide an empty document. */
  textRows?: number;
  textChars?: number;
  amountRows?: number;
  /** The language the document is written in, decided BEFORE it was
      classified — the vocabulary that can identify a document is the
      vocabulary of its own language, and learning it after mapping is
      learning it too late. */
  language?: string;
  /** What the document called itself, in its own words, and the English for
      it. Carried so the preparer can see WHY it was identified. */
  identifiedBy?: { term: string; english: string; language: string } | null;
  entityName: string | null;              // primary subject entity
  /** A company name read from the statement's own heading when no name
      carried a legal form (Ltd, SpA, S de RL de CV). Small practices print
      the trading name alone, and the document then had no owner at all. It is
      a CANDIDATE: shown and confirmed, never used to scope pages. */
  entityNameGuess?: string | null;
  foreignCorpName: string | null;         // "Name of foreign corporation" on 5471 pages
  entityIds: string[];                    // ABN / EIN / reference IDs found
  duplicateOf?: string;                   // fileId of the preferred near-duplicate
  blocks5471?: Block5471[];               // one per Form 5471 in a prior-year return
  notes: DocNote[];
};

/* One client copy can staple SEVERAL filed 5471s (one per CFC) into a single
   PDF. Each face page opens a block; the block's scan range extends past its
   own 5471 pages to the page before the NEXT face, so interleaved 5472 /
   supporting-statement pages of the same copy stay attached to their CFC. */
export type Block5471 = {
  index: number;
  pages: number[];        // us-5471-* pages of this block (drives schedule extraction)
  scanFrom: number;       // extended range for holder / refID / period scans
  scanTo: number;
  facePage: number | null;
  cfcName: string | null;
  referenceIds: string[];
};

export type FeedTarget =
  | "generic-is" | "generic-bs" | "equity" | "targeted-ato"
  | "carry-forward" | "schM-ledger" | "profile"
  /** Read from the caption/amount pairs rebuilt out of a boxed form's
      geometry, not from the page's own rows. */
  | "boxed-form"
  /** Read, shown in Review, never booked. */
  | "unassigned" | "none";

/* ---------- page classification ---------- */

const pageText = (doc: PdfDoc, page: number, take: "head" | "foot" | "all"): string => {
  const rows = doc.rows.filter((r) => r.page === page);
  const slice = take === "head" ? rows.slice(0, 14) : take === "foot" ? rows.slice(-3) : rows;
  return slice.map((r) => r.cells.map((c) => c.text).join(" ")).join("\n").toLowerCase();
};

const SCH_TITLES: [RegExp, PageKind][] = [
  [/accumulated earnings\s*&?\s*profits/, "us-5471-schJ"],
  [/transactions between controlled foreign corporation/, "us-5471-schM"],
  [/income, war profits, and excess profits taxes/, "us-5471-schE"],
  [/current earnings and profits/, "us-5471-schH"],
  [/previously taxed earnings and profits/, "us-5471-schP"],
  [/distributions from a foreign corporation/, "us-5471-schR"],
  [/organization or reorganization of foreign corporation/, "us-5471-schO"],
  [/information return of u\.?s\.? persons/, "us-5471-face"],
];

/* Titles that open a financial statement, in the languages the rest of this
   file already reads. Anchored at the start of a line. */
/* A statement titles itself at the start of a line — but not always at the
   start of the TITLE. CONTPAQ i heads its balance sheet "Posición Financiera,
   Balance General al 31/Dic/2024", so an anchored test never fired, the page
   never entered the financial-statement band, and the whole balance sheet
   classified as unknown and fed nothing into the work paper. A short lead-in
   that ends in a comma, colon or dash is part of the heading; prose about a
   statement ("…which includes the balance sheet") is not, and still fails. */
const TITLE_LEAD_IN = "(?:[\\p{L} .]{0,34}[,:\u2013\u2014-]\\s*)?";
const STATEMENT_TITLE = new RegExp(
  "^" + TITLE_LEAD_IN + "(balance sheet|statement of financial position|balance general|balance de situaci\u00f3n|"
  + "posici\u00f3n financiera|posicion financiera|estado de posici\u00f3n financiera|estado de posicion financiera|"
  + "estado de situaci\u00f3n financiera|estado de situacion financiera|balan\u00e7o|balanco|"
  + "bilan\\b|bilanz|bilancio|balans|"
  + "income statement|profit (and|or|&) loss|compte de profits et pertes|compte de r\u00e9sultat|"
  + "compte de resultat|statement of comprehensive income|statement of financial performance|"
  + "estado de resultados?|cuenta de resultados|demonstra\u00e7\u00e3o do resultado|"
  + "demonstracao do resultado|conto economico|winst- en verliesrekening|"
  + "gewinn- und verlustrechnung|erfolgsrechnung)\\b",
  "u",
);

/* Accents are decoration, not meaning. A statement titled "POSICIÓN
   FINANCIERA" and one titled "POSICION FINANCIERA" are the same document, and
   every accented alternative written out by hand is one a client can still
   spell differently. Folding is applied only in the tests below, so no
   existing pattern changes behaviour. */
const stripMarks = (s: string): string => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const foldAccents = (s: string): string => stripMarks(s).toLowerCase();

/* The pattern is folded WITHOUT lowercasing: "\p{L}" is a Unicode property
   escape and "\p{l}" is not one, so lowercasing the source would throw. */
const STATEMENT_TITLE_FOLDED = new RegExp(stripMarks(STATEMENT_TITLE.source), "u");

/** Every row of the page, lowercased, one string per row. */
const pageRowTexts = (doc: PdfDoc, page: number): string[] =>
  doc.rows.filter((r) => r.page === page).map((r) => r.cells.map((c) => c.text).join(" ").trim().toLowerCase());

/** A title anywhere on the page, not only in the first fourteen rows.
 *
 * A long letterhead, a logo block or a covering paragraph pushes the title
 * below the head band, and the page then classified as unknown however
 * plainly it named itself. Position still decides between candidates: the
 * FIRST title on the page is the page's own. */
export function titleRowIndex(doc: PdfDoc, page: number): number {
  const rows = pageRowTexts(doc, page);
  for (let i = 0; i < rows.length; i++) {
    if (STATEMENT_TITLE_FOLDED.test(foldAccents(rows[i]))) return i;
  }
  return -1;
}

/* ---------- identification by SHAPE ----------

   The title test asks whether somebody wrote this document's wording down.
   These ask what the page IS. They reuse the section-banner lexicon that the
   mapper already trusts in six languages, so a statement in a language nobody
   listed is still placed by the sides it prints. */

type BannerSide = "assets" | "liabilities" | "equity" | "income" | "costs";

function bannerSides(doc: PdfDoc, page: number): Set<BannerSide> {
  const out = new Set<BannerSide>();
  for (const text of pageRowTexts(doc, page)) {
    const label = text.trim();
    if (!label || label.length > 60) continue;
    for (const [re, section] of SECTION_BANNERS) {
      if (!re.test(label)) continue;
      if (section === "assets" || section === "fixedAssets" || section === "cash") out.add("assets");
      else if (section === "liabilities" || section === "termLiabilities") out.add("liabilities");
      else if (section === "equity") out.add("equity");
      else if (section === "income" || section === "otherIncome") out.add("income");
      else if (section === "costs" || section === "cogs") out.add("costs");
    }
  }
  return out;
}

/** A balance sheet prints both sides of the accounts over a page of amounts —
    in any language, whatever it calls itself. */
export function looksLikeBalanceSheetShape(doc: PdfDoc, page: number): boolean {
  const sides = bannerSides(doc, page);
  return sides.has("assets") && (sides.has("liabilities") || sides.has("equity")) && amountRowCount(doc, page) >= 5;
}

/** A profit and loss prints what came in and what went out. */
export function looksLikePnlShape(doc: PdfDoc, page: number): boolean {
  const sides = bannerSides(doc, page);
  if (sides.has("assets")) return false;   // a balance sheet naming its equity block
  return sides.has("income") && sides.has("costs") && amountRowCount(doc, page) >= 4;
}

/* Money, not merely digits. A signature page carries mobile numbers and IP
   addresses, and every one of them reads as a number: surfaced as unbooked
   figures they are noise in Review and, worse, they look like money somebody
   forgot to map. Money is written with a grouping separator or with two
   decimal places, and a phone number is written with neither. */
const MONEY_CELL = /^\(?-?\d{1,3}(?:[.,\u00a0 ']\d{3})+(?:[.,]\d{1,2})?\)?$|^\(?-?\d+[.,]\d{2}\)?$/;

function moneyRowCount(doc: PdfDoc, page: number): number {
  let n = 0;
  for (const r of doc.rows) {
    if (r.page !== page || r.cells.length < 2) continue;
    if (!/\p{L}/u.test(r.cells[0].text.trim())) continue;
    if (MONEY_CELL.test(r.cells[r.cells.length - 1].text.trim())) n++;
  }
  return n;
}

/** A page of caption-and-amount rows that names no section the rules know —
    a supporting schedule. Real money, no home: it goes to Review. */
export function looksLikeSchedulePage(doc: PdfDoc, page: number): boolean {
  return moneyRowCount(doc, page) >= 4;
}

/* A numbered-box form prints the caption on one line and the box CODE and
   the AMOUNT on the next, so no row carries both a caption and a figure and
   every caption+amount test on this page returns nothing. The layout is the
   evidence: a bare code of two to four digits standing immediately before a
   money cell, over and over. No language is involved, which is the point —
   a return in a language nobody listed is still recognisably a return. */
export function boxedFormPairs(doc: PdfDoc, page: number): number {
  let n = 0;
  for (const r of doc.rows) {
    if (r.page !== page || r.cells.length < 2) continue;
    for (let i = 0; i < r.cells.length - 1; i++) {
      const code = r.cells[i].text.trim();
      const amount = r.cells[i + 1].text.trim();
      if (!/^\d{2,4}$/.test(code)) continue;
      if (MONEY_CELL.test(amount) || /^\d{4,}$/.test(amount)) { n++; i++; }
    }
  }
  return n;
}

/** The client questionnaire, sent as a PDF instead of a spreadsheet. The same
    test the spreadsheet path already uses, over the page's rows. */
export function looksLikeQuestionnairePage(doc: PdfDoc, page: number): boolean {
  const grid = doc.rows.filter((r) => r.page === page).map((r) => r.cells.map((c) => c.text));
  return looksLikeQuestionnaire(grid);
}

/** Rows that read as a caption followed by an amount — the shape of a statement. */
function amountRowCount(doc: PdfDoc, page: number): number {
  let n = 0;
  for (const r of doc.rows) {
    if (r.page !== page || r.cells.length < 2) continue;
    const first = r.cells[0].text.trim();
    const last = r.cells[r.cells.length - 1].text.trim();
    if (!/\p{L}/u.test(first)) continue;
    if (/^\(?-?[\d.,\u00a0 ']+\)?$/.test(last) && /\d/.test(last)) n++;
  }
  return n;
}

function looksLikeStatementPage(doc: PdfDoc, page: number): boolean {
  const head = doc.rows.filter((r) => r.page === page).slice(0, 14);
  const titled = head.some((r) => STATEMENT_TITLE.test(r.cells.map((c) => c.text).join(" ").trim().toLowerCase()));
  return titled && amountRowCount(doc, page) >= 5;
}

/** Chilean client statements often title the page simply "BALANCE" followed
    by the company name. Require the statement's two sides as well, so a
    narrative reference to a balance cannot open the financial feed. */
function looksLikeChileanBalanceSheet(doc: PdfDoc, page: number): boolean {
  const all = pageText(doc, page, "all");
  return /(^|\n)\s*balance\b/m.test(all)
    && /\bactivos?\b/.test(all)
    && /\bpasivos?\b/.test(all)
    && /\btotal(?:es)?\b/.test(all)
    && amountRowCount(doc, page) >= 5;
}

function classifyPdfPage(doc: PdfDoc, page: number, opts?: { assumeFsBand?: boolean; shapes?: boolean }): PageInfo {
  const head = pageText(doc, page, "head");
  const foot = pageText(doc, page, "foot");
  const all = pageText(doc, page, "all");
  const mk = (kind: PageKind, score: number): PageInfo => ({ page, kind, score });

  // US federal forms — headers are unambiguous.
  if (/form\s*5472\b/.test(head)) return mk("us-5472", 3);
  if (/form\s*8992\b/.test(head) || /\(form 8992\)/.test(head)) return mk("us-8992", 3);
  if (/federal supporting statements/.test(head)) return mk("us-statements", 3);
  if (/form\s*5471\b|\(form 5471\)/.test(head)) {
    for (const [re, kind] of SCH_TITLES) if (re.test(head)) return mk(kind, 3);
    // Standalone schedule pages name themselves: "Schedule J (Form 5471)".
    const sm = /schedule ([a-z])(?:-1)?\s*\(form 5471\)/.exec(head);
    if (sm && "abcefhijmopr".includes(sm[1])) return mk(("us-5471-sch" + sm[1].toUpperCase()) as PageKind, 3);
    /* Page 1 of the form itself, recognised BEFORE the schedule tests below.
       The form prints Schedule A at the foot of its own first page, so the
       Schedule A test claimed every face page and a return carrying two Form
       5471s ended up with no face page at all — which is what segmentation
       starts a new block on. One block then spanned both corporations: only
       one entity was ever created, and the second corporation's Schedule F
       lines leaked into the first one's opening balances. Two markers, so
       that a schedule page quoting the form's title cannot pass for it. */
    if (/information return of u\.?s\.? persons/.test(all) && /name of person filing this return/.test(all)) {
      return mk("us-5471-face", 3);
    }
    // Core-form continuations name their schedules in the body band.
    if (/schedule c\b.*income statement|income statement.*schedule c\b/s.test(all)) return mk("us-5471-schC", 2);
    if (/schedule f\b.*balance sheet|balance sheet.*schedule f\b/s.test(all)) return mk("us-5471-schF", 2);
    if (/schedule i\b|summary of shareholder/.test(head)) return mk("us-5471-schI", 2);
    if (/schedule b\b|u\.?s\.? shareholders of foreign corporation/.test(all)) return mk("us-5471-schB", 2);
    if (/schedule a\b|stock of the foreign corporation/.test(all)) return mk("us-5471-schA", 2);
    return mk("us-5471-face", 2);
  }
  if (/form\s*1120\b|\(form 1120\)/.test(head) || /u\.?s\.? corporation income tax return/.test(head)) return mk("us-1120", 3);
  if (/form\s*(851|1125-e|1125e|7004|4562)\b/.test(head)) return mk("us-other", 2);

  // Australian company tax return (HandiTax prints a banded header).
  if (/company tax return\s*\d{4}/.test(head)) return mk("ato-return", 3);
  if (/franking account/.test(head)) return mk("ato-franking", 3);
  if (/dividend and interest schedule/.test(head)) return mk("ato-dividend-schedule", 3);
  if (/calculation statement/.test(head)) return mk("ato-calc-statement", 2);

  /* A statutory tax RETURN, before the statement tests: a return prints
     statement headings inside its own boxes ("Total del Activo"), so a page
     tested for statements first would be read as one. Two ways in, and the
     second needs no vocabulary at all:
       - the document says what it is, in any of the languages the
         terminology table carries; or
       - the page is laid out as numbered boxes and titles itself nothing. */
  const termHit = identifyByTerms(head);
  if (termHit && termHit.kind === "tax-return") return mk("tax-form", 3);
  if (!opts?.assumeFsBand && boxedFormPairs(doc, page) >= 8 && !STATEMENT_TITLE.test(head.split("\n")[0] || "")) {
    return mk("tax-form", 2);
  }

  // Statutory financial statements: entity + company-number band, section
  // title. UK statutory accounts print "Company No. SC240721" and Companies
  // House registration lines — all count as the band.
  const fsBand = opts?.assumeFsBand
    || /\babn\b|\bacn\b|\ba\.\s?b\.\s?n\.?\b|company\s+(no\.?\s|number|registration)|registered\s+(number|office)|companies house/.test(head)
    // Non-Anglo company/tax identifiers. Without these a Colombian, Mexican,
    // Brazilian or French statement never enters the band, so its pages
    // classify as "unknown" and never reach the mapper at all — the entity
    // then shows "0 lines" with nothing extracted to explain it.
    || /\bnit\b|\bru[tc]\b|\brfc\b|\bcuit\b|\bcnpj\b|\bnif\b|\bcif\b|\bsiren\b|\bsiret\b|\bkvk\b|\bcoc\b|c\.?o\.?c\.?\s*:|\bust-?idnr\b|\bche-?\d/.test(head)
    || /page \d+ of \d+|p\u00e1gina \d+ de \d+|p\u00e1gina \d+\/\d+/.test(foot)
    // A statement can also prove itself by its own SHAPE. Everything above
    // demands a registration number or a page footer, which small practices
    // simply do not print: a Swiss client's accounts carry only the company
    // name, its address and "BILAN AU 31 DECEMBRE 2024", so the title was
    // never even read and the whole document classified as unknown — nothing
    // from it reached the work paper. A title STARTING a line of its own, over
    // a page of label-and-amount rows, is a statement whatever the letterhead
    // omits. The title must start the line: "…which includes the balance sheet
    // and income statement" is prose about one, not one.
    || looksLikeStatementPage(doc, page)
    || looksLikeChileanBalanceSheet(doc, page);
  if (fsBand) {
    // Cover/administrative pages mention every section name — test them first.
    if (/\bcontents\b|directors'? (statement|report)|accountants'? report|compilation report|independent auditor/.test(head)) return mk("fs-cover", 3);
    // Under an ASSUMED band (statutory second pass) a titled notes page wins
    // before the statement tests — note prose mentions "balance sheet" freely.
    if (opts?.assumeFsBand && /accounting policies|notes to the (accounts|financial statements)/.test(head)) return mk("fs-notes", 2);
    if (/trading account/.test(head)) return mk("fs-trading", 3);
    // A balance-sheet TITLE wins over equity-movement content: a balance sheet
    // may mention retained profits in a note, but never carries the movement.
    if (/statement of financial position|balance sheet|balance general|posici\u00f3n financiera|posicion financiera|estado de situaci\u00f3n financiera|estado de situacion financiera|balan\u00e7o patrimonial|balanco patrimonial|balan\u00e7o|balanco|bilan\b|bilancio|balans|bilanz/.test(head) || looksLikeChileanBalanceSheet(doc, page)) return mk("fs-balance-sheet", 3);
    // Equity movements need the strong anchor — a P&L-titled page carrying the
    // retained-profits roll-forward is the equity statement, not a P&L.
    if (/statement of changes in equity/.test(head) || /opening retained (profits|earnings)|retained (profits|earnings) at the (beginning|start)|movements? in equity/.test(all)) return mk("fs-equity", 3);
    if (/statement of financial performance|profit (and|or) loss|income statement|statement of comprehensive income|estado de resultados?|estado de ganancias y p\u00e9rdidas|estado de ganancias y perdidas|cuenta de resultados|demonstra\u00e7\u00e3o do resultado|demonstracao do resultado|compte de profits et pertes|compte de r\u00e9sultat|compte de resultat|erfolgsrechnung|conto economico|winst- en verliesrekening|gewinn- und verlustrechnung/.test(head)) return mk("fs-pnl", 3);
    if (/accounting policies|notes to /.test(head)) return mk("fs-notes", 2);
    if (/financial statements/.test(head)) return mk("fs-cover", 2);
  }
  // Accounting-software exports (QuickBooks and friends): no statutory band,
  // but an EXACT statement title plus a period line in the first rows.
  const head5 = doc.rows.filter((r) => r.page === page).slice(0, 5)
    .map((r) => r.cells.map((c) => c.text).join(" ").trim().toLowerCase());
  const periodLine = /^(as of .*\d{4}|(january|february|march|april|may|june|july|august|september|october|november|december)[^]{0,40}\d{4}|all dates|a (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[^]{0,40}\d{4}|al \d{1,2} de [a-z\u00e1\u00e9\u00ed\u00f3\u00fa]+ de \d{4}|(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[^]{0,40}\d{4})$/;
  if (head5.some((t) => periodLine.test(t))) {
    if (head5.some((t) => /^(balance sheet|balance general|balan\u00e7o)(\s*[-–]\s*\d{4})?$/.test(t))) return mk("fs-balance-sheet", 2);
    if (head5.some((t) => /^(profit (and|&) loss|income statement|statement of activity|estado de resultados?)(\s*[-–]\s*\d{4})?$/.test(t))) return mk("fs-pnl", 2);
  }
  if (/terms\s*(&|and)\s*conditions|letter of engagement|engagement terms/.test(head)) return mk("tandc", 2);

  /* ---- identification by SHAPE, once every title test has failed ----

     Everything above asks whether somebody wrote this document's wording
     down. These ask what the page IS, so a statement in a language nobody
     listed, or one whose title sits below the head band, is still placed.
     Score 1: a shape is weaker evidence than a title, and the preparer can
     always override the type. */
  if (!opts?.shapes) return mk("unknown", 0);
  /* A title alone is not a statement: a covering letter names one in its
     first sentence. Figures beneath it are what make the page the thing it
     calls itself. */
  const titleAt = amountRowCount(doc, page) >= 3 ? titleRowIndex(doc, page) : -1;
  if (titleAt >= 0) {
    const line = foldAccents(pageRowTexts(doc, page)[titleAt] || "");
    if (BS_TITLE_WORDS.test(line)) return mk("fs-balance-sheet", 1);
    if (IS_TITLE_WORDS.test(line)) return mk("fs-pnl", 1);
  }
  /* Translate, then identify. The page's own words are read against the
     terminology table first, so a statement titled in a language the English
     patterns never covered is placed by what its title MEANS. */
  const term = identifyByTerms(all);
  if (term && amountRowCount(doc, page) >= 3) {
    if (term.kind === "balance-sheet") return mk("fs-balance-sheet", 1);
    if (term.kind === "income-statement") return mk("fs-pnl", 1);
    if (term.kind === "equity") return mk("fs-equity", 1);
  }
  if (looksLikeBalanceSheetShape(doc, page)) return mk("fs-balance-sheet", 1);
  if (looksLikePnlShape(doc, page)) return mk("fs-pnl", 1);
  if (looksLikeQuestionnairePage(doc, page)) return mk("questionnaire", 1);
  /* Read, and carrying money, but naming nothing the rules know. Never
     booked — surfaced in Review, because money that was read must not
     disappear. */
  if (looksLikeSchedulePage(doc, page)) return mk("fs-schedule", 1);
  return mk("unknown", 0);
}

/* Which of the two statements a matched title names. Folded, so the accented
   and unaccented spellings are one pattern. */
const BS_TITLE_WORDS = /balance sheet|financial position|balance general|balance de situacion|posicion financiera|situacion financiera|balanco|bilan\b|bilanz|bilancio|balans/;
const IS_TITLE_WORDS = /income statement|profit (and|or|&) loss|comprehensive income|financial performance|estado de resultados?|cuenta de resultados|resultado|compte de (profits|resultat)|conto economico|verliesrekening|verlustrechnung|erfolgsrechnung/;

/** Kinds that legitimately continue onto anchor-less following pages. */
const CONTINUABLE = new Set<PageKind>([
  "us-5471-schJ", "us-5471-schE", "us-5471-schM", "us-5471-schP",
  "fs-balance-sheet", "fs-pnl", "fs-trading", "fs-equity",
  "us-statements", "ato-return", "tandc",
  /* A return's later pages carry boxes and no heading at all. */
  "tax-form",
]);

export function classifyPages(doc: PdfDoc): PageInfo[] {
  // Pass 1 — page-local rules.
  const out: PageInfo[] = [];
  for (let p = 1; p <= doc.pageCount; p++) out.push(classifyPdfPage(doc, p));
  // Pass 2 — statutory accounts print the company number on SOME pages only
  // (UK accounts: cover + balance sheet). Once any page proves the document
  // is statutory FS, re-test the unknown pages with the band assumed so the
  // titled sections (P&L account, equity, notes) classify by their own name
  // instead of blindly continuing the previous page's kind.
  if (out.some((p) => p.kind.startsWith("fs-"))) {
    for (let i = 0; i < out.length; i++) {
      if (out[i].kind !== "unknown") continue;
      const info = classifyPdfPage(doc, out[i].page, { assumeFsBand: true });
      if (info.kind !== "unknown") out[i] = info;
    }
  }
  // Pass 3 — anchor-less continuation pages inherit the previous kind.
  for (let i = 1; i < out.length; i++) {
    if (out[i].kind === "unknown" && CONTINUABLE.has(out[i - 1].kind)) {
      out[i] = { page: out[i].page, kind: out[i - 1].kind, score: 1 };
    }
  }
  /* Pass 4 — identification by SHAPE, last of all.
     It runs only on pages every other pass left unknown, so a continuation
     page still inherits its statement rather than being demoted to a
     schedule: nothing that booked before stops booking. */
  for (let i = 0; i < out.length; i++) {
    if (out[i].kind !== "unknown") continue;
    const info = classifyPdfPage(doc, out[i].page, { shapes: true });
    if (info.kind !== "unknown") out[i] = info;
  }
  return out;
}

/* ---------- years, entities, ids ---------- */

const YEAR_ANCHORS: RegExp[] = [
  /company tax return\s*(\d{4})/,
  /for the year ended[^\d]*\d{1,2}? ?\w* (\d{4})/,
  /* "For the 12 months ended 31 December 2024" never says "year", so the
     anchor above missed it and the document reported NO year at all — which
     is how a set of accounts ends up supporting the wrong work paper year. */
  /for the \d{1,2} months? ended[^\d]*\d{1,2}? ?\w* (\d{4})/,
  /year ended 31 december (\d{4})/,
  /as at \d{1,2} \w+ (\d{4})/,
  /for calendar year (\d{4})/,
  /tax year beginning[^]*?(\d{4})/,
  // US-order software exports: "As of December 31, 2024" / "January - December
  // 2024" / "January 1-December 31, 2024".
  /as of (?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2},? (\d{4})/,
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{0,2}\s*[-–]\s*(?:january|february|march|april|may|june|july|august|september|october|november|december)?\s*\d{0,2},?\s*(\d{4})/,
  /* The year of a Spanish or Portuguese period end. "al" is the only word
     that introduces the CLOSING date, in both "al 31/Dic/2024" and
     "del 01/Dic/2024 al 31/Dic/2024", so no range can be read backwards. */
  /\bal\s+\d{1,2}\s*[\/.-]\s*[a-z\u00e0-\u00ff]{3,}\.?\s*[\/.-]\s*(\d{4})/,
  /\bal\s+\d{1,2}\s+de\s+[a-z\u00e0-\u00ff]+\s+de\s+(\d{4})/,
  /\bem\s+\d{1,2}\s*[\/.-]\s*[a-z\u00e0-\u00ff]{3,}\.?\s*[\/.-]\s*(\d{4})/,
];

/* ---------- the period the statements themselves report on ----------

   `detectStatementYear` answers "which YEAR", which is all the column routing
   needs. Basic Information needs the DAY: a work paper for an entity with a
   30 June year end that is dated 12/31 pulls the wrong FX tables, dates
   Schedule E and J wrongly and files the wrong period. Before this, the day
   and month could only come from a prior-year 5471's accounting-period line —
   so a first-year fiscal entity, or one with no prior return in the pile,
   silently got 12/31. The statements say it on their own face; read it. */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = MONTHS.join("|");
/* The same twelve months in the languages the statements arrive in, each
   keyed by the shortest prefix its language actually prints. A Mexican
   CONTPAQ i statement heads every page "al 31/Dic/2024"; with an
   English-only month list the document reported no period and no year at
   all, so the work paper's year had to come from a prior return or be typed. */
const MONTH_ALIASES: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, set: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
  // Portuguese and French where they differ from the Spanish above.
  janvier: 1, janeiro: 1, fev: 2, fevereiro: 2, "f\u00e9vrier": 2,
  mars: 3, "mar\u00e7o": 3, avr: 4, avril: 4, mai: 5, maio: 5,
  juin: 6, junho: 6, juillet: 7, julho: 7, "ao\u00fbt": 8,
  setembro: 9, out: 10, outubro: 10, octobre: 10, novembre: 11, novembro: 11,
  "d\u00e9cembre": 12, dez: 12, dezembro: 12,
};
const NON_EN_MONTH_RE = Object.keys(MONTH_ALIASES).sort((a, b) => b.length - a.length).join("|");
const monthNo = (name: string) => {
  const n = String(name || "").toLowerCase().slice(0, 30);
  const en = MONTHS.indexOf(n) + 1;
  if (en) return en;
  return MONTH_ALIASES[n] || MONTH_ALIASES[n.replace(/\.$/, "")] || 0;
};

/** "30 June 2024" and "June 30, 2024" — both orders, ordinal suffixes and a
    written or numeric day. Returns MM/DD/YYYY, or null when the date is not a
    real one (31 June is a typo, not a year end). */
export function parseLongDate(text: string): string | null {
  const t = String(text || "").toLowerCase().replace(/\u00a0/g, " ");
  let day: number | null = null, month = 0, year = 0;
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\s*,?\\s*(\\d{4})\\b`).exec(t);
  const mdy = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})\\b`).exec(t);
  /* "31/Dic/2024" and "31 de diciembre de 2024". Accounting packages outside
     the English-speaking world print the month as a NAME inside a slashed
     date; neither order above sees it, so the statement reported no date at
     all and the work paper's year had to come from somewhere else. */
  const slashed = new RegExp(`\\b(\\d{1,2})\\s*[\\/.-]\\s*(${NON_EN_MONTH_RE}|${MONTH_RE})\\.?\\s*[\\/.-]\\s*(\\d{4})\\b`).exec(t);
  const spelled = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${NON_EN_MONTH_RE})\\s+de\\s+(\\d{4})\\b`).exec(t);
  if (dmy) { day = Number(dmy[1]); month = monthNo(dmy[2]); year = Number(dmy[3]); }
  else if (mdy) { month = monthNo(mdy[1]); day = Number(mdy[2]); year = Number(mdy[3]); }
  else if (slashed) { day = Number(slashed[1]); month = monthNo(slashed[2]); year = Number(slashed[3]); }
  else if (spelled) { day = Number(spelled[1]); month = monthNo(spelled[2]); year = Number(spelled[3]); }
  if (day === null || !month || !year) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) return null;
  if (year < 2000 || year > 2035) return null;
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
};

/** "06/30/2024" → "06/30/2023". The period the comparative column reports on. */
export function periodMinusOneYear(p: string): string | null {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec((p || "").trim());
  if (!m) return null;
  return `${m[1]}/${m[2]}/${Number(m[3]) - 1}`;
}

/* The phrases that introduce a balance-sheet date or a reporting period end.
   Everything after the phrase up to ~60 characters is handed to the date
   parser, so wording between the phrase and the date ("ended on the 30th of
   June 2024") does not need its own pattern. */
const PERIOD_ANCHORS: RegExp[] = [
  /for the (?:financial )?(?:year|period) ended[^\n]{0,60}/i,
  /* Xero heads a P&L "For the 12 months ended 31 December 2024" — it never
     says "year". A "from X to Y" range is deliberately NOT matched here: the
     date parser takes the first date it sees, which in a range is the
     BEGINNING, and a period start read as a period end is worse than no
     answer at all. */
  /for the \d{1,2} months? ended[^\n]{0,60}/i,
  /for the (?:year|period) ending[^\n]{0,60}/i,
  /(?:financial )?year ended[^\n]{0,60}/i,
  /period ended[^\n]{0,60}/i,
  /as at[^\n]{0,60}/i,
  /as of[^\n]{0,60}/i,
  /balance sheet (?:as )?(?:at|of)[^\n]{0,60}/i,
  /* Spanish and Portuguese statements date themselves "al 31/Dic/2024" or
     "al 31 de diciembre de 2024". A P&L prints a RANGE — "del 01/Dic/2024 al
     31/Dic/2024" — and the anchor deliberately begins at "al", so the date
     parser reads the END of the range and can never read its beginning. */
  /\bal\s+\d{1,2}\s*[\/.-]\s*[a-z\u00e0-\u00ff]{3,}\.?\s*[\/.-]\s*\d{4}/i,
  /\bal\s+\d{1,2}\s+de\s+[a-z\u00e0-\u00ff]+\s+de\s+\d{4}/i,
  /\bem\s+\d{1,2}\s*[\/.-]\s*[a-z\u00e0-\u00ff]{3,}\.?\s*[\/.-]\s*\d{4}/i,
];

/**
 * The period end the statements print, as MM/DD/YYYY.
 *
 * Every page votes; the date agreeing with `year` (the detected statement
 * year) wins, because a set of accounts also prints the COMPARATIVE date on
 * the same face and a naive first-match reads last year's. Within the right
 * year the most-repeated date wins — the year end appears in the page
 * headings of every statement, a stray date appears once.
 */
/** The whole period a document states, when it prints both ends
    ("for the period 1 July 2023 to 30 June 2024"). The END is what everything
    downstream needs; the START is shown to the preparer so a short or long
    period is visible rather than inferred. */
export function detectStatementPeriod(doc: PdfDoc, pages: PageInfo[], year: number | null): { start: string | null; end: string | null } {
  /* A printed range is read FIRST and read whole: its second date is the
     period end and its first is the start. Read half of it — the way a
     single-date reader does — and the work paper is dated the day the period
     BEGAN, a year early. */
  for (const pi of pages) {
    if (!/^(fs-|ato-)/.test(pi.kind)) continue;
    const head = pageText(doc, pi.page, "head");
    for (const m of head.matchAll(/\b(?:for the (?:financial )?period|for the period from|from)\b([^\n]{0,90})/gi)) {
      const parts = String(m[1]).split(/\bto\b|\bthrough\b|\bthru\b|\u2013|\u2014/);
      if (parts.length < 2) continue;
      const start = parseLongDate(parts[0]);
      const end = parseLongDate(parts[1]);
      if (!start || !end) continue;
      if (year && Number(end.slice(-4)) !== year) continue;
      return { start, end };
    }
  }
  return { start: null, end: detectStatementPeriodEnd(doc, pages, year) };
}

export function detectStatementPeriodEnd(doc: PdfDoc, pages: PageInfo[], year: number | null): string | null {
  const votes = new Map<string, number>();
  for (const pi of pages) {
    if (!/^(fs-|ato-)/.test(pi.kind)) continue;
    const head = pageText(doc, pi.page, "head");
    for (const re of PERIOD_ANCHORS) {
      for (const m of head.matchAll(new RegExp(re.source, "gi"))) {
        const date = parseLongDate(m[0]);
        if (date) votes.set(date, (votes.get(date) || 0) + 1);
      }
    }
  }
  if (!votes.size) return null;
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  if (year) {
    const inYear = ranked.find(([d]) => Number(d.slice(-4)) === year);
    if (inYear) return inYear[0];
    return null;      // a date from another year is the comparative, not this period
  }
  return ranked[0][0];
}

export function detectStatementYear(doc: PdfDoc, pages: PageInfo[]): number | null {
  const votes = new Map<number, number>();
  for (const pi of pages) {
    const head = pageText(doc, pi.page, "head");
    for (const re of YEAR_ANCHORS) {
      const m = re.exec(head);
      if (m) {
        const y = parseInt(m[1], 10);
        if (y >= 2000 && y <= 2035) votes.set(y, (votes.get(y) || 0) + 2);
      }
    }
    // A bare year cell in the header band is a weak vote (form-corner boxes).
    const rows = doc.rows.filter((r) => r.page === pi.page).slice(0, 6);
    for (const r of rows) for (const c of r.cells) {
      if (/^(20\d{2})$/.test(c.text.trim())) {
        const y = parseInt(c.text, 10);
        if (y >= 2000 && y <= 2035) votes.set(y, (votes.get(y) || 0) + 1);
      }
    }
  }
  let best: number | null = null;
  let bestVotes = 0;
  for (const [y, v] of votes) if (v > bestVotes) { best = y; bestVotes = v; }
  return best;
}

/* Company-form suffixes, not only the Anglo ones. A Mexican statement heads
   every page "EL KIJ EXPORTACIONES S DE RL DE CV"; with an Anglo-only list the
   entity had no name from its own accounts, and Basic Information could only
   be filled from a prior return — which a first-year client does not have. */
const COMPANY_SUFFIX = new RegExp(
  "\\b(pty\\.?\\s*ltd|pte\\.?\\s*ltd|sdn\\.?\\s*bhd|ltd|limited|inc|llc|l\\.l\\.c|corp(oration)?|"
  + "s\\.?\\s?de\\s?r\\.?l\\.?(\\s?de\\s?c\\.?v\\.?)?|s\\.?a\\.?\\s?de\\s?c\\.?v\\.?|s\\.?a\\.?p\\.?i\\.?|"
  + "s\\.?r\\.?l|s\\.?a\\.?s|s\\.?a|ltda|e\\.?i\\.?r\\.?l|spa|gmbh|mbh|ag|kg|ohg|sarl|sas|sasu|"
  + "b\\.?v|n\\.?v|plc|oy|oyj|ab|a\\/s|aps|kft|zrt|sp\\.?\\s?z\\s?o\\.?o|d\\.?o\\.?o|co)\\b\\.?$",
  "i",
);

/** Rows that a statement's letterhead never means as a company name. */
/* The form's own captions end in a company word too: "Name of foreign
   corporation" read as a company called "...corporation", and the agent then
   reported a third foreign corporation that does not exist. */
const NAME_ROW_NOISE = /^(hoja|p[aá]gina|page|fecha|date|contpaq|sheet|names? (of|shown)|address|country|currency|identifying|reference|previous|enter|check|see instructions|description)\b/i;

/* A form's own words are not a company. "Name of foreign corporation" is a
   caption; "foreign corporation" is what is left of it once the caption words
   are stripped, and it was read as the corporation's name and reported to the
   preparer as a second corporation to prepare. A name has to carry something
   that distinguishes THIS company from any other. */
const GENERIC_NAME_WORD = new Set([
  "foreign", "domestic", "controlled", "subject", "related", "parent", "subsidiary",
  "corporation", "corporations", "company", "companies", "entity", "entities",
  "corp", "co", "business", "partnership", "person", "taxpayer", "filer", "shareholder",
  "name", "names", "of", "the", "a", "an", "this", "its", "and", "or",
  "any", "each", "such", "all", "both", "no", "every", "certain", "applicable",
]);

/* Phrases printed ON the form. A company is never called any of these, and
   the ones ending in "corporation" slip past a legal-form test: "Transactions
   Between Controlled Foreign Corporation" is Schedule M's own title, and it
   was read as the corporation's name. */
const FORM_PHRASE = /information return|transactions between|controlled foreign corporation|stock of the foreign|previously taxed|accumulated earnings|current earnings|distributions from|organization or reorganization|summary of shareholder|income, war profits|u\.?s\.? shareholders of|persons with respect to/i;

export function isGenericCompanyName(raw: string): boolean {
  if (FORM_PHRASE.test(String(raw || ""))) return true;
  const words = String(raw || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.every((w) => GENERIC_NAME_WORD.has(w) || STOPWORDS.has(w));
}

function findCompanyNames(doc: PdfDoc, pages: number[]): string[] {
  const names: string[] = [];
  const take = (raw: string) => {
    const t = raw.trim();
    if (t.length < 4 || t.length >= 70) return;
    /* A form prints a legal form letter by letter — "CECILIA GONZALEZ ACUNA
       S P A" — and the suffix list, which spells them as words, matched
       nothing. Gluing runs of single letters is general: "S.A.", "S P A",
       "N. V." and "B V" all become the word the list already carries, and a
       real word is never a run of single letters. */
    const glued = t.replace(/\b([A-Za-z])[\s.]+(?=[A-Za-z]\b)/g, "$1");
    if ((!COMPANY_SUFFIX.test(t) && !COMPANY_SUFFIX.test(glued)) || !/[A-Za-z]{3}/.test(t)) return;
    if (/statement|report|schedule|form\b/i.test(t) || NAME_ROW_NOISE.test(t)) return;
    const cleaned = t
      .replace(/^name of (company|entity|corporation)\s*/i, "")
      /* A form prints the tax identifier and the name on one line. The number
         is not part of the name, and left on it no two documents about the
         same company ever look alike. */
      .replace(/^\d[\d.\u00a0 -]{5,}[\s|]+/, "")
      .replace(/\s*\(.*\)\s*$/, "").trim();
    if (isGenericCompanyName(cleaned)) return;
    names.push(cleaned);
  };
  for (const p of pages) {
    const rows = doc.rows.filter((r) => r.page === p).slice(0, 12);
    for (const r of rows) {
      /* The whole line first — the usual statutory letterhead — then each
         cell on its own. An accounting package prints its own name and the
         sheet number on the same line as the client's ("CONTPAQ i   EL KIJ
         EXPORTACIONES S DE RL DE CV   Hoja: 1"), so the joined line ends in
         the page number and only the cell carries the company. */
      take(r.cells.map((c) => c.text).join(" "));
      if (r.cells.length > 1) for (const c of r.cells) take(c.text);
    }
  }
  return names;
}

/* The statement's own heading, when nothing on the page carries a legal
   form. Deliberately narrow: the first line of a statement page that reads
   like a name and like nothing else — not the title, not a date, not a page
   number, not the form's own words. */
function headingNameCandidate(doc: PdfDoc, pages: number[]): string | null {
  for (const p of pages) {
    const rows = doc.rows.filter((r) => r.page === p).slice(0, 6);
    for (const r of rows) {
      const t = r.cells.map((c) => c.text).join(" ").trim();
      if (t.length < 4 || t.length > 70) continue;
      if (NAME_ROW_NOISE.test(t)) continue;
      if (isGenericCompanyName(t)) continue;
      if ((t.match(/\d/g) || []).length > 2) continue;
      const folded = foldAccents(t);
      if (STATEMENT_TITLE_FOLDED.test(folded)) continue;
      if (/statement|report|schedule|form\b|informe|estado de|balance|periodo|per\u00edodo/i.test(t)) continue;
      const words = t.split(/\s+/).filter((w) => /[A-Za-z\u00c0-\u024f]{2}/.test(w));
      if (words.length < 2 && !words.some((w) => w.length >= 6)) continue;
      return t;
    }
  }
  return null;
}

/* On a numbered-box form the company name is a VALUE, not a heading: the
   caption ("01 Apellido Paterno o razón social", "Denominación social",
   "Company name") is printed on one line and the name on the next. No suffix
   list can find it, because a form prints whatever the registry holds —
   "CORP EDUCACIONAL CHARLIE BRAWN" carries its legal form at the front, or
   not at all. The form's own layout says which line is the name. */
const NAME_CAPTION = /raz[oó]n social|denominaci[oó]n social|nombre o raz[oó]n|company name|nom de la soci[eé]t[eé]|firmenname|ragione sociale|naam van de vennootschap/i;

function boxedNameCandidate(doc: PdfDoc, pages: number[]): string | null {
  for (const p of pages) {
    const rows = doc.rows.filter((r) => r.page === p);
    for (let i = 0; i < rows.length - 1; i++) {
      if (!rows[i].cells.some((c) => NAME_CAPTION.test(c.text))) continue;
      for (const c of rows[i + 1].cells) {
        const v = c.text.replace(/^\d[\d.\u00a0 -]{5,}\s*/, "").trim();
        if (v.length < 4 || v.length > 70) continue;
        if (!/\p{L}{3}/u.test(v) || NAME_ROW_NOISE.test(v) || isGenericCompanyName(v)) continue;
        return v;
      }
    }
  }
  return null;
}

function mostFrequent(list: string[]): string | null {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s, (counts.get(s) || 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [s, c] of counts) if (c > n) { best = s; n = c; }
  return best;
}

/* A name candidate row must be a value, not a bled-in caption from the form's
   right column ("BME01 b(3) Previous reference ID number(s), if any"). */
const NAME_CANDIDATE_REJECT = /reference id|identif\w* number|previous reference|^instructions|^[a-z0-9]{2,12}\s+b\(\d\)/i;

/** "BME01 b(3) Previous reference ID number(s)…" → "BME01": a reference-ID
    VALUE glued to the next caption in the form's right column. */
export function splitGluedRefId(t: string): string | null {
  const m = /^([A-Z][A-Z0-9]{2,19})\s+b\(\d\)/i.exec(t.trim());
  return m && /\d/.test(m[1]) ? m[1].toUpperCase() : null;
}

/** A reference-ID token: 7–9 digits, or letters+digits like BME01 / MAC2022. */
export const refIdToken = (s: string): string | null => {
  const t = s.trim();
  if (/^\d{7,9}$/.test(t)) return t;
  if (/^[A-Z][A-Z0-9]{3,19}$/i.test(t) && /\d/.test(t)) return t.toUpperCase();
  return null;
};

/** The "Name of foreign corporation" caption names the CFC on 5471 pages.
    With a pageSet the scan is block-scoped; unscoped it covers the doc. */
function findForeignCorpName(doc: PdfDoc, pageSet?: Set<number>): string | null {
  const names: string[] = [];
  const rows = pageSet ? doc.rows.filter((r) => pageSet.has(r.page)) : doc.rows;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].cells.map((c) => c.text).join(" ").toLowerCase();
    // The face's own caption ("1a Name and address of foreign corporation")
    // also announces the name — needed for a block whose face is its only page.
    if (/^name of foreign corporation/.test(t) || /^1a name and address of foreign corporation/.test(t)) {
      for (let j = i + 1; j <= i + 3 && j < rows.length; j++) {
        const next = rows[j];
        if (!next || next.page !== rows[i].page) break;
        const cand = next.cells.map((c) => c.text).find((x) => /[A-Za-z]{3}/.test(x));
        if (!cand || cand.length >= 70) continue;
        if (NAME_CANDIDATE_REJECT.test(cand.trim())) continue;   // right-column bleed
        names.push(cand.trim());
        break;
      }
    }
  }
  return mostFrequent(names);
}

/** IDs found in the document. With a pageSet the scan is block-scoped and
    collects reference-ID-caption hits ONLY — a filer EIN on an in-range 5472
    page must never become a block's reference ID. */
function findEntityIds(doc: PdfDoc, pageSet?: Set<number>): string[] {
  const ids = new Set<string>();
  const refIdOnly = !!pageSet;
  const rows = pageSet ? doc.rows.filter((r) => pageSet.has(r.page)) : doc.rows;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].cells.map((c) => c.text).join(" ");
    if (!refIdOnly) {
      const abn = /\bABN\b:?\s*([\d][\d ]{9,16}[\d])/i.exec(t);
      if (abn) ids.add(abn[1].replace(/\s+/g, ""));
      const ein = /\b(\d{2}-\d{7})\b/.exec(t);
      if (ein) ids.add(ein[1].replace("-", ""));
    }
    if (/reference id/i.test(t)) {
      // The value prints either on the caption row or on the row below it —
      // possibly glued to the b(3) caption, possibly alphanumeric (BME01).
      const near = /\b(\d{9})\b/.exec(t);
      if (near) ids.add(near[1]);
      for (const c of rows[i].cells) {
        const tok = splitGluedRefId(c.text);
        if (tok) ids.add(tok);
      }
      const next = rows[i + 1];
      if (next && next.page === rows[i].page) {
        for (const c of next.cells) {
          const tok = splitGluedRefId(c.text) || refIdToken(c.text);
          if (tok) ids.add(tok);
        }
      }
    }
  }
  return [...ids];
}

/** Split a prior-year return's 5471 pages into per-CFC blocks: every face
    page opens one. A leading faceless run of schedule pages merges into the
    first face block unless it names a distinctly different CFC. */
export function segment5471Blocks(doc: PdfDoc, pages: PageInfo[]): Block5471[] {
  const fam = pages.filter((p) => p.kind.startsWith("us-5471-")).sort((a, b) => a.page - b.page);
  if (!fam.length) return [];
  const blocks: Block5471[] = [];
  let cur: Block5471 | null = null;
  for (const p of fam) {
    if (p.kind === "us-5471-face" || !cur) {
      cur = {
        index: blocks.length,
        pages: [],
        scanFrom: 1, scanTo: doc.pageCount,   // finalized below
        facePage: p.kind === "us-5471-face" ? p.page : null,
        cfcName: null,
        referenceIds: [],
      };
      blocks.push(cur);
    }
    cur.pages.push(p.page);
  }
  // Scan ranges: block 0 reaches back to page 1 (cover sheets belong to the
  // first copy); each block ends the page before the next block's face.
  for (let k = 0; k < blocks.length; k++) {
    const next = blocks[k + 1];
    blocks[k].scanFrom = k === 0 ? 1 : (blocks[k].facePage ?? blocks[k].pages[0]);
    blocks[k].scanTo = next ? (next.facePage ?? next.pages[0]) - 1 : doc.pageCount;
  }
  for (const b of blocks) {
    b.cfcName = findForeignCorpName(doc, new Set(b.pages));
    const scan = new Set<number>();
    for (let p = b.scanFrom; p <= b.scanTo; p++) scan.add(p);
    b.referenceIds = findEntityIds(doc, scan);
  }
  // A block whose CFC name cannot be read is a continuation page the face
  // fallback mistook for a new filing — absorb it into its neighbour. Real
  // faces always carry the item-1a name; genuinely separate CFCs keep their
  // own blocks below. A leading unnamed run merges into the first NAMED block.
  if (blocks.length > 1) {
    const firstNamed = blocks.findIndex((b) => !!b.cfcName);
    if (firstNamed > 0) {
      const head = blocks.splice(0, firstNamed);
      const target = blocks[0];
      target.pages = [...head.flatMap((b) => b.pages), ...target.pages];
      target.scanFrom = head[0].scanFrom;
      target.referenceIds = [...new Set([...head.flatMap((b) => b.referenceIds), ...target.referenceIds])];
    }
    for (let k = 1; k < blocks.length; ) {
      if (!blocks[k].cfcName) {
        blocks[k - 1].pages = [...blocks[k - 1].pages, ...blocks[k].pages];
        blocks[k - 1].scanTo = blocks[k].scanTo;
        blocks[k - 1].referenceIds = [...new Set([...blocks[k - 1].referenceIds, ...blocks[k].referenceIds])];
        blocks.splice(k, 1);
      } else {
        k++;
      }
    }
  }
  // The SAME foreign corporation behind two faces (a filed copy plus a
  // reference/VOID copy, or a continuation the fallback took for a face) is
  // ONE logical unit — split, its face fields and its schedules would land in
  // different blocks. Merge adjacent same-name blocks; genuinely different
  // CFCs (the multi-entity case) keep their own.
  for (let k = 1; k < blocks.length; ) {
    const prev = blocks[k - 1];
    const curB = blocks[k];
    if (prev.cfcName && curB.cfcName && entitySimilarity(prev.cfcName, curB.cfcName) >= 0.5) {
      prev.pages = [...prev.pages, ...curB.pages];
      prev.scanTo = curB.scanTo;
      prev.referenceIds = [...new Set([...prev.referenceIds, ...curB.referenceIds])];
      blocks.splice(k, 1);
    } else {
      k++;
    }
  }
  blocks.forEach((b, i) => { b.index = i; });
  return blocks;
}

/* Words that say what KIND of company it is, never which one. Two Mexican
   corporations both end "S DE RL DE CV"; counted as shared tokens, any two of
   them scored 1.0 similar — which merged two different foreign corporations
   into one 5471 block, and merged their carry-forward candidates too. The
   non-Anglo forms are here for the same reason the suffix list carries them. */
const STOPWORDS = new Set([
  "pty", "ltd", "limited", "inc", "llc", "corp", "corporation", "co", "gmbh", "plc", "the",
  "s", "de", "rl", "cv", "sa", "sas", "sapi", "srl", "ltda", "eirl", "spa", "ag", "kg", "ohg",
  "sarl", "bv", "nv", "oy", "oyj", "ab", "aps", "kft", "zrt", "doo", "mbh", "pte", "sdn", "bhd",
  "y", "and", "&", "of", "for",
]);

export function entitySimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t && !STOPWORDS.has(t)));
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

/* ---------- document classification ---------- */

const LEDGER_HEADERS = ["date", "details", "reference", "currency", "total"];

function looksLikeLedger(parsed: ParsedDoc, fileName: string): boolean {
  if (/expenses? by contact|by contact/i.test(fileName)) return true;
  if (parsed.sheetNames?.some((n) => /expenses? by contact/i.test(n))) return true;
  for (const row of parsed.grid.slice(0, 8)) {
    const cells = row.map((c) => String(c || "").toLowerCase().trim());
    const hits = LEDGER_HEADERS.filter((h) => cells.some((c) => c === h || c.startsWith(h + " ("))).length;
    // Generic date/reference headers are not enough — a transaction ledger
    // must carry a currency column or the Total (Source)/(USD) pair, or a
    // dated trial balance would be silently diverted away from mapping.
    const hasCurrency = cells.includes("currency");
    const hasTotals = cells.some((c) => c.startsWith("total (source)")) || cells.some((c) => c.startsWith("total (usd)"));
    if (hits >= 3 && (hasCurrency || hasTotals)) return true;
  }
  return false;
}

export function classifyParsedDoc(fileId: string, fileName: string, parsed: ParsedDoc, caseYear?: number | null): DocClass {
  const notes: DocNote[] = [];

  if (!parsed.pdf) {
    /* Grids: the questionnaire and a salary schedule are recognised by their
       own captions before the ledger test, because both would otherwise fall
       to "trial balance" and have their answers read as line items. */
    const questionnaire = looksLikeQuestionnaire(parsed.grid);
    const salary = !questionnaire && looksLikeSalarySchedule(parsed.grid);
    const ledger = !questionnaire && !salary && looksLikeLedger(parsed, fileName);
    return {
      fileId, fileName,
      kind: questionnaire ? "client-questionnaire" : salary ? "related-party-salary" : ledger ? "related-party-ledger" : "trial-balance",
      confidence: questionnaire || salary ? 0.95 : ledger ? 0.9 : 0.5,
      method: "rules",
      pages: [{ page: 1, kind: "unknown", score: 0 }],
      textRows: parsed.grid.length,
      textChars: parsed.grid.reduce((n, r) => n + r.reduce((m, c) => m + String(c || "").length, 0), 0),
      amountRows: parsed.grid.filter((r) => r.some((c) => numeric(String(c || "")) !== null)).length,
      statementYear: null,
      entityName: null,
      foreignCorpName: null,
      entityIds: [],
      notes,
    };
  }

  const doc = parsed.pdf;
  const pages = classifyPages(doc);
  const kinds = new Set(pages.map((p) => p.kind));
  const has = (pre: string) => [...kinds].some((k) => k.startsWith(pre));

  let kind: DocKind = "unknown";
  /* A schedule page is a page of amounts with no section name. It is real
     evidence, but it is not proof that the document is a set of accounts —
     so it never promotes the document on its own. */
  const hasStatement = [...kinds].some((k) => k.startsWith("fs-") && k !== "fs-schedule");
  // US-form pages dominate: a prior-year 5471 client copy often staples the
  // old financial statements behind it — those must NOT feed current mapping.
  if (has("us-")) kind = "prior-year-us-return";
  else if (hasStatement) kind = "cfc-financial-statements";
  else if (has("ato-") || kinds.has("tax-form")) kind = "cfc-tax-return";
  else if (kinds.has("questionnaire")) kind = "client-questionnaire";
  else if (kinds.size === 1 && kinds.has("tandc")) kind = "terms-and-conditions";

  let statementYear = detectStatementYear(doc, pages);
  /* The period reader knows headings the year anchors do not. When the anchors
     found nothing, the period end IS the year — a document with no year at all
     cannot be placed against a work paper year, and was silently ignored by
     `deriveCaseYears`. */
  const period = detectStatementPeriod(doc, pages, statementYear);
  if (statementYear === null && !period.end) {
    const loose = detectStatementPeriodEnd(doc, pages, null);
    if (loose) statementYear = Number(loose.slice(-4));
  } else if (statementYear === null && period.end) {
    statementYear = Number(period.end.slice(-4));
  }
  /* A tax return is filed FOR the year that ended, and names the year it is
     filed IN. "Año tributario 2025" is the 2024 income year, and booking it
     as 2025 would put a whole year's figures in the wrong column. The rule is
     the convention, not the client: a tax year that names the following
     calendar year reports on the one before it. Said out loud in a note, so
     the preparer can see the year was derived and not printed. */
  const taxYearM = /a[n\u00f1]o tributario\s*(\d{4})/.exec(foldAccents(doc.rows.map((r) => r.cells.map((c) => c.text).join(" ")).join("\n")));
  if (taxYearM) {
    const filed = Number(taxYearM[1]);
    const income = filed - 1;
    if (statementYear === null || statementYear === filed) {
      statementYear = income;
      notes.push({
        level: "info",
        message: `${fileName} states tax year ${filed}, which reports on the ${income} income year — the figures were placed in ${income}. Set the year end in Basic Information if this return covers a different period.`,
      });
    }
  }
  const statementPeriodEnd = period.end ?? detectStatementPeriodEnd(doc, pages, statementYear);
  const statementPeriodStart = period.start;
  if (kind === "prior-year-us-return" && caseYear && statementYear === caseYear) {
    notes.push({ level: "warn", message: `${fileName}: a US return for the CURRENT year (${caseYear}) was uploaded — expected a prior-year reference copy.` });
  }

  /* Pages that NAME a statement section. A schedule page is a page of
     amounts with no section name, and on a US return those are the filer's
     own 1040 and 1120 schedules — scanning them for a company name found the
     wrong company entirely. */
  const fsPages = pages
    .filter((p) => (p.kind.startsWith("fs-") || p.kind.startsWith("ato-") || p.kind === "tax-form") && p.kind !== "fs-schedule")
    .map((p) => p.page);
  let entityName = mostFrequent(findCompanyNames(doc, fsPages.length ? fsPages : pages.map((p) => p.page)));
  /* No legal form anywhere: an accounting export often prints the trading
     name on its own. Offer the heading as a candidate rather than leaving the
     document with no owner, and let the preparer confirm it. */
  const boxedName = entityName ? null : boxedNameCandidate(doc, fsPages.length ? fsPages : pages.map((p) => p.page));
  if (boxedName) entityName = boxedName;
  const entityNameGuess = entityName || !fsPages.length || kind === "prior-year-us-return"
    ? null
    : headingNameCandidate(doc, fsPages);
  if (entityNameGuess) {
    notes.push({
      level: "info",
      message: `${fileName} does not print a company name with a legal form (Ltd, SpA, S de RL de CV...). Its heading reads "${entityNameGuess}" — confirm this is the entity being prepared before relying on the figures, or set the entity's legal name in Basic Information.`,
    });
  }
  const classified = pages.filter((p) => p.kind !== "unknown").length;
  const blocks5471 = kind === "prior-year-us-return" ? segment5471Blocks(doc, pages) : undefined;

  let amountRows = 0;
  for (let p = 1; p <= doc.pageCount; p++) amountRows += amountRowCount(doc, p);
  /* A boxed form carries no caption-and-amount rows at all, and reporting
     zero of them would have this document blocked as "read but carrying no
     figures" — it carries hundreds, in pairs the geometry has to rebuild. */
  let boxed = 0;
  for (let p = 1; p <= doc.pageCount; p++) boxed += boxedFormPairs(doc, p);
  if (boxed > amountRows) amountRows = boxed;
  const allText = doc.rows.map((r) => r.cells.map((c) => c.text).join(" ")).join("\n");
  const language = detectTextLanguage(allText).name;
  const termHit = identifyByTerms(allText);
  return {
    fileId, fileName, kind,
    confidence: pages.length ? classified / pages.length : 0,
    language,
    identifiedBy: termHit ? { term: termHit.term, english: termHit.en, language: termHit.lang } : null,
    textRows: doc.rows.length,
    textChars: doc.rows.reduce((n, r) => n + r.cells.reduce((m, c) => m + c.text.length, 0), 0),
    amountRows,
    method: "rules",
    pages,
    statementYear,
    statementPeriodEnd,
    statementPeriodStart,
    entityName,
    entityNameGuess,
    foreignCorpName: findForeignCorpName(doc),
    entityIds: findEntityIds(doc),
    ...(blocks5471 && blocks5471.length ? { blocks5471 } : {}),
    notes,
  };
}

/* ---------- near-duplicate detection ---------- */

function valueFingerprint(parsed: ParsedDoc, pages: Set<number> | null): Set<number> {
  const out = new Set<number>();
  const add = (raw: string) => {
    // Cells with letters are captions/codes; parsing their digit residue
    // ("Item 8J") pollutes the fingerprint and inflates similarity.
    if (/[A-Za-z]{2,}/.test(raw)) return;
    const n = numeric(raw);
    if (n !== null && Math.abs(n) >= 100) out.add(Math.round(Math.abs(n)));
  };
  if (parsed.pdf && pages) {
    for (const r of parsed.pdf.rows) {
      if (!pages.has(r.page)) continue;
      for (const c of r.cells) add(c.text);
    }
  } else {
    for (const row of parsed.grid) for (const c of row) add(String(c ?? ""));
  }
  return out;
}

/** Pages whose contents actually feed mapping — the comparison surface. */
const feedablePages = (cls: DocClass): Set<number> | null => {
  const pages = new Set(
    cls.pages.filter((p) => p.kind.startsWith("ato-") || p.kind.startsWith("fs-")).map((p) => p.page),
  );
  return pages.size ? pages : null;
};

/** Mark documents that duplicate another's feedable content: the standalone
    AU return vs the client-copy composite, a re-uploaded statements PDF, or
    the same trial-balance workbook twice. The wider document wins. */
export function markDuplicates(classes: DocClass[], parsedByFile: Map<string, ParsedDoc>): void {
  // Prior-year returns are excluded: their figures legitimately overlap the
  // statements' comparative columns, and their feed policy already contains them.
  const candidates = classes.filter((c) =>
    !c.duplicateOf &&
    (c.kind === "cfc-financial-statements" || c.kind === "cfc-tax-return" ||
     c.kind === "trial-balance" || c.kind === "related-party-ledger"));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.duplicateOf || b.duplicateOf) continue;
      if (a.statementYear && b.statementYear && a.statementYear !== b.statementYear) continue;
      const pa = parsedByFile.get(a.fileId);
      const pb = parsedByFile.get(b.fileId);
      if (!pa || !pb) continue;
      // A PDF with no feedable pages has nothing to duplicate — never fall
      // back to fingerprinting its whole text.
      if (pa.pdf && !feedablePages(a)) continue;
      if (pb.pdf && !feedablePages(b)) continue;
      const fa = valueFingerprint(pa, pa.pdf ? feedablePages(a) : null);
      const fb = valueFingerprint(pb, pb.pdf ? feedablePages(b) : null);
      if (fa.size < 5 || fb.size < 5) continue;   // too little data to judge
      let inter = 0;
      for (const v of fa) if (fb.has(v)) inter++;
      const jaccard = inter / (fa.size + fb.size - inter);
      // The smaller fingerprint fully contained in the larger also counts —
      // a standalone return IS a page-range of the composite.
      const containment = inter / Math.min(fa.size, fb.size);
      if (jaccard >= 0.8 || containment >= 0.9) {
        const [keep, dup] = a.pages.length >= b.pages.length ? [a, b] : [b, a];
        dup.duplicateOf = keep.fileId;
        dup.notes.push({
          level: "info",
          message: `${dup.fileName} duplicates the content of ${keep.fileName} — the wider document is used; the duplicate feeds nothing.`,
        });
      }
    }
  }
}

export function deriveCaseYears(classes: DocClass[]): { cy: number | null; py: number | null; dissent: number[] } {
  const votes = new Map<number, number>();
  for (const c of classes) {
    if ((c.kind === "cfc-financial-statements" || c.kind === "cfc-tax-return") && !c.duplicateOf && c.statementYear) {
      votes.set(c.statementYear, (votes.get(c.statementYear) || 0) + 1);
    }
  }
  // The NEWEST voted year is the case year: older statements in the pile are
  // reference material, and majority counting would let two stale copies
  // outvote the current file. Dissenting years are surfaced for review.
  const years = [...votes.keys()].sort((a, b) => b - a);
  const cy = years[0] ?? null;
  return { cy, py: cy ? cy - 1 : null, dissent: years.slice(1) };
}

/* ---------- the feed policy ---------- */

export function feedsForPage(cls: DocClass, pageKind: PageKind): Set<FeedTarget> {
  if (cls.duplicateOf) return new Set<FeedTarget>(["none"]);
  /* Independent of what the DOCUMENT turned out to be: a page of amounts the
     rules cannot name is shown in Review whatever else the document is, and a
     questionnaire page answers profile questions whatever format it arrived
     in. Neither is ever booked by these feeds. */
  if (pageKind === "fs-schedule") {
    /* Not on a US return. Its unnamed pages are the filer's OWN schedules —
       1040, 1120, K-1 — and they are not the foreign corporation's money.
       Surfacing them would put the parent's figures in the CFC's Review. */
    const own = cls.kind === "cfc-financial-statements" || cls.kind === "cfc-tax-return"
      || cls.kind === "trial-balance" || cls.kind === "unknown";
    return new Set<FeedTarget>([own ? "unassigned" : "none"]);
  }
  if (pageKind === "questionnaire") return new Set<FeedTarget>(["profile"]);
  /* A boxed form's figures are not on its rows — they are rebuilt from its
     geometry, so it feeds from the rebuilt pairs and never from the page. */
  if (pageKind === "tax-form") return new Set<FeedTarget>(["boxed-form", "profile"]);
  switch (cls.kind) {
    case "cfc-financial-statements":
    case "cfc-tax-return":
      switch (pageKind) {
        case "fs-trading":
        case "fs-pnl": return new Set<FeedTarget>(["generic-is", "profile"]);
        case "fs-balance-sheet": return new Set<FeedTarget>(["generic-bs", "profile"]);
        case "fs-equity": return new Set<FeedTarget>(["equity"]);
        case "fs-cover":
        case "fs-notes": return new Set<FeedTarget>(["profile"]);
        case "ato-return":
        case "ato-calc-statement":
        case "ato-dividend-schedule":
        case "ato-franking": return new Set<FeedTarget>(["targeted-ato"]);
        default: return new Set<FeedTarget>(["none"]);
      }
    case "prior-year-us-return":
      // Only the 5471 family pages describe the CFC; 1120/5472/8992 are the
      // parent's own filings and must feed nothing at all.
      return pageKind.startsWith("us-5471-")
        ? new Set<FeedTarget>(["carry-forward"])
        : new Set<FeedTarget>(["none"]);
    case "related-party-ledger": return new Set<FeedTarget>(["schM-ledger"]);
    case "client-questionnaire": return new Set<FeedTarget>(["profile"]);
    case "related-party-salary": return new Set<FeedTarget>(["schM-ledger"]);
    case "trial-balance": return new Set<FeedTarget>(["generic-is", "generic-bs", "profile"]);
    default: return new Set<FeedTarget>(["none"]);
  }
}

/** Pages of a document allowed to feed the given target. */
export function pagesForFeed(cls: DocClass, feed: FeedTarget): Set<number> {
  const out = new Set<number>();
  for (const p of cls.pages) if (feedsForPage(cls, p.kind).has(feed)) out.add(p.page);
  return out;
}
