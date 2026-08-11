/* Carry-forward extraction from a prior-year Form 5471 (reference copy).

   Reads only pages the classifier marked as 5471-family, and only when the
   "Name of foreign corporation" on those pages is this work paper's entity.
   Returns plain facts; the store decides what becomes a cell write and what
   becomes a review item. Never touches the 1120/5472 pages — those describe
   the US parent. */

import { numeric } from "./engine";
import type { ParsedDoc } from "./engine";
import type { DocClass, PageKind } from "./classify";

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
  priorTaxAccruedFunctional?: SourcedValue;   // Sch E — for E-1 redetermination review
};

const pagesOfKind = (cls: DocClass, ...kinds: PageKind[]): Set<number> =>
  new Set(cls.pages.filter((p) => kinds.includes(p.kind)).map((p) => p.page));

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

export function extractCarryForward(cls: DocClass, parsed: ParsedDoc): CarryForward {
  const out: CarryForward = { priorClosingUSD: {}, categories: [], referenceIds: [], cfcAddress: [] };
  if (!parsed.pdf) return out;

  const schJ = rowsOnPages(parsed, pagesOfKind(cls, "us-5471-schJ"));
  const schF = rowsOnPages(parsed, pagesOfKind(cls, "us-5471-schF"));
  const schE = rowsOnPages(parsed, pagesOfKind(cls, "us-5471-schE"));
  const face = rowsOnPages(parsed, pagesOfKind(cls, "us-5471-face", "us-5471-schA", "us-5471-schB"));

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
    if (/category of filer/i.test(text)) {
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

  // Holder: the row under "Name of person filing Form 5471".
  const all = rowsOnPages(parsed, new Set(cls.pages.map((p) => p.page)));
  for (let i = 0; i < all.length; i++) {
    if (/^name of person filing/i.test((all[i].cells[0] || "").trim())) {
      const cand = (all[i + 1]?.cells[0] || "").trim();
      if (/[A-Za-z]{3}/.test(cand)) {
        out.holderName = cand.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
        break;
      }
    }
  }

  out.referenceIds = cls.entityIds.filter((id) => /^\d{9}$/.test(id));
  return out;
}
