/* Statement structure: section banners, structural subtotals, and re-feeding.
 *
 * A financial statement is not a flat list of caption/amount pairs. It has
 * shape, and three parts of that shape were being read as if they were data.
 *
 * 1. BANNERS. "Current assets" or "Operating expenses" is printed on its own
 *    line with no figure. It is not a line item; it declares what the rows
 *    beneath it ARE. Without reading it, "Interest" under "Operating expenses"
 *    and "Interest" under "Other income" are the same caption and map to the
 *    same line — one of them wrongly.
 *
 * 2. STRUCTURAL SUBTOTALS. A statement prints its own totals. Booking both a
 *    total and the rows it totals doubles the figure. There is no reliable
 *    keyword for this — "Total" appears on genuine line items and is absent
 *    from plenty of real subtotals — so it is detected ARITHMETICALLY: a row
 *    whose value equals the sum of the rows indented beneath it is a summary
 *    of them, not an addition to them.
 *
 * 3. RE-FEEDING. Classification decides, per PAGE, whether rows go to the P&L
 *    or the balance-sheet pipeline. A page holding the end of the P&L and the
 *    start of the balance sheet gets one answer for both. The banners are
 *    documentary evidence of which is which, and they override the page-level
 *    guess for the rows that follow them.
 *
 * Every rule here answers a real misreading. The tolerance in `same` is
 * absolute at 2 cents and relative above 20,000 — statements round, and a
 * subtotal printed to the nearest thousand still IS the subtotal.
 */

import { BS_LINES } from "./engine";
import type { ExtractedRow } from "./engine";
import { SECTION_BANNERS, type Section } from "./sectionBanners";

export { isBannerLabel, type Section } from "./sectionBanners";

/** What the pipeline carries between extraction and mapping. */
export type MapRow = {
  row: ExtractedRow;
  docId: string;
  docName: string;
  /** Which pipeline the row feeds. "both" is a grid row that carries whole-year
      and balance columns at once. */
  feed: "is" | "bs" | "both";
  kind: "pdf" | "grid";
  /** Left edge of the caption, in PDF points. The indent IS the hierarchy. */
  x0?: number;
  /** Which banner this row was printed under, once tagged. */
  section?: Section | null;
  /** Set when the row is structure rather than data — why, in the preparer's
      words, so the log can say what was dropped and the reader can disagree. */
  skipReason?: string;
  /** A section heading that carries the section's whole figure on its own
      line, with nothing itemised beneath it. See collapsedSections. */
  collapsed?: Section;
  /** This row is one of the figures a subtotal was PROVEN to add up, so the
      statement's own arithmetic adds it with the sign it is printed with.
      Set by structRows and gridStructRows; read when a caption is routed to a
      contra line, where the sign is the whole question. */
  inTotal?: boolean;
};


/* ---------- geometry ---------- */

/** Indent to one decimal place. PDF x-coordinates wobble by hundredths
    between rows that are visually flush; rounding is what makes "same
    indent" mean the same thing to the code and to the eye. */
export const indentOf = (m: MapRow): number =>
  m && typeof m.x0 === "number" ? Math.round(m.x0 * 10) / 10 : 0;

/** The row's own figure: the LAST value on the line. A statement prints the
    current year last when it prints two, and the subtotal arithmetic must
    compare like with like. */
export const amtOf = (m: MapRow): number | null => {
  const v = m && m.row && m.row.values;
  return v && v.length ? v[v.length - 1] : null;
};

/* ---------- furniture ---------- */

/** Value-less captions that repeat across pages are page furniture — a
    running header, the client name in a footer — not banners and not data. */
function furnitureKeys(rows: MapRow[]): Set<string> {
  const pagesByKey = new Map<string, Set<number>>();
  for (const m of rows) {
    if (amtOf(m) !== null) continue;
    // Digits normalised away so "Page 3 of 9" and "Page 4 of 9" are one key.
    const key = String((m.row && m.row.label) || "").replace(/\d+/g, "#").trim().toLowerCase();
    if (!key) continue;
    if (!pagesByKey.has(key)) pagesByKey.set(key, new Set());
    pagesByKey.get(key)!.add(m.row.page as number);
  }
  const out = new Set<string>();
  for (const [key, pages] of pagesByKey) if (pages.size > 1) out.add(key);
  return out;
}

