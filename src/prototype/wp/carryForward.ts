/* Carry-forward extraction from a prior-year Form 5471 (reference copy).

   Reads only pages the classifier marked as 5471-family, and only when the
   "Name of foreign corporation" on those pages is this work paper's entity.
   Returns plain facts; the store decides what becomes a cell write and what
   becomes a review item. Never touches the 1120/5472 pages — those describe
   the US parent. */

import { numeric } from "./engine";
import type { ParsedDoc } from "./engine";
import type { Block5471, DocClass, PageKind } from "./classify";

export type SourcedValue = { value: number; page: number; rowText: string };

export type CarryForward = {
  /** Prior-year Schedule J line 14 — the opening E&P for the current year. */
  openingEP?: SourcedValue;
  /** Prior-year Schedule F column (b) — closing USD balances as filed. */
  priorClosingUSD: Partial<Record<
    "cash" | "ar" | "oca" | "totalAssets" | "ap" | "ocl" | "re",
    SourcedValue
  >>;
  shares?: { classOfShares: string; boy: number; eoy: number; page: number };
  holderName?: string;
  /** Filer's SSN-shaped ID, already masked at extraction — never stored raw. */
  filerIdMasked?: string;
  pctVoting?: number;
  categories: string[];                 // "1a", "4", "5a"
  categoriesRaw?: string;               // the checkbox row, for the review item
  referenceIds: string[];
  formed?: string;
  functionalCurrency?: string;
  countryInc?: string;
  activity?: string;
  cfcName?: string;
  cfcAddress: string[];                 // street / suburb lines as printed
  /** Annual accounting period as printed on the face, "MM/DD/YYYY". A
      non-December end month is a fiscal year — calendar rate tables do not
      apply and the store must leave the rates blank for manual entry. */
  periodBegin?: string;
  periodEnd?: string;
  priorTaxAccruedFunctional?: SourcedValue;   // Sch E — for E-1 redetermination review
};

const pagesOfKind = (cls: DocClass, ...kinds: PageKind[]): Set<number> =>
  new Set(cls.pages.filter((p) => kinds.includes(p.kind)).map((p) => p.page));

const intersect = (a: Set<number>, b?: Set<number>): Set<number> =>
  b ? new Set([...a].filter((x) => b.has(x))) : a;

export type ParsedPeriod = { begin?: string; end?: string };

/* Dates on the face print as "MM-DD-YYYY", "MM/DD/YYYY" or the software's
   "MM-DD , 2023" (year comma-split, sometimes "20 23"). */
const DATE_PART = String.raw`(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/,]\s*((?:19|20)\s?\d{2})`;
const PERIOD_RE = new RegExp(
  `annual accounting period[^]{0,240}?beginning\\s*${DATE_PART}\\s*,?\\s*(?:and\\s*)?ending\\s*${DATE_PART}`, "i");
const PERIOD_END_ONLY_RE = new RegExp(
  `annual accounting period[^]{0,240}?ending\\s*${DATE_PART}`, "i");

const numYear = (y: string): number => Number(y.replace(/\s+/g, ""));
const validDate = (m: number, d: number, y: number): boolean =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100;
const fmtDate = (m: string, d: string, y: string): string =>
  `${String(Number(m)).padStart(2, "0")}/${String(Number(d)).padStart(2, "0")}/${numYear(y)}`;

/** Parse the face's "annual accounting period ... beginning MM-DD-YYYY, and
    ending MM-DD-YYYY" line. The caption and the dates can sit several rows
    apart (form-header rows interleave), so each anchor row is joined with up
    to four following rows. Returns null when nothing parses — never guesses. */
