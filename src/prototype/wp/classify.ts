/* Document and page classification — the anti-contamination gate.

   Every uploaded document is classified before any mapping happens, and the
   feed policy decides what each page is ALLOWED to influence. A US parent's
   Form 1120 feeds nothing; a prior-year Form 5471 feeds carry-forward
   extraction only; an invoice ledger feeds the Schedule M module only; the
   CFC's own statements feed the income statement and balance sheet. This is
   deterministic and rule-based; a Groq assist (in the store) may raise an
   unknown document to a kind, never override a confident rules result. */

import type { PdfDoc } from "./pdfText";
import type { ParsedDoc } from "./engine";
import { numeric } from "./engine";

export type DocKind =
  | "cfc-financial-statements"
  | "cfc-tax-return"
  | "prior-year-us-return"
  | "related-party-ledger"
  | "trial-balance"
  | "terms-and-conditions"
  | "unknown";

export type PageKind =
  | "fs-cover" | "fs-trading" | "fs-pnl" | "fs-equity" | "fs-balance-sheet" | "fs-notes"
  | "ato-return" | "ato-calc-statement" | "ato-dividend-schedule" | "ato-franking"
  | "us-1120" | "us-5471-face" | "us-5471-schA" | "us-5471-schB" | "us-5471-schC"
  | "us-5471-schF" | "us-5471-schJ" | "us-5471-schM" | "us-5471-schE" | "us-5471-schH"
  | "us-5471-schI" | "us-5471-schO" | "us-5471-schP" | "us-5471-schR"
  | "us-5472" | "us-8992" | "us-statements" | "us-other"
  | "tandc" | "unknown";

export type PageInfo = { page: number; kind: PageKind; score: number };

export type DocNote = { level: "info" | "warn" | "block"; message: string };

export type DocClass = {
  fileId: string;
  fileName: string;
  kind: DocKind;
  confidence: number;                     // 0..1 — share of pages the rules could place
  method: "rules" | "groq";
  pages: PageInfo[];                      // one pseudo-page for grids
  statementYear: number | null;           // the year the document reports ON
  entityName: string | null;              // primary subject entity
  foreignCorpName: string | null;         // "Name of foreign corporation" on 5471 pages
  entityIds: string[];                    // ABN / EIN / reference IDs found
  duplicateOf?: string;                   // fileId of the preferred near-duplicate
  notes: DocNote[];
};

export type FeedTarget =
  | "generic-is" | "generic-bs" | "equity" | "targeted-ato"
  | "carry-forward" | "schM-ledger" | "profile" | "none";

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

function classifyPdfPage(doc: PdfDoc, page: number): PageInfo {
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

  // Statutory financial statements: entity + ABN/ACN band, section title.
  const fsBand = /\babn\b|\bacn\b|\ba\.\s?b\.\s?n\.?\b|company (number|registration)/.test(head) || /page \d+ of \d+/.test(foot);
  if (fsBand) {
    // Cover/administrative pages mention every section name — test them first.
    if (/\bcontents\b|directors'? statement|compilation report|independent auditor/.test(head)) return mk("fs-cover", 3);
    if (/trading account/.test(head)) return mk("fs-trading", 3);
    // A balance-sheet TITLE wins over equity-movement content: a balance sheet
    // may mention retained profits in a note, but never carries the movement.
    if (/statement of financial position|balance sheet/.test(head)) return mk("fs-balance-sheet", 3);
    // Equity movements need the strong anchor — a P&L-titled page carrying the
    // retained-profits roll-forward is the equity statement, not a P&L.
    if (/opening retained (profits|earnings)|retained (profits|earnings) at the (beginning|start)|movements? in equity/.test(all)) return mk("fs-equity", 3);
    if (/statement of financial performance|profit (and|or) loss|income statement|statement of comprehensive income/.test(head)) return mk("fs-pnl", 3);
    if (/accounting policies|notes to /.test(head)) return mk("fs-notes", 2);
    if (/financial statements/.test(head)) return mk("fs-cover", 2);
  }
  if (/terms\s*(&|and)\s*conditions|letter of engagement|engagement terms/.test(head)) return mk("tandc", 2);
  return mk("unknown", 0);
}

/** Kinds that legitimately continue onto anchor-less following pages. */
const CONTINUABLE = new Set<PageKind>([
  "us-5471-schJ", "us-5471-schE", "us-5471-schM", "us-5471-schP",
  "fs-balance-sheet", "fs-pnl", "fs-trading", "fs-equity",
  "us-statements", "ato-return", "tandc",
]);

export function classifyPages(doc: PdfDoc): PageInfo[] {
  const out: PageInfo[] = [];
  for (let p = 1; p <= doc.pageCount; p++) {
    let info = classifyPdfPage(doc, p);
    if (info.kind === "unknown" && out.length) {
      const prev = out[out.length - 1];
      if (CONTINUABLE.has(prev.kind)) info = { page: p, kind: prev.kind, score: 1 };
    }
    out.push(info);
  }
  return out;
}

/* ---------- years, entities, ids ---------- */

const YEAR_ANCHORS: RegExp[] = [
  /company tax return\s*(\d{4})/,
  /for the year ended[^\d]*\d{1,2}? ?\w* (\d{4})/,
  /year ended 31 december (\d{4})/,
  /as at \d{1,2} \w+ (\d{4})/,
  /for calendar year (\d{4})/,
  /tax year beginning[^]*?(\d{4})/,
];

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

const COMPANY_SUFFIX = /\b(pty\.?\s*ltd|ltd|limited|inc|llc|corp(oration)?|gmbh|sarl|bv|plc|co)\b\.?$/i;

function findCompanyNames(doc: PdfDoc, pages: number[]): string[] {
  const names: string[] = [];
  for (const p of pages) {
    const rows = doc.rows.filter((r) => r.page === p).slice(0, 12);
    for (const r of rows) {
      const t = r.cells.map((c) => c.text).join(" ").trim();
      if (t.length < 70 && COMPANY_SUFFIX.test(t) && /[A-Za-z]{3}/.test(t) && !/statement|report|schedule|form\b/i.test(t)) {
        names.push(
          t.replace(/^name of (company|entity|corporation)\s*/i, "").replace(/\s*\(.*\)\s*$/, "").trim(),
        );
      }
    }
  }
  return names;
}

function mostFrequent(list: string[]): string | null {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s, (counts.get(s) || 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [s, c] of counts) if (c > n) { best = s; n = c; }
  return best;
}

/** The "Name of foreign corporation" caption names the CFC on 5471 pages. */
function findForeignCorpName(doc: PdfDoc): string | null {
  const names: string[] = [];
  const rows = doc.rows;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].cells.map((c) => c.text).join(" ").toLowerCase();
    if (/^name of foreign corporation/.test(t)) {
      const next = rows[i + 1];
      if (next && next.page === rows[i].page) {
        const cand = next.cells.map((c) => c.text).find((x) => /[A-Za-z]{3}/.test(x));
        if (cand && cand.length < 70) names.push(cand.trim());
      }
    }
  }
  return mostFrequent(names);
}