export function dropFurniture(rows: MapRow[]): MapRow[] {
  const junk = furnitureKeys(rows);
  return rows.filter((m) => {
    if (amtOf(m) !== null) return true;
    return !junk.has(String((m.row && m.row.label) || "").replace(/\d+/g, "#").trim().toLowerCase());
  });
}

/* ---------- structural subtotals ---------- */

/* "NET OTHER INCOME" and "NET OPERATING INCOME" are QuickBooks' own summary
   lines, printed at the outermost indent beside "NET INCOME". Without them
   in this lexicon, "NET OTHER INCOME" survived to the keyword scan, matched
   "other income" and was booked as a second other-income account. */
const TOTAL_WORD = /^(total|subtotal|sub-total|sum|net result|net\s+(?:other\s+|operating\s+)?(?:income|earnings|profit|loss)|grand total|totaal|totale|gesamt|合计|總計)\b|\b(?:ingresos|gastos|costos|activos|pasivos|patrimonio)\s+totales?\b/i;

/** The outermost figures within a candidate group. A subtotal covers its
    IMMEDIATE children, so only the shallowest indent that carries numbers
    counts — deeper rows are already inside one of those. */
export function kidsSum(rows: MapRow[]): { rows: MapRow[]; sum: number } | null {
  if (!rows.length) return null;
  let shallowest: number | null = null;
  for (const m of rows) {
    const ind = indentOf(m);
    if (amtOf(m) !== null && (shallowest === null || ind < shallowest)) shallowest = ind;
  }
  if (shallowest === null) return null;
  const kids = rows.filter((m) => indentOf(m) === shallowest && amtOf(m) !== null);
  return kids.length ? { rows: kids, sum: kids.reduce((n, m) => n + (amtOf(m) as number), 0) } : null;
}

/** Equal enough to be the same figure: 2 cents absolute, or one part per
    million above ~20,000 — statements round, and a subtotal printed to the
    nearest thousand is still the subtotal. */
export const same = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 1e-6);

/** Mark the rows that are the statement's own structure. Three tests, in
    order, because a row can satisfy more than one and the first is the most
    specific:

      1. its value equals the sum of the rows indented BENEATH it — a summary
         heading, the shape used by "Operating expenses  120,000" followed by
         its components;
      2. its value equals the sum of the rows indented above it and below the
         previous row at its own level — a trailing total, the commoner shape;
      3. it is at the report's outermost indent and starts with a total word —
         the grand total, which has nothing indented under it to compare.

    The reason is kept on the row rather than deleting it, so the log can name
    what was dropped and the preparer can disagree. */