export function parseAccountingPeriod(rows: { page: number; cells: string[] }[]): ParsedPeriod | null {
  const windows: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!/annual accounting period/i.test(rows[i].cells.join(" "))) continue;
    let text = rows[i].cells.join(" ");
    windows.push(text);
    for (let j = i + 1; j <= i + 4 && j < rows.length; j++) {
      if (rows[j].page !== rows[i].page) break;
      text += " " + rows[j].cells.join(" ");
      windows.push(text);
    }
  }
  // The FILER's own tax year prints right below the corporation's period —
  // a row join must never let it masquerade as the accounting period.
  const clean = windows.map((t) => t.replace(/filer'?s tax year[^]*$/i, ""));
  for (const text of clean) {
    const m = PERIOD_RE.exec(text);
    if (m && validDate(+m[1], +m[2], numYear(m[3])) && validDate(+m[4], +m[5], numYear(m[6]))) {
      return { begin: fmtDate(m[1], m[2], m[3]), end: fmtDate(m[4], m[5], m[6]) };
    }
  }
  for (const text of clean) {
    const e = PERIOD_END_ONLY_RE.exec(text);
    if (e && validDate(+e[1], +e[2], numYear(e[3]))) {
      return { end: fmtDate(e[1], e[2], e[3]) };
    }
  }
  return null;
}

const rowsOnPages = (parsed: ParsedDoc, pages: Set<number>): { page: number; cells: string[] }[] => {
  if (!parsed.pdf) return [];
  return parsed.pdf.rows
    .filter((r) => pages.has(r.page))
    .map((r) => ({ page: r.page, cells: r.cells.map((c) => c.text) }));
};

/** Find the first row whose textual cell matches, and read a money value off
    it. `pick` chooses among the numeric cells right of the caption after the
    leading line-number echo is dropped. */
function matchFormLine(
  rows: { page: number; cells: string[] }[],
  labelRe: RegExp,
  pick: "first" | "last" = "last",
): SourcedValue | null {
  for (const r of rows) {
    for (let i = 0; i < r.cells.length; i++) {
      const cell = (r.cells[i] || "").trim();
      if (!cell) continue;
      // The line number may print glued to the caption ("2a Trade notes and…").
      const bare = cell.replace(/^\d{1,2}[a-c]?\s+/, "");
      if (!labelRe.test(bare)) continue;
      let nums = r.cells.slice(i + 1).map((c) => numeric(c)).filter((n): n is number => n !== null);
      // IRS forms repeat the line number to the right of the caption.
      const ln = /^(\d{1,2})[a-c]?\b/.exec(cell) || /^(\d{1,2})[a-c]?$/.exec((r.cells[i - 1] || "").trim());
      if (ln && nums.length > 1 && nums[0] === Number(ln[1])) nums = nums.slice(1);
      if (!nums.length) continue;
      return {
        value: pick === "first" ? nums[0] : nums[nums.length - 1],
        page: r.page,
        rowText: r.cells.join(" | "),
      };
    }
  }
  return null;
}

const CATEGORY_CODES = ["1a", "1b", "1c", "2", "3", "4", "5a", "5b", "5c"];

/** Extract carry-forward facts. With `pageFilter`/`scanRange` the read is
    scoped to one 5471 block of a multi-CFC client copy; unscoped it covers
    the whole document (single-5471 behavior, unchanged). */
export function extractCarryForward(
  cls: DocClass,
  parsed: ParsedDoc,
  pageFilter?: Set<number>,
  scanRange?: { from: number; to: number },
): CarryForward {
  const out: CarryForward = { priorClosingUSD: {}, categories: [], referenceIds: [], cfcAddress: [] };
  if (!parsed.pdf) return out;

  const schJ = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schJ"), pageFilter));
  const schF = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schF"), pageFilter));
  const schE = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schE"), pageFilter));
  const face = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-face", "us-5471-schA", "us-5471-schB"), pageFilter));

  // The face's accounting-period line — fiscal years drive the FX guard.
  const period = parseAccountingPeriod(face);
  if (period) {
    out.periodBegin = period.begin;
    out.periodEnd = period.end;
  }

  // Schedule J line 14 — the single most important carry-forward number.
  out.openingEP = matchFormLine(schJ, /balance at beginning of next year/i, "first") ?? undefined;

  // Schedule F column (b): both columns print, so the last numeric is EOY.
  const f = (re: RegExp) => matchFormLine(schF, re) ?? undefined;
  out.priorClosingUSD.cash = f(/^cash$/i);
  out.priorClosingUSD.ar = f(/^trade notes and accounts receivable/i);
  out.priorClosingUSD.oca = f(/^other current assets/i);
  out.priorClosingUSD.totalAssets = f(/^total assets/i);
  out.priorClosingUSD.ap = f(/^accounts payable/i);
  out.priorClosingUSD.ocl = f(/^other current liabilities/i);
  out.priorClosingUSD.re = f(/^retained earnings/i);

  // Prior-year foreign tax accrued (Schedule E) — E-1 redetermination review.
  // The payor row reads: line | income | ccy | tax(functional) | rate | tax(USD).
  for (const r of schE) {
    const cells = r.cells.map((c) => c.trim());
    const ci = cells.findIndex((c) => /^[A-Z]{3}$/.test(c) && c !== "USD");
    if (ci > 0) {
      const tax = numeric(cells[ci + 1]);
      if (tax !== null && Math.abs(tax) > 0) {
        out.priorTaxAccruedFunctional = { value: tax, page: r.page, rowText: cells.join(" | ") };
        break;
      }
    }
  }

  /* The face page is a form grid: values print on the row(s) BELOW their
     caption row, and checkbox marks are glued into cells ("1a X 1b"). */
  for (let ri = 0; ri < face.length; ri++) {
    const r = face[ri];
    const text = r.cells.join(" ");
    const nextRows = face.slice(ri + 1, ri + 4).filter((n) => n.page === r.page);

    // Shares: "Ordinary Shares | 120 | 120" (Schedule A / B).
    if (!out.shares) {
      const idx = r.cells.findIndex((c) => /^(ordinary|common|class [a-z]) shares?$/i.test((c || "").trim()));
      if (idx >= 0) {
        const nums = r.cells.slice(idx + 1).map((c) => numeric(c)).filter((n): n is number => n !== null);
        if (nums.length >= 2 && nums[0] >= 0 && nums[1] >= 0) {
          out.shares = { classOfShares: r.cells[idx].trim(), boy: nums[0], eoy: nums[1], page: r.page };
        }
      }
    }

    // Voting percentage: the caption wraps; the % prints on the same or next row.
    if (out.pctVoting === undefined && /stock you owned at the end|percentage of the foreign corporation'?s voting/i.test(text)) {
      for (const cand of [r, ...nextRows]) {
        const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(cand.cells.join(" "));
        if (m) { out.pctVoting = parseFloat(m[1]); break; }
      }
    }

    // Country of incorporation: caption row, value on the next row.
    if (!out.countryInc && /country under whose laws incorporated/i.test(text)) {
      const cand = nextRows[0]?.cells.map((c) => c.trim()).find((c) => /^[A-Za-z][A-Za-z ]{2,30}$/.test(c));
      if (cand) out.countryInc = cand;
    }

    // "d Date of incorporation … h Functional currency code" caption row —
    // the values row below carries date / place / activity / currency together.
    if (!out.formed && /date of incorporation/i.test(text)) {
      for (const cand of nextRows) {
        const cells = cand.cells.map((c) => c.trim()).filter(Boolean);
        const di = cells.findIndex((c) => /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(c));
        if (di < 0) continue;
        out.formed = cells[di].replace(/-/g, "/");
        const ci = cells.findIndex((c) => /^[A-Z]{3}$/.test(c) && c !== "USD");
        if (ci >= 0) {
          out.functionalCurrency = cells[ci];
          if (ci - 1 > di) out.activity = cells[ci - 1];
        }
        break;
      }
    }

    // The CFC's name and address block under "1a Name and address of foreign corporation".
    if (!out.cfcName && /^1a name and address of foreign corporation/i.test((r.cells[0] || "").trim())) {
      for (const cand of face.slice(ri + 1, ri + 5)) {
        const first = (cand.cells[0] || "").trim();
        if (!first || /^[b-d]\(?\d?\)?\s|^c country|^instructions/i.test(first)) continue;
        if (/country under whose laws/i.test(cand.cells.join(" "))) break;
        if (!out.cfcName) out.cfcName = first;
        else if (out.cfcAddress.length < 3 && /[A-Za-z]/.test(first)) out.cfcAddress.push(first);
      }
    }

    // Filer categories: glued checkbox tokens ("1a X 1b … 4 X 5a X 5b … 5c").
    // First-win like every other face field — a later 5471's checkbox row
    // (multi-CFC copies) must not overwrite this block's categories.
    if (!out.categories.length && /category of filer/i.test(text)) {
      for (const cand of [r, ...nextRows]) {
        const tokens = cand.cells.join(" ").split(/\s+/).map((t) => t.toLowerCase());
        const found: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
          if (CATEGORY_CODES.includes(tokens[i]) && /^[x✓✔]$/.test(tokens[i + 1] || "")) found.push(tokens[i]);
        }
        if (found.length) {
          out.categories = found;
          out.categoriesRaw = cand.cells.join(" ");
          break;
        }
      }
    }
  }

  // Holder: the row under "Name of person filing Form 5471". Scoped to this
  // block's extended range when segmenting a multi-CFC copy.
  const allPages = new Set(
    cls.pages
      .map((p) => p.page)
      .filter((p) => !scanRange || (p >= scanRange.from && p <= scanRange.to)),
  );
  const all = rowsOnPages(parsed, allPages);
  for (let i = 0; i < all.length; i++) {
    if (/^name of person filing/i.test((all[i].cells[0] || "").trim())) {
      const cand = (all[i + 1]?.cells[0] || "").trim();
      if (/[A-Za-z]{3}/.test(cand)) {
        out.holderName = cand.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
        break;
      }
    }
  }

  // Filer's identifying number: SSN-shaped IDs are masked at the source —
  // the raw value is never stored anywhere in the tool.
  for (const r of face) {
    const m = /\b\d{3}-\d{2}-(\d{4})\b/.exec(r.cells.join(" "));
    if (m) { out.filerIdMasked = `***-**-${m[1]}`; break; }
  }

  // Reference IDs only from "Reference ID number" captions — an EIN is a
  // 9-digit number too, and the filer's EIN must never masquerade as the
  // CFC's reference ID. The 5471 pages come first, so the CFC's own ID leads.
  const refIds: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const t = all[i].cells.join(" ");
    if (!/reference id/i.test(t)) continue;
    const near = /\b(\d{9})\b/.exec(t);
    if (near && !refIds.includes(near[1])) refIds.push(near[1]);
    const nxt = all[i + 1];
    if (nxt && nxt.page === all[i].page) {
      for (const c of nxt.cells) {
        const m = /^(\d{9})$/.exec((c || "").trim());
        if (m && !refIds.includes(m[1])) refIds.push(m[1]);
      }
    }
  }
  out.referenceIds = refIds;
  return out;
}

/** One CarryForward per Form 5471 block of the document. Without block
    segmentation (older DocClass, or a grid doc) a single pseudo-block covers
    the whole document — exactly the single-5471 behavior. */
export function extractCarryForwards(
  cls: DocClass,
  parsed: ParsedDoc,
): { block: Block5471; cf: CarryForward }[] {
  const blocks: Block5471[] =
    cls.blocks5471 && cls.blocks5471.length
      ? cls.blocks5471
      : [{
          index: 0,
          pages: cls.pages.filter((p) => p.kind.startsWith("us-5471-")).map((p) => p.page),
          scanFrom: 1,
          scanTo: Number.MAX_SAFE_INTEGER,
          facePage: null,
          cfcName: cls.foreignCorpName ?? null,
          referenceIds: [],
        }];
  return blocks.map((block) => {
    const single = blocks.length === 1;
    const cf = extractCarryForward(
      cls,
      parsed,
      single ? undefined : new Set(block.pages),
      single ? undefined : { from: block.scanFrom, to: block.scanTo },
    );
    // The caption scanner (with its bleed guards) beats the face harvest —
    // a right-column reference ID must never become the legal name.
    if (block.cfcName) cf.cfcName = block.cfcName;
    return { block, cf };
  });
}