function findEntityIds(doc: PdfDoc): string[] {
  const ids = new Set<string>();
  const rows = doc.rows;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].cells.map((c) => c.text).join(" ");
    const abn = /\bABN\b:?\s*([\d][\d ]{9,16}[\d])/i.exec(t);
    if (abn) ids.add(abn[1].replace(/\s+/g, ""));
    const ein = /\b(\d{2}-\d{7})\b/.exec(t);
    if (ein) ids.add(ein[1].replace("-", ""));
    if (/reference id/i.test(t)) {
      // The value prints either on the caption row or on the row below it.
      const near = /\b(\d{9})\b/.exec(t);
      if (near) ids.add(near[1]);
      const next = rows[i + 1];
      if (next && next.page === rows[i].page) {
        for (const c of next.cells) {
          const m = /^(\d{9})$/.exec(c.text.trim());
          if (m) ids.add(m[1]);
        }
      }
    }
  }
  return [...ids];
}

const STOPWORDS = new Set(["pty", "ltd", "limited", "inc", "llc", "corp", "corporation", "co", "gmbh", "plc", "the"]);

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
    const ledger = looksLikeLedger(parsed, fileName);
    return {
      fileId, fileName,
      kind: ledger ? "related-party-ledger" : "trial-balance",
      confidence: ledger ? 0.9 : 0.5,
      method: "rules",
      pages: [{ page: 1, kind: "unknown", score: 0 }],
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
  // US-form pages dominate: a prior-year 5471 client copy often staples the
  // old financial statements behind it — those must NOT feed current mapping.
  if (has("us-")) kind = "prior-year-us-return";
  else if (has("fs-")) kind = "cfc-financial-statements";
  else if (has("ato-")) kind = "cfc-tax-return";
  else if (kinds.size === 1 && kinds.has("tandc")) kind = "terms-and-conditions";

  const statementYear = detectStatementYear(doc, pages);
  if (kind === "prior-year-us-return" && caseYear && statementYear === caseYear) {
    notes.push({ level: "warn", message: `${fileName}: a US return for the CURRENT year (${caseYear}) was uploaded — expected a prior-year reference copy.` });
  }

  const fsPages = pages.filter((p) => p.kind.startsWith("fs-") || p.kind.startsWith("ato-")).map((p) => p.page);
  const entityName = mostFrequent(findCompanyNames(doc, fsPages.length ? fsPages : pages.map((p) => p.page)));
  const classified = pages.filter((p) => p.kind !== "unknown").length;

  return {
    fileId, fileName, kind,
    confidence: pages.length ? classified / pages.length : 0,
    method: "rules",
    pages,
    statementYear,
    entityName,
    foreignCorpName: findForeignCorpName(doc),
    entityIds: findEntityIds(doc),
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