export function structRows(rows: MapRow[]): MapRow[] {
  const out = dropFurniture(rows).map((m) => ({ ...m }));
  if (!out.length) return out;

  let outermost: number | null = null;
  for (const m of out) {
    const ind = indentOf(m);
    if (outermost === null || ind < outermost) outermost = ind;
  }

  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const amt = amtOf(m);
    if (amt === null) continue;
    const ind = indentOf(m);

    const below: MapRow[] = [];
    for (let j = i + 1; j < out.length; j++) {
      if (indentOf(out[j]) <= ind) break;
      below.push(out[j]);
    }
    const summary = kidsSum(below);
    if (summary && same(summary.sum, amt)) {
      m.skipReason = `summary of the ${summary.rows.length} row(s) indented beneath it`;
      for (const kid of summary.rows) (kid as MapRow).inTotal = true;
      continue;
    }

    const above: MapRow[] = [];
    for (let j = i - 1; j >= 0; j--) {
      if (indentOf(out[j]) <= ind) break;
      above.unshift(out[j]);
    }
    const total = kidsSum(above);
    if (total && same(total.sum, amt)) {
      m.skipReason = `total of the ${total.rows.length} row(s) above it`;
      for (const kid of total.rows) (kid as MapRow).inTotal = true;
      continue;
    }

    /* The same total, printed the way QuickBooks prints a numbered group.
       "6790 Other Professional Fees" carries its own balance, its members sit
       one level in, and the closing "Total 6790 Other Professional Fees" is
       printed back at the PARENT's indent — not one level in from the members.
       The scan above therefore stops ON the parent and leaves the parent's own
       balance out: 40,682.42 + 3,540.96 = 44,223.38 against a printed
       45,912.38, no tie, and the subtotal was booked as an ordinary account.
       Three of these on one P&L moved 2,925,861.08 across Schedule C.
       Both tests must pass before anything is dropped: the caption has to be
       the parent's caption under a leading "Total", and the arithmetic has to
       tie with the parent included. */
    if (TOTAL_WORD.test(String(m.row.label || "").trim())) {
      const parent = out[i - 1 - above.length];
      const pAmt = parent ? amtOf(parent) : null;
      const bare = String(m.row.label || "").trim().replace(TOTAL_WORD, "");
      if (parent && pAmt !== null && indentOf(parent) === ind &&
          totalKey(bare) && totalKey(bare) === totalKey(String(parent.row.label || "")) &&
          same(pAmt + (total ? total.sum : 0), amt)) {
        m.skipReason = `total of "${parent.row.label}" and the ${above.length} row(s) beneath it`;
        (parent as MapRow).inTotal = true;
        if (total) for (const kid of total.rows) (kid as MapRow).inTotal = true;
        continue;
      }
    }

    /* The trailing total printed FLUSH with the rows it adds, which is how
       Xero-style accounts set out a group:

         Purchases
             Contractor Labour Costs   152,418
             Total Purchases           152,418

       Test 2 above cannot see this — it only walks rows indented DEEPER than
       the total — so both lines were booked and cost of sales came out at
       double. Four of these on one set of accounts ("Total Purchases", "Total
       Donations paid", "Total Shareholders Remuneration", "Total Term
       Liabilities") moved 270,737 across Schedule C and Schedule F.

       The walk stops at the first row that is not a plain sibling: a shallower
       row ends the group, and a row already found to be structure means this
       is a total of totals, where the members are counted through them. The
       arithmetic still has to tie, so a genuine account called "Total Return
       Fund" is left alone. */
    if (!m.skipReason && TOTAL_WORD.test(String(m.row.label || "").trim())) {
      const flush: MapRow[] = [];
      for (let j = i - 1; j >= 0; j--) {
        const sib = out[j];
        if (indentOf(sib) < ind) break;             // a shallower row ends the group
        if (indentOf(sib) > ind) continue;          // a deeper row belongs to a sibling
        if (sib.skipReason) break;                  // structure already claimed it
        /* Another total closes the group above it, whether or not we managed
           to prove it. These accounts print "Total Expenses" as the sum of 27
           rounded lines: 642,791 against a printed 642,794, three dollars out,
           so it stays data. Without this stop the next group's total walked
           straight past it and added 29 rows instead of its own one. */
        if (TOTAL_WORD.test(String(sib.row.label || "").trim())) break;
        if (amtOf(sib) === null) break;             // a caption with no figure opens a new group
        flush.unshift(sib);
      }
      if (flush.length && same(flush.reduce((n, k) => n + (amtOf(k) as number), 0), amt)) {
        m.skipReason = `total of the ${flush.length} row(s) printed flush above it`;
        for (const kid of flush) (kid as MapRow).inTotal = true;
        continue;
      }
    }

    if (ind === outermost && TOTAL_WORD.test(String(m.row.label || "").trim())) {
      m.skipReason = "a total at the outermost indent of the report";
    }
  }
  return out;
}

/* ---------- movement schedules ---------- */

/** The captions a movement schedule is built from. A balance sheet never
    prints any of them: it states positions, not the year's traffic. */
const OPENING_ROW = /^(opening balance|balance (?:at|as at) (?:the )?(?:start|beginning) of (?:the )?year|brought forward)$/i;
const CLOSING_ROW = /^(closing balance|balance (?:at|as at) (?:the )?end of (?:the )?year|carried forward)$/i;
/** What a real balance sheet closes with. Its presence means the page states
    positions whatever else is on it, so the page is left alone. */
const BS_ANCHOR = /^(total (?:current |non-?current |term )?(?:assets|liabilities)|net assets|total (?:liabilities and )?(?:equity|capital))$/i;

/** Drop the pages that reconcile ONE account's movements over the year.
 *
 * A set of accounts often carries a page like "Shareholder Current Accounts",
 * laid out as opening balance, funds introduced, drawings, closing balance.
 * Every row on it reads like a balance-sheet caption and carries a figure, so
 * the page classifier files it as a balance sheet and all of it is booked.
 * On one 2025 file that put twelve non-balances onto Schedule F line 16 —
 * 113,062, the whole of the year-end imbalance — including the closing
 * balance, which the balance sheet proper had already supplied.
 *
 * The test is the shape the layout cannot have by accident: the page opens
 * with an opening balance AND closes with a closing balance, and states none
 * of the totals a balance sheet exists to state. The reason is kept on the
 * row so the log can say what was dropped and the preparer can disagree. */
export function dropMovementSchedules<T extends MapRow>(rows: T[]): T[] {
  const byPage = new Map<number, T[]>();
  for (const m of rows) {
    const page = Number(m.row && m.row.page);
    if (!isFinite(page)) continue;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page)!.push(m);
  }
  const movement = new Set<number>();
  for (const [page, list] of byPage) {
    const label = (m: T) => String((m.row && m.row.label) || "").trim();
    if (list.some((m) => BS_ANCHOR.test(label(m)))) continue;
    if (list.some((m) => OPENING_ROW.test(label(m))) && list.some((m) => CLOSING_ROW.test(label(m)))) {
      movement.add(page);
    }
  }
  if (!movement.size) return rows;
  return rows.map((m) =>
    movement.has(Number(m.row && m.row.page)) && !m.skipReason
      ? { ...m, skipReason: `page ${m.row.page} reconciles one account's movements over the year — it states no balances` }
      : m,
  );
}

/** Caption reduced to the letters and digits that carry meaning, so that
    "Total Payroll Expenses" and "Payroll Expenses" compare equal. */
const totalKey = (label: string) =>
  String(label || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The same job structRows does, for feeds that have no indent to read.
 *
 * A spreadsheet export carries no x-geometry, so the whole arithmetic
 * hierarchy in structRows is unavailable and every group subtotal arrived as
 * an ordinary account — QuickBooks' "Total Payroll Expenses" was booked
 * alongside the payroll accounts it totals, counting them twice. Two tests,
 * both of which need the report's own words to agree with its own arithmetic
 * before anything is dropped:
 *
 *   1. the caption is "Total <X>" and an earlier caption IS <X> — the group
 *      opened by name and is closing by name — and the rows since that
 *      caption add up to this figure;
 *   2. the caption merely starts with a total word, and the rows since the
 *      previous total add up to this figure.
 *
 * A total word with no arithmetic behind it is left as data: a real account
 * can be called "Total Return Fund", and guessing costs the preparer a line
 * they cannot see. */
export function gridStructRows<T extends MapRow>(rows: T[]): T[] {
  const out = rows.map((m) => ({ ...m }));
  let sinceTotal = 0;
  let runStart = 0;
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const amt = amtOf(m);
    const label = String((m.row && m.row.label) || "").trim();
    if (amt === null || m.skipReason) continue;
    if (!TOTAL_WORD.test(label)) { sinceTotal += amt; continue; }

    const named = totalKey(label.replace(/^(sub-?)?totals?\s+(for|of)?\s*/i, ""));
    let matched = false;
    if (named) {
      for (let j = i - 1; j >= 0; j--) {
        if (totalKey(String((out[j].row && out[j].row.label) || "")) !== named) continue;
        let sum = 0;
        for (let k = j; k < i; k++) {
          const a = amtOf(out[k]);
          if (a !== null && !out[k].skipReason) sum += a;
        }
        if (same(sum, amt)) {
          out[i].skipReason = `total of the rows listed under "${String(out[j].row.label).trim()}"`;
          for (let k = j; k < i; k++) if (amtOf(out[k]) !== null && !out[k].skipReason) out[k].inTotal = true;
          matched = true;
        }
        break;
      }
    }
    if (!matched && i > runStart && same(sinceTotal, amt)) {
      out[i].skipReason = `total of the ${i - runStart} row(s) above it`;
      for (let k = runStart; k < i; k++) if (amtOf(out[k]) !== null && !out[k].skipReason) out[k].inTotal = true;
      matched = true;
    }
    if (matched) { sinceTotal = 0; runStart = i + 1; continue; }
    sinceTotal += amt;
  }
  return out;
}

/** Does this booking need the contra-revenue sign reversed?
 *
 * Schedule C line 1b is SUBTRACTED from line 1a, so the figure that belongs
 * on it is the negative of what the caption contributes to income — and what
 * it contributes is whatever the statement's own total says. QuickBooks
 * prints "Discounts given 305.92" inside the income group and ADDS it, so
 * booking +305.92 to line 1b would take the discount off twice and move the
 * client's bottom line. Only a row a subtotal was proven to add is flipped:
 * the classic "Gross sales / Less returns / Net sales" layout fails that
 * proof (its total does not add the returns line) and its figure is already
 * the right way round. */
/** A gain-or-loss caption printed inside an expense group is a LOSS.
 *
 * Schedule C lines 8a and 8b hold a signed figure, so a statement that files
 * "Exchange gain or loss 10.16" under its "Other Expenses" heading means minus
 * ten dollars sixteen, not plus. Narrow on purpose: only the two currency
 * lines, only from a cost section, only when the statement printed it
 * positive. */
export const expenseGainFlip = (
  target: string | null | undefined,
  section: Section | null | undefined,
  printed?: number,
) =>
  (target === "IS:19" || target === "IS:20") &&
  (section === "costs" || section === "cogs") &&
  typeof printed === "number" && printed > 0;

/** Schedule C deduction rows carry positive magnitudes. Some continental
    statements print costs as negative figures, but we only normalize them
    when their own proved subtotal added those negatives. That avoids turning
    a genuine credit into an expense. */
export const deductionMagnitudeFlip = (
  target: string | null | undefined,
  section: Section | null | undefined,
  inTotal?: boolean,
  printed?: number,
) =>
  /^IS:(2[6-9]|3\d|4\d|50)$/.test(String(target || "")) &&
  (section === "costs" || section === "cogs") &&
  !!inTotal && typeof printed === "number" && printed < 0;

export const contraRevenueFlip = (
  target: string | null | undefined,
  inTotal?: boolean,
  printed?: number,
) =>
  target === "IS:8" &&
  /* Either the statement already added the caption inside its own income
     total (the QuickBooks shape), or it printed the caption negative. Line 1b
     is SUBTRACTED from line 1a by the template, so it can only ever hold a
     positive magnitude: a negative there is added back. On the SHORI 2024 run
     a -523,743.76 sales return on line 1b moved gross profit by twice itself,
     1,047,487.52, because neither condition was being tested. */
  (!!inTotal || (typeof printed === "number" && printed < 0));

/** Tag every row with the last banner seen above it. Sticky downward, first
    matching pattern wins, and a row that already carries a section is never
    re-tagged — the tag may have come from a source that knows better. */
export function tagSections<T extends MapRow>(rows: T[]): T[] {
  let current: Section | null = null;
  return rows.map((m) => {
    const label = String((m.row && m.row.label) || "").trim();
    for (const [re, section] of SECTION_BANNERS) {
      if (re.test(label)) { current = section; break; }
    }
    return m.section !== undefined ? m : { ...m, section: current };
  });
}

/* ---------- the veto and the fallback ---------- */

/** Which side of the balance sheet a Schedule F line sits on. */
export function bsSide(target: string): "assets" | "liabilities" | null {
  const m = /^BS:(\d+)/.exec(String(target || ""));
  if (!m) return null;
  const spec = BS_LINES.find((l) => l.row === Number(m[1]));
  return spec ? (/assets/i.test(spec.group) ? "assets" : "liabilities") : null;
}

/** May a caption printed under `section` be booked to `target`?
 *
 * This is a veto, not a router: it only ever refuses. A balance-sheet banner
 * cannot book an income line and an income banner cannot book a balance —
 * that contradiction is the statement's own words disagreeing with the
 * keyword match, and the statement wins. Pool ids that carry no side of their
 * own pass; so does a row with no banner above it, because absence of
 * evidence is not evidence. */
/* The Schedule C lines that are revenue rather than cost. Rows 10-12 carry
   the group "Income" in the line table because the form nets cost of goods
   sold inside gross income, so the group name cannot be used to tell them
   apart — they are listed here by row instead. */
const INCOME_TARGETS = new Set(["IS:7", "IS:14", "IS:15", "IS:16", "IS:17", "IS:18", "IS:19", "IS:20", "IS:22", "IS:23", "IS:24", "IS:OI"]);
/** Where a caption printed under an "Other income" banner may land. Gross
    receipts is deliberately absent: the statement has already said this is not
    turnover. Everything else on the income half of Schedule C is fair game. */
/** Where a caption printed under a non-current / term liabilities banner may
    land: Schedule F line 19 and its detail rows, the shareholder loan line,
    and derivatives. Line 16 is deliberately absent. */
const NON_CURRENT_LIABILITY_TARGETS = new Set([
  "BS:OL", "BS:51", "BS:52", "BS:54", "BS:55", "BS:56",
  /* Equity is printed BELOW the long-term liabilities and the banner is
     sticky, so an equity caption reaches here whenever the statement does not
     announce its equity section by a name the lexicon knows. Vetoing those
     would push retained earnings onto a liability line. */
  "BS:58", "BS:59", "BS:60", "BS:61", "BS:62",
]);
const OTHER_INCOME_TARGETS = new Set(["IS:14", "IS:15", "IS:16", "IS:17", "IS:18", "IS:19", "IS:20", "IS:22", "IS:23", "IS:24", "IS:OI"]);

export function sectionOk(section: Section | null | undefined, target: string | null | undefined): boolean {
  if (!section || !target) return true;
  const isBs = /^BS/.test(target);
  /* A caption printed under "Cost of Sales" is a cost, whatever the keyword
     scan made of its name. "Shopify payment fees" and "Freight" carry no cost
     word at all, and the fee captions in particular used to reach gross
     receipts and inflate income by their whole amount. Contra-revenue (IS:8)
     and the cost lines themselves are left alone. */
  if (section === "cogs") return !isBs && !INCOME_TARGETS.has(target);
  /* The mirror of the cogs rule. "Motor Vehicle Contribution" is printed under
     Other Income and is a receipt, but the keyword scan saw "motor vehicle"
     and sent it to the motor-vehicle expense line -- so the figure came out of
     income AND went into deductions, moving the bottom line by twice itself. */
  if (section === "otherIncome") return !isBs && OTHER_INCOME_TARGETS.has(target);
  /* A liability the statement filed under "Non-Current Liabilities" belongs on
     Schedule F line 19, never on line 16. Everything else on the liabilities
     side stays reachable: a term loan from a shareholder is still line 18. */
  if (section === "termLiabilities") return isBs && NON_CURRENT_LIABILITY_TARGETS.has(target);
  if (section === "cash") return target === "BS:10";
  if (section === "assets" || section === "liabilities") {
    if (!isBs) return false;
    const side =
      target === "BS:OCA" ? "assets"
      : target === "BS:OCL" || target === "BS:OL" ? "liabilities"
      : bsSide(target);
    return !side || side === section;
  }
  if (section === "income" || section === "costs") return !isBs;
  return true;
}

/** Where a caption goes when no keyword rule matched but its banner is known.
 *
 * Only ever reached after the rules have failed, so it is a last resort, and
 * it is honest about what it knows: the ASSETS branch has NO catch-all,
 * because "some asset" is not a Schedule F line and guessing one would put a
 * figure in a place no one can find. The other three sides do have a
 * catch-all, because each has a genuine "other" line built for exactly this. */
export function sectionRoute(section: Section | null | undefined, label: string): string | null {
  const s = String(label || "").toLowerCase();
  /* These two DO have a catch-all, for the same reason collapsedRoute does:
     the banner already said what the figure is. Everything under a bank-
     accounts heading is cash; everything under a cost-of-sales heading is a
     cost of goods sold, and line 2 is where the form puts the ones that are
     neither labour nor purchases. */
  if (section === "cash") return "BS:10";
  /* The banner already said what the figure is, so the catch-all is safe: an
     unrecognised caption under "Other income" IS other income. */
  if (section === "termLiabilities") {
    // The equity tests first, and in the same order as the liabilities branch
    // below: the banner is sticky and equity prints underneath it.
    if (/share capital|common stock|ordinary shares|issued capital|aandelenkapitaal/.test(s)) return "BS:59";
    if (/reserve|retained earning|accumulated (profit|loss|deficit)|distributable/.test(s)) return "BS:61";
    if (/current account/.test(s) && !/vat|tax/.test(s)) return "BS:52";
    if (/shareholder|director|related part/.test(s)) return "BS:52";
    return "BS:OL";
  }
  if (section === "otherIncome") {
    if (/\b(dividend)/.test(s)) return "IS:14";
    if (/\b(interest)/.test(s)) return "IS:15";
    if (/\b(rent)/.test(s)) return "IS:16";
    if (/\b(royalt|licence fee|license fee)/.test(s)) return "IS:17";
    if (/\b(gain|loss)\b.*\b(sale|disposal)|\b(sale|disposal)\b.*\b(asset)/.test(s)) return "IS:18";
    return "IS:OI";
  }
  if (section === "cogs") {
    if (/\b(labour|labor|wage|salar|payroll|subcontract|sub-contract)/.test(s)) return "IS:10";
    if (/\b(purchase|goods|material|stock|inventor|supplier)/.test(s)) return "IS:11";
    return "IS:12";
  }
  if (section === "assets") {
    if (/\b(depreciat|amorti[sz])/.test(s)) return "BS:29";
    if (/\b(receivable|debtor)/.test(s)) return "BS:11";
    /* The mirror of the liabilities branch below. A shareholder current
       account swings between the two sides year to year, and the balance
       sheet says which side it is on THIS year by where it prints it. */
    if (/current account|\bloan\b/.test(s) && !/vat|tax/.test(s)) return "BS:19";
    if (/\b(vat|tax|gst|prepaid|deposit|accrued income)/.test(s)) return "BS:OCA";
    return null;
  }
  if (section === "liabilities") {
    if (/share capital|common stock|ordinary shares|issued capital|aandelenkapitaal/.test(s)) return "BS:59";
    if (/reserve|retained earning|accumulated (profit|loss|deficit)|distributable/.test(s)) return "BS:61";
    if (/\b(unearned|deferred)\s+(income|revenue)|invoices? to be received|accrued/.test(s)) return "BS:OCL";
    if (/current account|loan/.test(s) && !/vat|tax/.test(s)) return "BS:52";
    if (/\b(creditor|payable)/.test(s)) return "BS:46";
    return "BS:OCL";
  }
  if (section === "income") {
    if (/referral fee|commission|sundry income|other income|royalt/.test(s)) return "IS:OI";
    return "IS:7";
  }
  if (section === "costs") {
    if (/salar|wage|personnel|remuneration|directors? and managers|wkr/.test(s)) return "IS:26";
    if (/\b(depreciat|amorti[sz])/.test(s)) return "IS:30";
    if (/interest/.test(s)) return "IS:29";
    if (/\bfx\b|exchange (gain|loss)|currency (gain|loss)/.test(s)) return "IS:19";
    if (/\b(income tax|corporat\w* tax|profit tax|vennootschapsbelasting|körperschaftsteuer)/.test(s)) return "IS:62";
    if (/\b(tax|belasting)/.test(s)) return "IS:OD";
    return "IS:OD";
  }
  return null;
}

/** Rows whose banner puts them on the other side of the statement from the
    page they were read on. Returns the two feeds with those rows exchanged,
    and how many moved — the caller logs the count. */
export function refeedBySection(isRows: MapRow[], bsRows: MapRow[]): { is: MapRow[]; bs: MapRow[]; moved: number } {
  const onBs = (m: MapRow) => m.section === "assets" || m.section === "liabilities" || m.section === "cash" || m.section === "termLiabilities";
  const onIs = (m: MapRow) => m.section === "income" || m.section === "costs" || m.section === "cogs" || m.section === "otherIncome";
  const toBs = isRows.filter(onBs);
  const toIs = bsRows.filter(onIs);
  if (!toBs.length && !toIs.length) return { is: isRows, bs: bsRows, moved: 0 };
  return {
    is: isRows.filter((m) => !onBs(m))
      .concat(toIs.map((m) => ({ ...m, feed: "is" as const }))),
    bs: bsRows.filter((m) => !onIs(m))
      .concat(toBs.map((m) => ({ ...m, feed: "bs" as const }))),
    moved: toBs.length + toIs.length,
  };
}

/* ---------- collapsed sections ----------

   QuickBooks' summary balance sheet prints a section's total AS the section:

       Current Assets                     $24,292.34
       Long-term assets
     Total for Assets                     $24,292.34

   "Current Assets" is a banner by name, so it was tagged as a section and
   never booked; the assets side has no fallback line on purpose; and the
   entity's entire asset base went to the unmatched list. A heading that
   carries a figure and has NO value-bearing rows indented beneath it is not a
   heading — it is the only line the section has, and it belongs on that
   section's "other" line. A heading with itemised children beneath it is left
   alone: structRows already drops it as their summary. */

/** Mark section-named rows that carry the section's figure with nothing
    itemised beneath them. Run AFTER structRows, on positioned (PDF) rows only:
    grid rows have no indent, so every row would look childless. */
export function collapsedSections<T extends MapRow>(rows: T[]): T[] {
  return rows.map((m, i) => {
    if (m.skipReason || m.row.isBanner || amtOf(m) === null) return m;
    const label = String(m.row.label || "").trim();
    let section: Section | null = null;
    for (const [re, s] of SECTION_BANNERS) if (re.test(label)) { section = s; break; }
    if (!section) return m;
    const ind = indentOf(m);
    const below: MapRow[] = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (indentOf(rows[j]) <= ind) break;
      below.push(rows[j]);
    }
    return kidsSum(below) ? m : { ...m, collapsed: section };
  });
}

/** Where a collapsed section's single figure goes. Unlike sectionRoute, this
    DOES have an answer for the assets side, because the figure is known to be
    the whole section rather than some unidentified caption within it. */
export function collapsedRoute(label: string, section: Section): string | null {
  const s = String(label || "").toLowerCase();
  if (section === "assets") {
    return /non-?current|long.?term|fixed|tangible|intangible|property|plant/.test(s) ? "BS:39" : "BS:OCA";
  }
  if (section === "liabilities") {
    if (/equity|capital|patrimonio|eigen vermogen|capitaux propres|fonds propres|shareholders?|stockholders?/.test(s)) return "BS:61";
    return /non-?current|long.?term/.test(s) ? "BS:OL" : "BS:OCL";
  }
  if (section === "income") return "IS:7";
  if (section === "costs") return "IS:OD";
  if (section === "cash") return "BS:10";
  if (section === "cogs") return "IS:12";
  if (section === "otherIncome") return "IS:OI";
  if (section === "termLiabilities") return "BS:OL";
  return null;
}

/* ---------- the profit line in an equity section ----------

   "Net income" is a subtotal on a P&L and is rightly SKIPped there. On a
   QuickBooks balance sheet it is something else: equity is presented as
   "Retained Earnings" (prior years) + "Net Income" (this year), and the second
   line is a real component of closing equity. Skipping it understated retained
   earnings by the whole year's profit. The SKIP is therefore feed-aware for
   the profit captions only. */
const PROFIT_LINE = /^(net\s+(income|earnings|profit|loss)|(profit|loss)\s+(for|of)\s+the\s+(year|period)|current[-\s]year\s+(earnings|profit|net\s+income|result))\b/i;

/** The retained-earnings line, when a SKIP-matched profit caption sits on the
    balance-sheet side; null when the SKIP should stand. */
export function equityOverride(label: string, feed: MapRow["feed"], section?: Section | null): string | null {
  if (feed !== "bs" && section !== "liabilities") return null;
  return PROFIT_LINE.test(String(label || "").trim()) ? "BS:61" : null;
}
