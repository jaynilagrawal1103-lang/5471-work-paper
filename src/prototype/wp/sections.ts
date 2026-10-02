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

import { BS_LINES, foldAccents } from "./engine";
import type { ExtractedRow } from "./engine";
import { CASH_GROUP, SECTION_BANNERS, SECTION_RESETS, deglue, isBannerLabel, SELF_SECTION_ROWS, TITLE_NOT_BANNER_WITH_FIGURES, bannerKey, type Section } from "./sectionBanners";

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
  /** A numbered-box return's box code decided the line (see BOXED_FORMS);
      the caption's words play no part. */
  formTarget?: string;
  formCode?: string;
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
  /** A collapsed row that is also the FIRST figure of its section: nothing
      printed above it under the same banner could be what it totals. Only
      such a row may outrank a SKIP keyword ("Cost of sales" on a summary
      P&L is the whole cost line, not a total of rows booked elsewhere). */
  collapsedLead?: boolean;
  /** This row is one of the figures a subtotal was PROVEN to add up, so the
      statement's own arithmetic adds it with the sign it is printed with.
      Set by structRows and gridStructRows; read when a caption is routed to a
      contra line, where the sign is the whole question. */
  inTotal?: boolean;
  /** The statement's own sub-group this account sits in ("Credit Cards",
      "7300 Advertising expense"), when a printed total proved the group.
      Set by tagStatementGroups; a shared template row shows the group. */
  group?: string;
  /** Every proven group this account sits in, innermost first ("1301 · Bar
      Stock", then "Inventory and Supplies"). Outer groups included, section
      banners not. Read when the account's own caption matches no rule: the
      statement's heading says what it is. Set by tagStatementGroups. */
  groups?: string[];
  /** Headings whose printed figure is the sum of this row and its siblings,
      innermost first. Used only to place a row nothing else places. */
  summaryGroups?: string[];
  /** Set by the agent's understanding phase when it judged a row the structure
      pass dropped to be a line item after all. Carries the reason, so the
      Review row can quote it. Never books anything by itself. */
  agentImportant?: string;
  /** The first row of a page that repeats the previous page's statement
      title: the statement continues, and so does its section. */
  continuesSection?: boolean;
  /** The printed total this row is left out of. Set by outsidePrintedTotal
      when the group's other rows add up to the printed total exactly and
      this row is the whole difference. The row is not booked; the booking
      loop raises a review item quoting the total. */
  outsideTotal?: string;
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

/* ---------- the statement's own sub-groups ---------- */

/** Which accounts the statement itself groups under one heading.

    A bookkeeping package prints a group heading, its accounts and a
    "Total <heading>" line; structRows proves the arithmetic and sets the
    total aside. The accounts keep their own captions, so twelve credit-card
    accounts took three "other current liability" rows one by one (zero
    balances included) and the rest spilled into "Other (14 accounts)" — while
    the reviewed papers show one row per group: "Credit Card", "Advertising
    Expenses", "Office Costs". Each account is tagged with the INNERMOST
    group that a proven total closes. Section headings ("Expenses", "Current
    Liabilities") are not groups — they span many schedule lines — and a group
    that contains another group's total is an outer group, never used. Rows
    from different documents are never grouped together. */
export function tagStatementGroups(rows: MapRow[]): MapRow[] {
  const label = (r: MapRow) => String(r.row.label || "").trim();
  const chain = new Map<MapRow, Array<{ caption: string; size: number }>>();
  const summaryChain = new Map<MapRow, Array<{ caption: string; size: number }>>();
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    const why = m.skipReason || "";
    if (!why) continue;
    const ind = indentOf(m);
    const sameDoc = (r: MapRow | undefined) => !!r && r.docId === m.docId;
    let members: MapRow[] = [];
    let caption = "";
    let withParent: MapRow | null = null;
    if (/^summary of the \d+ row\(s\) indented beneath it$/.test(why)) {
      /* The same boundary structRows used to prove the summary: a heading of
         another section ends it ("Turnover" does not own the costs). */
      const otherSection = (r: MapRow) => !!r.row.isBanner && !!r.section && !!m.section && r.section !== m.section;
      for (let j = i + 1; j < rows.length && sameDoc(rows[j]) && indentOf(rows[j]) > ind && !otherSection(rows[j]); j++) members.push(rows[j]);
      caption = label(m);
    } else if (/^total of ".+" and the \d+ row\(s\) beneath it$/.test(why)) {
      let j = i - 1;
      for (; j >= 0 && sameDoc(rows[j]) && indentOf(rows[j]) > ind; j--) members.unshift(rows[j]);
      withParent = sameDoc(rows[j]) ? rows[j] : null;
      if (!withParent) continue;
      caption = label(withParent);
    } else if (/^total of the \d+ row\(s\) (above it|printed flush above it)$/.test(why)) {
      const flush = /flush/.test(why);
      for (let j = i - 1; j >= 0 && sameDoc(rows[j]); j--) {
        const r = rows[j];
        const d = indentOf(r);
        if (flush ? d < ind : d <= ind) break;
        if (flush && d > ind) continue;
        if (TOTAL_WORD.test(label(r))) { if (flush) break; members.unshift(r); continue; }
        if (flush && amtOf(r) === null) break;
        members.unshift(r);
      }
      caption = label(m).replace(TOTAL_WORD, "").replace(/^[\s:–-]+/, "").trim();
    } else continue;
    /* The heading of a proven summary is weaker evidence than a printed
       "Total <heading>" (on a scan the indent is the OCR's guess), so it is
       kept apart: it only places an account that no rule, banner or printed
       group could ("7500, Vehicle leasing" under "Other operating expenses
       118,328.32"), and never overrides one that something else placed. A
       caption that reads like a section banner counts here: carrying its own
       proven figure ("Other current assets 1,848.16"), it is a group. */
    if (caption && /^summary of/.test(why)) {
      for (const r of members) {
        if (r.row.isBanner || r.skipReason || amtOf(r) === null || TOTAL_WORD.test(label(r))) continue;
        const c = summaryChain.get(r) || [];
        if (!c.some((g) => g.caption === caption)) c.push({ caption, size: members.length });
        summaryChain.set(r, c);
      }
    }
    if (!caption || isBannerLabel(caption)) continue;
    /* The whole chain, outer groups included: an account's own group may be
       a heading no rule knows ("1301 · Bar Stock") while the group around it
       says exactly what it is ("Inventory and Supplies"). */
    /* Only a group a printed "Total <heading>" closes: a caption printed with
       its own figure over indented rows ("summary of the rows beneath it")
       is weaker evidence — on a scanned page the indent is the OCR's guess. */
    const inside = /^summary of/.test(why) ? [] : members.filter((r) => !r.row.isBanner && !r.skipReason && amtOf(r) !== null && !TOTAL_WORD.test(label(r)));
    if (withParent && amtOf(withParent) !== null) inside.unshift(withParent);
    for (const r of inside) {
      const c = chain.get(r) || [];
      if (!c.some((g) => g.caption === caption)) c.push({ caption, size: members.length });
      chain.set(r, c);
    }
    /* A group holding another group's total is the outer one. */
    if (members.some((r) => r.skipReason && !r.row.isBanner)) continue;
    const leaves = members.filter((r, k) => !r.row.isBanner && amtOf(r) !== null
      && !(k + 1 < members.length && indentOf(members[k + 1]) > indentOf(r)));
    if (withParent && amtOf(withParent) !== null) leaves.unshift(withParent);
    for (const r of leaves) if (!r.group) r.group = caption;
  }
  for (const [r, c] of chain) r.groups = c.sort((a, b) => a.size - b.size).map((g) => g.caption);
  for (const [r, c] of summaryChain) r.summaryGroups = c.sort((a, b) => a.size - b.size).map((g) => g.caption);
  return rows;
}

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

/* A column heading read as a row: "Descripción 2024" over a note's figures,
   "Details 2023 2022". The figures are the column's YEARS, not money. Only a
   caption that names a column, with nothing but plausible years beside it. */
const COLUMN_HEADER_WORD = /^(?:descripci[oó]n|detalle|concepto|cuenta|partida|nota|notas|description|details?|particulars|account|item|note|notes)$/i;
export const isYearHeaderRow = (m: MapRow): boolean => {
  const v = (m.row && m.row.values) || [];
  return !!v.length && COLUMN_HEADER_WORD.test(bannerKey(String((m.row && m.row.label) || "")))
    && v.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 1990 && x <= 2100);
};

export function dropFurniture(rows: MapRow[]): MapRow[] {
  const junk = furnitureKeys(rows);
  /* The statement title a continuation page repeats is furniture, but it is
     also the only proof that the page continues the statement before it.
     Remember which titles each page repeated, so the first row left on a
     page that repeats its predecessor's title can say it continues it. A
     letterhead repeats on every page too, but is no statement title. */
  const titles = new Map<string, Set<string>>();
  const pageKey = (m: MapRow) => `${m.docId}#${m.row && m.row.page}`;
  const kept = rows.filter((m) => {
    if (isYearHeaderRow(m)) return false;
    if (amtOf(m) !== null) return true;
    const key = String((m.row && m.row.label) || "").replace(/\d+/g, "#").trim().toLowerCase();
    if (!junk.has(key)) return true;
    if (typeof (m.row && m.row.page) === "number" && isBannerLabel(String(m.row.label || ""))) {
      if (!titles.has(pageKey(m))) titles.set(pageKey(m), new Set());
      titles.get(pageKey(m))!.add(key);
    }
    return false;
  });
  if (!titles.size) return kept;
  const seen = new Set<string>();
  return kept.map((m) => {
    const page = m.row && m.row.page;
    if (typeof page !== "number") return m;
    const k = pageKey(m);
    if (seen.has(k)) return m;
    seen.add(k);
    const mine = titles.get(k), before = titles.get(`${m.docId}#${page - 1}`);
    return mine && before && [...mine].some((x) => before.has(x)) ? { ...m, continuesSection: true } : m;
  });
}

/** A statement that runs onto the next page keeps its section there. The
    page reset (each new page starts with no section) stops a balance sheet
    inheriting the profit and loss's "costs" — but a P&L whose page 3 opens
    with "7990, Other entertainment expenses" is still in its expenses, and
    with the reset those rows lost the banner that places them. The page is
    marked as continuing when the same document's previous page carried on to
    its last row without closing the statement (no profit or result line last)
    and the new page does not open with a heading of its own. */
export function markContinuedPages<T extends MapRow>(rows: T[]): T[] {
  let prevPage: number | null = null, prevDoc: string | null = null;
  let lastValued: T | null = null;
  const out: T[] = [];
  for (const m of rows) {
    const page = m.row && m.row.page;
    if (typeof page !== "number") { out.push(m); continue; }
    if (page !== prevPage || m.docId !== prevDoc) {
      const lastLabel = lastValued ? String(lastValued.row.label || "") : "";
      const cont = prevPage !== null && m.docId === prevDoc && page === prevPage + 1 && !m.row.isBanner
        && !!lastValued && !isProfitLine(lastLabel) && !isResultSubtotal(lastLabel);
      if (m.docId !== prevDoc) lastValued = null;
      prevPage = page; prevDoc = m.docId as string;
      out.push(cont && !m.continuesSection ? { ...m, continuesSection: true } : m);
    } else out.push(m);
    if (!m.row.isBanner && m.row.values && m.row.values.length) lastValued = m;
  }
  return out;
}

/* ---------- structural subtotals ---------- */

/* "NET OTHER INCOME" and "NET OPERATING INCOME" are QuickBooks' own summary
   lines, printed at the outermost indent beside "NET INCOME". Without them
   in this lexicon, "NET OTHER INCOME" survived to the keyword scan, matched
   "other income" and was booked as a second other-income account. */
const TOTAL_WORD = /^(total(?:es)?|subtotal|sub-total|sumas? de(?:l|\s+l[ao]s?)?|sum|net result|net\s+(?:other\s+|operating\s+)?(?:income|earnings|profit|loss)|grand total|totaal|totale|gesamt|合计|總計)\b|\b(?:ingresos|gastos|costos|activos|pasivos|patrimonio)\s+totales?\b/i;

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
/** Indents a hair apart are one indent. A machine-translated statement
    re-sets each caption in its own font, so rows that are visually flush sit
    at 56.0, 56.2 and 56.6: read literally, "Sales, securities and real
    estate" at 56.6 became a child of "General sales accounts" at 56.0, no
    group added up, and a heading was booked on top of its own accounts.
    Within one document, x positions closer than 1.2 points to the first of
    their run are snapped to it; real indent steps are several points wide. */
function snapIndents(rows: MapRow[]): void {
  const byDoc = new Map<string, MapRow[]>();
  for (const m of rows) {
    if (typeof m.x0 !== "number") continue;
    const k = String(m.docId ?? "");
    if (!byDoc.has(k)) byDoc.set(k, []);
    byDoc.get(k)!.push(m);
  }
  for (const list of byDoc.values()) {
    const xs = [...new Set(list.map((m) => m.x0 as number))].sort((a, b) => a - b);
    const rep = new Map<number, number>();
    let start = xs[0];
    for (const x of xs) { if (x - start > 1.2) start = x; rep.set(x, start); }
    for (const m of list) m.x0 = rep.get(m.x0 as number);
  }
}

/** A row whose LAST figure is nil can still prove itself a group's total by
    its other columns. "Profit (loss) for the period  281,466.94  0.00" over
    "2370, Result for the financial period  281,466.94  0.00" is one figure
    printed twice; tested on the closing column alone (nil, which proves
    nothing) both were booked and the opening retained earnings doubled.
    Every column must add up, and at least one of them must be non-nil. */
function everyColumnAdds(m: MapRow, kids: MapRow[]): boolean {
  const v = (m.row.values || []) as number[];
  if (v.length < 2 || !kids.length || !kids.every((k) => ((k.row.values || []) as number[]).length === v.length)) return false;
  let nonNil = false;
  for (let c = 0; c < v.length; c++) {
    const sum = kids.reduce((n, k) => n + ((k.row.values as number[])[c] || 0), 0);
    if (!same(sum, v[c])) return false;
    if (v[c] !== 0) nonNil = true;
  }
  return nonNil;
}

export function structRows(rows: MapRow[]): MapRow[] {
  const out = dropFurniture(rows).map((m) => ({ ...m }));
  if (!out.length) return out;
  snapIndents(out);

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
      /* A heading that opens another section ends the group, however deep it
         is printed: "Turnover" sits left of "Materials and services", and
         without this the costs were counted into turnover's components. */
      if (out[j].row.isBanner && out[j].section && m.section && out[j].section !== m.section) break;
      below.push(out[j]);
    }
    const summary = kidsSum(below);
    /* Whether a caption is the group's total or one of its members is decided
       by the WORDS when the indentation says the opposite. A Spanish-language
       package indents "Total Pasivo a corto plazo" one level IN from the
       accounts it adds, so the hierarchy reads upside down: each account
       looked like the summary of the total beneath it and was dropped, while
       the total looked like an ordinary account and was booked. */
    const totalWorded = (r: MapRow) => TOTAL_WORD.test(String(r.row.label || "").trim());
    const invertedByIndent = !!summary && !totalWorded(m) && summary.rows.length > 0 && summary.rows.every(totalWorded);
    /* Nil proves nothing. A row whose amount reads zero — because the figure
       columns are blank, or because the last column on the line is a
       percentage — "ties" to any run of zeros above or below it, and a real
       account was dropped as a total on that coincidence. */
    const provable = amt !== 0;
    /* A nil total. "Total FIJO 0.00" on the liabilities side of a Mexican
       balance sheet has no components to prove it against, and the nil guard
       above keeps the arithmetic tests from firing on it — so it survived as
       an ordinary account and was booked to a liability line. Nothing is lost
       by skipping it: it carries no money. */
    if (amt === 0 && TOTAL_WORD.test(String(m.row.label || "").trim())) {
      m.skipReason = "a nil total";
      continue;
    }
    if (summary && !invertedByIndent && (provable ? same(summary.sum, amt) : everyColumnAdds(m, summary.rows))) {
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
    if (total && (provable ? same(total.sum, amt) : everyColumnAdds(m, total.rows))) {
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

    /* The same group, printed the other way up: the total INDENTED from the
       accounts it adds. Indent cannot rank these, so the caption does — a
       total-worded row whose run of preceding non-total rows adds up to it is
       that run's total, wherever it sits on the page. */
    if (TOTAL_WORD.test(String(m.row.label || "").trim())) {
      const run: MapRow[] = [];
      let sum = 0;
      for (let j = i - 1; j >= 0; j--) {
        const prev = out[j];
        if (prev.row.isBanner) break;
        if (TOTAL_WORD.test(String(prev.row.label || "").trim())) break;
        const a = amtOf(prev);
        if (a === null) break;
        run.unshift(prev);
        sum += a;
      }
      if (run.length && same(sum, amt)) {
        m.skipReason = `total of the ${run.length} row(s) above it`;
        for (const kid of run) (kid as MapRow).inTotal = true;
        continue;
      }
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
const OPENING_ROW = /^(opening balance|balance (?:at|as at) (?:the )?(?:start|beginning) of (?:the )?year|brought forward|saldo inicial)$/i;
const CLOSING_ROW = /^(closing balance|balance (?:at|as at) (?:the )?end of (?:the )?year|carried forward|saldo final)$/i;
/** What a real balance sheet closes with. Its presence means the page states
    positions whatever else is on it, so the page is left alone. */
const BS_ANCHOR = /^(total (?:current |non-?current |term )?(?:assets|liabilities)|net assets|total (?:liabilities and )?(?:equity|capital))$/i;
/** A dated balance line: "At 1 December 2023", "Balance at 30 June 2024".
    A UK statement of changes in equity opens and closes each year with one;
    a balance sheet never prints one as a caption. Two distinct ones on a
    page are the same opening-and-closing shape as the worded pair above. */
/* The Spanish form: "Balance al 1 de enero de 2024", "Saldo al 31 de diciembre de 2024". */
const DATED_BALANCE_ROW = /^(?:(?:balance\s+)?(?:at|as\s+at)\s+\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+\b|(?:balance|saldos?)\s+al\s+\d{1,2}\s+de\s+[a-z\u00e0-\u00ff]+)/i;

/** Subtotals printed AFTER their items at the SAME indent, without a total
 *  word — the Swiss/French layout:
 *
 *      Banques                      0.00      72.45
 *      Trésorerie                   0.00      72.45    ← subtotal of the line above
 *      Charges à payer          1,300.00   1,300.00
 *      Provision pour impôts       96.00     150.00
 *      Passifs de régularisation 1,396.00  1,450.00    ← subtotal of the two above
 *
 *  structRows needs the items indented deeper or a total word, so these were
 *  booked on top of their own items — interest income counted twice once the
 *  items could be mapped. A row is taken as such a subtotal only when every
 *  one of its year columns (at least two) equals the sum of the same columns
 *  of the row(s) directly above it since the last heading, total or page
 *  break, and at least one of its figures is not zero. A single-column
 *  statement is never tested: there, two consecutive equal expenses are
 *  ordinary, and a guess would lose a real line. */
export function sameIndentSubtotals<T extends MapRow>(rows: T[]): T[] {
  const out = rows.map((m) => ({ ...m }));
  let run: T[] = [];
  let page: unknown = undefined;
  for (const m of out) {
    if (m.row.page !== page) { run = []; page = m.row.page; }
    const v = (m.row.values || []) as (number | null)[];
    if (m.skipReason || !v.length || amtOf(m) === null) { run = []; continue; }
    /* A caption that says it is a total ("Total", "Suma") may be tested on
       one column too: the word removes the guess the two-column rule guards
       against. A note that lists its components and then their Total books
       the components only. */
    const totalWord = TOTAL_WORD.test(String(m.row.label || "").trim());
    if (run.length && (v.length >= 2 || totalWord) && v.every((x) => typeof x === "number") && v.some((x) => x !== 0)) {
      let hit = 0;
      for (let k = 1; k <= run.length && !hit; k++) {
        const kids = run.slice(run.length - k);
        if (kids.some((r) => (r.row.values || []).length !== v.length || indentOf(r) + 1 < indentOf(m))) break;
        if (v.every((x, i) => same(kids.reduce((n, r) => n + ((r.row.values || [])[i] as number || 0), 0), x as number))) hit = k;
      }
      if (hit) {
        m.skipReason = `subtotal of the ${hit} row(s) directly above it`;
        for (const r of run.slice(run.length - hit)) r.inTotal = true;
        run = [];
        continue;
      }
    }
    run.push(m);
  }
  return out;
}

/** A row the statement's own total leaves out.

    A Colombian balance sheet lists "DEUDORES 82,600,026" among eleven
    receivable accounts whose printed "TOTAL DEUDORES" is 63,493,000; the
    other ten add up to it exactly. The same page prints "(-) Depr. Acumulada"
    inside the gross equipment group, whose total (239,472,448) is the four
    asset accounts alone, and then prints the depreciation again below that
    total. Both rows were booked, so receivables were overstated by the
    whole 82.6 million and depreciation was counted twice.

    The test is the statement's own arithmetic: under a total-worded row
    whose group does NOT add up, exactly one row of the group equals the
    whole difference, so the group ties without it. That row is left out and
    flagged, never silently dropped. Two guards keep a real account in:
    when some row printed positive would explain the gap as a subtraction
    ("Equipment 100, Less depreciation 50, Total 50"), the sign is the
    question, not the row, and nothing is excluded; and a nil total, a total
    already proven, or a single-row group is never tested. */
export function outsidePrintedTotal<T extends MapRow>(rows: T[]): T[] {
  const out = rows.map((m) => ({ ...m }));
  const label = (m: MapRow) => String((m.row && m.row.label) || "").trim();
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.row.isBanner || !TOTAL_WORD.test(label(t))) continue;
    if (t.skipReason && /^(total of|summary of|subtotal of)/.test(t.skipReason)) continue;
    const total = amtOf(t);
    if (total === null || total === 0) continue;
    const group: T[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const r = out[j];
      if (r.row.page !== t.row.page || r.row.isBanner || TOTAL_WORD.test(label(r))) break;
      if (r.skipReason) break;
      if (amtOf(r) === null) break;
      group.unshift(r);
    }
    if (group.length < 3) continue;
    const sum = group.reduce((n, r) => n + (amtOf(r) as number), 0);
    if (same(sum, total)) continue;
    const gap = sum - total;
    const extra = group.filter((r) => (amtOf(r) as number) !== 0 && same(amtOf(r) as number, gap));
    if (extra.length !== 1) continue;
    if (group.some((r) => (amtOf(r) as number) > 0 && same(sum - 2 * (amtOf(r) as number), total))) continue;
    const kept = group.filter((r) => r !== extra[0]);
    if (!kept.some((r) => amtOf(r) !== 0)) continue;
    const name = label(t);
    extra[0].skipReason = `not part of the printed total "${name}" — the other ${kept.length} row(s) add up to it exactly without it`;
    extra[0].outsideTotal = name;
    if (!t.skipReason) t.skipReason = `total of the ${kept.length} row(s) above it`;
    for (const r of kept) r.inTotal = true;
  }
  return out;
}

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
    } else if (new Set(list.filter((m) => DATED_BALANCE_ROW.test(label(m))).map((m) => label(m).toLowerCase())).size >= 2) {
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
  /* "IS:OD" is the other-deductions pool before a row is chosen for it:
     line 17's accounts are deductions too, and printed negative inside a
     negative proved total they were booked as credits. Cost of goods sold
     (lines 2's components, IS:10-12) is a cost the same way: a statement
     that prints its costs negative printed "4210, Purchases" as -2,469.54. */
  /^IS:(1[0-2]|2[6-9]|3\d|4\d|50|OD)$/.test(String(target || "")) &&
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
/* headingsOnly: only a heading row (no figure) opens a section. A spreadsheet
   often starts with its title and year on one row ("Income statement, 2024"),
   and that row must not put every account beneath it in the income section. */
/* A narrow group's own total closes it, and what follows belongs to the
   wider side it sits in. */
const CLOSES_TO: Partial<Record<Section, Section>> = { fixedAssets: "assets", termLiabilities: "liabilities" };

export function tagSections<T extends MapRow>(rows: T[], opts?: { headingsOnly?: boolean }): T[] {
  let current: Section | null = null;
  /* A section never runs past its page or its statement. A new page, or a
     cash-flow or notes title, starts with no section: the equity banner at
     the foot of a balance sheet put every cash-flow line, note figure and
     identity-card digit after it into retained earnings. The one exception
     is a page proven to continue the same statement (it repeats the title,
     see dropFurniture). A spreadsheet has no pages, so its sections run as
     before. */
  let at: string | null = null;
  /* What was current when each narrow banner opened. A narrow group's total
     hands the section back to whatever held it before the group began, so a
     "Fixed Assets" group nested inside "Long-term assets" returns to the
     long-term assets when its total is printed, instead of to the generic
     assets side, where "Furniture and Equipment 130,916" had no route. */
  let opened: Partial<Record<Section, Array<Section | null>>> = {};
  return rows.map((m) => {
    const label = bannerKey(String((m.row && m.row.label) || ""));
    const figures = !!(m.row && m.row.values && m.row.values.length);
    const where = m.row && typeof m.row.page === "number" ? `${m.docId}#${m.row.page}` : null;
    if (where !== null && where !== at) { if (!m.continuesSection) { current = null; opened = {}; } at = where; }
    if (!figures && SECTION_RESETS.some((re) => re.test(label))) current = null;
    let self = false;
    if (!(figures && opts?.headingsOnly)) for (const [re, section] of SELF_SECTION_ROWS) {
      if (re.test(label)) { current = section; self = true; break; }
    }
    let own: Section | null = null;
    /* Any total printed inside the cash group closes it, whatever it is
       called ("Total Cash and cash equivalents 0.00"). Left open, the bank
       account, the inventory and the prepayments printed after it were all
       booked as cash. */
    let cashClosed = false;
    if (figures && current === "cash" && /^total\b/i.test(label)) { own = "cash"; current = "assets"; cashClosed = true; }
    if (!cashClosed && !self && !(figures && opts?.headingsOnly) && !(figures && TITLE_NOT_BANNER_WITH_FIGURES.test(label))) {
      for (const [re, section] of SECTION_BANNERS) {
        if (!re.test(label)) continue;
        /* Cash is an asset. On the liabilities or equity side a caption that
           reads like a bank group ("Savings Account 16,135" under "Current
           liabilities") is a liability, and switching to cash there booked it
           — and every payable printed after it — as cash. */
        if (section === "cash" && (current === "liabilities" || current === "termLiabilities" || current === "equity")) break;
        /* "Cash and cash equivalents 65,029" is the cash line itself, not a
           heading over bank sub-accounts: it is cash, and the receivables
           printed under it are not. */
        if (figures && section === "cash") {
          own = section;
          /* "Total Bank Accounts 285,588.12" closes the bank group. Without
             this the cash section ran on, and the receivables, inventory and
             prepayments printed after it were all booked as cash. */
          if (/^total\b/i.test(label) && current === "cash") current = "assets";
          else if (!/^total\b/i.test(label) && CASH_GROUP.test(label)) current = "cash";
        } else if (figures && /^total\b/i.test(label) && current === section && CLOSES_TO[section]) {
          own = section;
          const before = (opened[section] || []).pop();
          current = before === section ? section : CLOSES_TO[section]!;
        } else {
          if (CLOSES_TO[section] && !figures) (opened[section] ||= []).push(current);
          current = section;
        }
        break;
      }
    }
    return m.section !== undefined ? m : { ...m, section: own ?? current };
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
/* Everything Schedule F puts below the current assets: the depreciable and
   depletable pools, land, the intangibles and the "other asset" slots. A
   caption printed under a fixed-assets heading cannot be cash or a receivable
   however it reads. */
const NON_CURRENT_ASSET_TARGETS = new Set([
  "BS:19", "BS:21", "BS:22", "BS:23", "BS:25", "BS:26", "BS:27", "BS:OI",
  "BS:28", "BS:29", "BS:30", "BS:31", "BS:32", "BS:34", "BS:35", "BS:36", "BS:37",
  "BS:39", "BS:40", "BS:41",
]);

/* The five equity lines and nothing else. */
const EQUITY_TARGETS = new Set(["BS:58", "BS:59", "BS:60", "BS:61", "BS:62"]);

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
  /* The mirror of the cash rule, one group down the balance sheet. */
  if (section === "fixedAssets") return isBs && NON_CURRENT_ASSET_TARGETS.has(target);
  /* Equity has its own block on Schedule F. A caption under the equity banner
     can never be a liability, and a liability caption can never be equity. */
  if (section === "equity") return isBs && EQUITY_TARGETS.has(target);
  if (section === "assets" || section === "liabilities") {
    if (!isBs) return false;
    const side =
      target === "BS:OCA" || target === "BS:OI" ? "assets"
      : target === "BS:OCL" || target === "BS:OL" ? "liabilities"
      : bsSide(target);
    return !side || side === section;
  }
  /* A caption printed under an expense heading is never turnover: the
     service-income keyword ("consultancy fees") would otherwise book a cost as
     gross receipts. */
  if (section === "costs") return !isBs && target !== "IS:7";
  if (section === "income") return !isBs;
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
  /* Accent-folded (v20): the routes below are written once for every
     language, unaccented ("korperschaftsteuer", "deprecia"). */
  const s = foldAccents(String(label || "").toLowerCase());
  /* These two DO have a catch-all, for the same reason collapsedRoute does:
     the banner already said what the figure is. Everything under a bank-
     accounts heading is cash; everything under a cost-of-sales heading is a
     cost of goods sold, and line 2 is where the form puts the ones that are
     neither labour nor purchases. */
  if (section === "cash") return "BS:10";
  /* The banner says these are non-current assets; the caption says which kind.
     The catch-all is the depreciable pool, because that is what a fixed-asset
     register is mostly made of and it is where the form expects them. */
  if (section === "fixedAssets") {
    if (/\b(depreciat|amorti[sz])/.test(s) || DEPRECIATION_WORDS.test(s)) return "BS:29";
    if (/\bland\b/.test(s) || LAND_WORDS.test(s)) return "BS:32";
    if (/goodwill|fonds de commerce|firmenwert|geschaftswert|avviamento|liikearvo/.test(s)) return "BS:34";
    if (/\b(patent|trademark|trade mark|licence|license|software|intangible|website|domain)\b/.test(s) || INTANGIBLE_WORDS.test(s)) return "BS:36";
    if (/\b(investment|shares in|interest in)\b/.test(s) || INVESTMENT_WORDS.test(s)) return "BS:OI";
    if (/\b(bond|deposit|security deposit|retention)\b/.test(s) || /\b(deposito|garantia|caution|kaution|waarborg|cauzion|vakuus)/.test(s)) return "BS:39";
    return "BS:28";
  }
  /* Equity. Drawings and current-year earnings are movements ON retained
     earnings, not separate lines of the form, so they accumulate there — which
     is also what a hand-prepared work paper does with them. A capital account
     in one owner's name is proprietor capital (line 21), not stock issued to
     the public (line 20b). */
  if (section === "equity") {
    if (/treasury|own shares|acciones propias|actions propres|eigene anteile|eigen aandelen|azioni proprie|acoes em tesouraria|omat osakkeet/.test(s)) return "BS:62";
    if (/preferen(?:ce|red)/.test(s)) return "BS:58";
    if (/share capital|common stock|ordinary shares|issued capital|aandelenkapitaal/.test(s) || SHARE_CAPITAL_WORDS.test(s)) return "BS:59";
    if (/kapitalrucklage|agio|sovrapprezzo|prime d.emission|prima de emision|premium|surplus/.test(s)) return "BS:60";
    if (/\b(capital|contribution|surplus|premium)\b/.test(s)) return "BS:60";
    return "BS:61";
  }
  /* The banner already said what the figure is, so the catch-all is safe: an
     unrecognised caption under "Other income" IS other income. */
  if (section === "termLiabilities") {
    /* The current portion of a term loan is due within the year whatever
       heading it was typed under. A short-term DEBT is not re-routed: it is a
       borrowing, and borrowings are line 19 (Macroroots printed "Short-term
       debt" under "Non-current liabilities" and its filed return carried it on
       line 19 with line 16 blank). */
    if (/\bcurrent portion\b|porcion corriente|parte corriente/.test(s)) return "BS:OCL";
    // The equity tests first, and in the same order as the liabilities branch
    // below: the banner is sticky and equity prints underneath it.
    if (/share capital|common stock|ordinary shares|issued capital|aandelenkapitaal/.test(s) || SHARE_CAPITAL_WORDS.test(s)) return "BS:59";
    if (/reserve|retained earning|accumulated (profit|loss|deficit)|distributable/.test(s)) return "BS:61";
    if (/current account/.test(s) && !/vat|tax/.test(s)) return "BS:52";
    if (/shareholder|director|related part/.test(s) || SHAREHOLDER_WORDS.test(s)) return "BS:52";
    return "BS:OL";
  }
  if (section === "otherIncome") {
    if (/\b(dividend)/.test(s) || DIVIDEND_WORDS.test(s)) return "IS:14";
    if (/\b(interest)/.test(s) || INTEREST_WORDS.test(s)) return "IS:15";
    if (/\b(rent)/.test(s) || RENT_WORDS.test(s)) return "IS:16";
    if (/\b(royalt|licence fee|license fee)/.test(s) || /regalia|redevance|lizenzgebuhr|royalty/.test(s)) return "IS:17";
    if (/\b(gain|loss)\b.*\b(sale|disposal)|\b(sale|disposal)\b.*\b(asset)/.test(s)) return "IS:18";
    if (FX_WORDS.test(s)) return /\b(realised|realized|realizad|realise|realisiert|gerealiseerd|realizzat)/.test(s) && !/\bun-?reali/.test(s) ? "IS:20" : "IS:19";
    return "IS:OI";
  }
  if (section === "cogs") {
    if (/\b(labour|labor|wage|salar|payroll|subcontract|sub-contract)/.test(s) || /mano de obra|main.d.oeuvre|lohn|lonen|mao de obra|manodopera|palkat/.test(s)) return "IS:10";
    if (/\b(purchase|goods|material|stock|inventor|supplier)/.test(s) || /\b(compra|achat|einkauf|wareneinsatz|inkoop|acquist|osto|mercader|marchandise|materia|mercadoria|estoque|existencia|vorrat|voorraad|rimanenz)/.test(s)) return "IS:11";
    return "IS:12";
  }
  if (section === "assets") {
    if (/\b(depreciat|amorti[sz])/.test(s) || DEPRECIATION_WORDS.test(s)) return "BS:29";
    if (ALLOWANCE_WORDS.test(s)) return "BS:12";
    if (/\b(receivable|debtor)/.test(s) || RECEIVABLE_WORDS.test(s)) {
      /* A balance owed by a shareholder or a related company is a loan to a
         related person (line 6), whatever it is called. */
      if (SHAREHOLDER_WORDS.test(s) || /related part|relacionad/.test(s)) return "BS:19";
      return "BS:11";
    }
    if (INVENTORY_WORDS.test(s)) return "BS:14";
    /* The mirror of the liabilities branch below. A shareholder current
       account swings between the two sides year to year, and the balance
       sheet says which side it is on THIS year by where it prints it. */
    if (/current account|\bloan\b/.test(s) && !/vat|tax/.test(s)) return "BS:19";
    if (LOAN_WORDS.test(s) && SHAREHOLDER_WORDS.test(s)) return "BS:19";
    if (/\b(vat|tax|gst|prepaid|deposit|accrued income)/.test(s) || PREPAID_WORDS.test(s)) return "BS:OCA";
    /* A bank account named only by its bank ("WAIO Bank 285,588.12") is cash
       — never a loan, an overdraft or a card, which are not assets here. */
    if ((/\b(bank|banco|banque)\b/.test(s) || CASH_WORDS.test(s)) && !/\b(loan|overdraft|credit card|charges?|fees?)\b/.test(s) && !LOAN_WORDS.test(s)) return "BS:10";
    return null;
  }
  if (section === "liabilities") {
    if (/share capital|common stock|ordinary shares|issued capital|aandelenkapitaal/.test(s) || SHARE_CAPITAL_WORDS.test(s)) return "BS:59";
    if (/reserve|retained earning|accumulated (profit|loss|deficit)|distributable/.test(s)) return "BS:61";
    if (/\b(unearned|deferred)\s+(income|revenue)|invoices? to be received|accrued/.test(s)) return "BS:OCL";
    /* A loan from a bank or other lender is borrowing, not a shareholder's
       money: "Loans from financial institutions" is an other current
       liability, never line 18. */
    if ((/\bloans?\b/.test(s) || LOAN_WORDS.test(s)) && (/\b(banks?|financial institutions?|credit institutions?|lenders?|bank loans?)\b/.test(s) || /\b(banco|bancari|banque|kreditinstitut|kredietinstelling|banca|banche|rahoituslaitos)/.test(s))) return "BS:OCL";
    /* Line 18 is money owed to a SHAREHOLDER or a related person, and only
       the caption can say so. A loan or current account the caption does not
       place with one is an ordinary borrowing (line 19) — v20; before, every
       "loan" under a liabilities banner was booked to line 18. A current
       account keeps line 18: a company's current account on its own books is
       the director's or shareholder's account. */
    if ((/current account/.test(s) || /\bloans?\b/.test(s) || LOAN_WORDS.test(s)) && !/vat|tax/.test(s)) {
      if (/current account/.test(s) || SHAREHOLDER_WORDS.test(s) || /shareholder|director|related part|member|owner|partner/.test(s)) return "BS:52";
      return "BS:OL";
    }
    /* A participation account ("cuenta en participación", a joint venture's
       capital held for a partner) is a long-term obligation: line 19. */
    if (/\b(cta\.?|cuentas?)\s+(?:de\s+|en\s+)?particip/.test(s)) return "BS:OL";
    // A tax owed is an other current liability, not a trade payable.
    if (/\btax/.test(s) || TAX_WORDS.test(s)) return "BS:OCL";
    if (/\b(wage|salar|payroll|accrued)/.test(s) || /\b(sueldo|remunerac|salaire|lohn|gehalt|loon|salaris|salario|stipend|palkka|personal|personeel)/.test(s)) return "BS:OCL";
    if (/\b(sonstige|overige|otras|otros|autres|altri|outras|muut|diversos|varios|divers)\b/.test(s)) return "BS:OCL";
    if (/\b(creditor|payable)/.test(s) || PAYABLE_WORDS.test(s)) return "BS:46";
    return "BS:OCL";
  }
  if (section === "income") {
    if (/referral fee|commission|sundry income|other income|royalt/.test(s)) return "IS:OI";
    /* Interest, dividends, rent and exchange differences printed inside the
       revenue block are not gross receipts: they have their own Schedule C
       lines (v20; before, the catch-all put them on line 1a). */
    if (/\b(dividend)/.test(s) || DIVIDEND_WORDS.test(s)) return "IS:14";
    if (/\b(interest)/.test(s) || INTEREST_WORDS.test(s)) return "IS:15";
    if (/\b(rental income|rent received|rents received)/.test(s)) return "IS:16";
    if (FX_WORDS.test(s)) return "IS:19";
    if (/\b(returns?|refunds?|discounts?|devoluc|descuento|rebaja|rabais|remise|ristourne|retour|erlosschmal|korting|devoluc|abatimento|resi|sconti|alennu|hyvity)/.test(s) && !/\b(fees?|income|revenue|sales of)\b/.test(s)) return "IS:8";
    return "IS:7";
  }
  if (section === "costs") {
    if (/salar|wage|personnel|remuneration|directors? and managers|wkr/.test(s) || STAFF_WORDS.test(s)) return "IS:26";
    if (/\b(depreciat|amorti[sz])/.test(s) || DEPRECIATION_WORDS.test(s)) return "IS:30";
    if (/interest/.test(s) || INTEREST_WORDS.test(s)) return "IS:29";
    if (/\bfx\b|exchange (gain|loss)|currency (gain|loss)/.test(s) || FX_WORDS.test(s)) return "IS:19";
    if (/\b(income tax|corporat\w* tax|profit tax|vennootschapsbelasting|korperschaftsteuer)/.test(s) || INCOME_TAX_WORDS.test(s)) return "IS:62";
    /* A tax that is not on income is Schedule C line 16 (v20; before, the
       other-deductions pool). Fees for preparing or advising on tax, and
       penalties, stay with the other deductions. */
    if ((/\b(tax|belasting)/.test(s) || TAX_WORDS.test(s)) && !/\b(fees?|preparation|advis|consult|penalt|honorar|asesor|conseil|berat|advies|multa|amende|strafe|boete|sancion)/.test(s)) return "IS:32";
    if (/\b(tax|belasting)/.test(s)) return "IS:OD";
    if (RENT_WORDS.test(s) || /\brent\b/.test(s)) return "IS:27";
    return "IS:OD";
  }
  return null;
}

/* ---- v20 word lists for the routes above (accent-folded, lower case) ---- */
const DEPRECIATION_WORDS = /\b(deprecia|amortiza|abschreib|afschrijv|amortiss|ammortament|poisto)/;
const LAND_WORDS = /\b(terreno|terrain|grundstuck|terrein|terreni|maa-alue)/;
const INTANGIBLE_WORDS = /\b(intangib|immateri|incorporel|marcas|marques|marken|merken|marchi|licencia|lizenz)/;
const INVESTMENT_WORDS = /\b(inversion|participac|beteiligung|deelneming|partecipaz|investiment|sijoitu)/;
const SHARE_CAPITAL_WORDS = /\b(capital social|capital suscrito|capital pagado|capital emitido|gezeichnetes kapital|stammkapital|grundkapital|gestort|geplaatst|osakepaaoma|capitale sociale|capital subscrito)/;
const SHAREHOLDER_WORDS = /\b(shareholder|stockholder|director|socio|socios|accionista|associe|gesellschafter|aandeelhouder|participant|acionista|soci|osakas|osakkai|relacionad|verbundene|groepsmaatschappij|controllat)/;
const DIVIDEND_WORDS = /\b(dividend|beteiligungsertr|osinko|proventi da partecipazioni|produits de participations)/;
const INTEREST_WORDS = /\b(interes|interet|juros|zins|rente\b|rentebaten|renteopbrengst|rentelasten|rentekosten|interessi|korko)/;
const RENT_WORDS = /\b(alquiler|arriend|arrendamiento|loyer|miete|mieten|huur|alugu|affitt|locazion|vuokra)/;
const FX_WORDS = /\b(exchange|diferencia(s)? (en|de) cambio|diferencia cambiaria|cambio|cambial|cambiais|change\b|ecarts? de change|kursdifferenz|kursgewinn|kursverlust|koersverschil|valuta|cambi\b|kurssi)/;
const STAFF_WORDS = /\b(sueldo|salario|remunerac|personal|salaire|traitement|lohn|lohne|gehalt|gehalter|personal|loon|lonen|salaris|personeel|pessoal|stipend|personale|henkilosto|palkat|palkka|sociale lasten|charges sociales|soziale abgaben|cargas sociales|encargos sociais|oneri sociali|pension)/;
const INCOME_TAX_WORDS = /\b(impuesto (sobre|a) la renta|impuesto a las (ganancias|utilidades)|impuesto de (renta|sociedades)|impot sur les (societes|benefices)|steuern vom einkommen|ertragsteuer|korperschaftsteuer|belasting(en)? (naar|over) de winst|imposto de renda|imposte sul reddito|tulovero|valittomat verot)/;
const TAX_WORDS = /\b(impuesto|impot|steuer|imposto|impost|belasting|tributo|tribut|verot|vero\b|tasa|taxe|abgabe)/;
const ALLOWANCE_WORDS = /\b(allowance|provision for (bad|doubtful)|doubtful|incobrable|estimacion|wertberichtig|depreciation des creances|dubieuze|svalutazione|duvidoso|epavarma)/;
const RECEIVABLE_WORDS = /\b(cobrar|client|deudor|debiteur|forderung|receber|crediti|creance|saamis|vordering)/;
const INVENTORY_WORDS = /\b(inventor|inventario|existencia|stock|vorrat|vorrate|voorraad|voorraden|estoque|rimanenz|varasto|vaihto-omaisuus|mercader|marchandise|mercadoria)/;
const LOAN_WORDS = /\b(prestamo|pret\b|prets\b|emprunt|darlehen|lening|emprestimo|prestito|finanziament|laina)/;
const PREPAID_WORDS = /\b(impuesto|iva|impot|tva|steuer|btw|imposto|icms|imposte|anticip|prepag|avance|vorauszahl|vooruitbetaald|antecipad|risconti|charges constatees|verosaamis|siirtosaamis)/;
const CASH_WORDS = /\b(caja|caisse|kasse|kas|caixa|cassa|kassa|disponib|liquid|tesorer|efectivo|bankguthaben|banktegoed)/;
const PAYABLE_WORDS = /\b(proveedor|acreedor|por pagar|fournisseur|lieferant|leverancier|crediteur|fornecedor|fornitor|debiti verso|ostovel)/;

/** Rows whose banner puts them on the other side of the statement from the
    page they were read on. Returns the two feeds with those rows exchanged,
    and how many moved — the caller logs the count. */
export function refeedBySection(isRows: MapRow[], bsRows: MapRow[]): { is: MapRow[]; bs: MapRow[]; moved: number } {
  const onBs = (m: MapRow) => m.section === "assets" || m.section === "liabilities" || m.section === "cash"
    || m.section === "termLiabilities" || m.section === "fixedAssets" || m.section === "equity";
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
    const label = bannerKey(String(m.row.label || ""));
    let section: Section | null = null;
    for (const [re, s] of SECTION_BANNERS) if (re.test(label)) { section = s; break; }
    if (!section) return m;
    const ind = indentOf(m);
    const below: MapRow[] = [];
    for (let j = i + 1; j < rows.length; j++) {
      if (indentOf(rows[j]) <= ind) break;
      below.push(rows[j]);
    }
    if (kidsSum(below)) return m;
    let lead = true;
    for (let j = i - 1; j >= 0; j--) {
      const p = rows[j];
      if (p.row.isBanner || p.skipReason || amtOf(p) === null) continue;
      lead = p.section !== m.section;
      break;
    }
    return lead ? { ...m, collapsed: section, collapsedLead: true } : { ...m, collapsed: section };
  });
}

/* ---------- a detailed P&L behind the summary one ----------

   UK accounts print the statutory profit and loss account (Turnover, Cost of
   sales, Administrative expenses, …) and, at the back, a "Detailed Profit and
   Loss Account" that lists every expense making up those headings. Both are
   P&L pages, so both were booked: turnover twice, administrative expenses
   once as a heading and again line by line. The detailed pages are a
   schedule supporting the face — the preparer's paper books the face — so
   they are set aside, but only when the face's own figures are proved to
   reappear on them (the same current- and prior-year pair), which is what
   makes them the same statement rather than a second one. */
export const DETAIL_PNL_TITLE = /^\s*detailed\s+(?:trading\s+(?:and|&)\s+)?(?:profit\s*(?:and|&)\s*loss(?:\s+account)?|income\s+statement|statement\s+of\s+(?:comprehensive\s+)?income)\b/i;
/* A UK small-company pack names its detailed account "Trading Profit and Loss
   Account" (abridged accounts: "Abridged Trading Profit and Loss Account") and
   says, on its contents page or the page itself, that those pages "do not form
   part of the statutory accounts". The title alone is also a face statement's
   in some packs, so it counts only with that sentence in the document. */
export const TRADING_PNL_TITLE = /^\s*(?:abridged\s+)?trading\s+(?:and\s+)?profit\s*(?:and|&)\s*loss(?:\s+account)?\b/i;
export const NOT_STATUTORY = /\bdo(?:es)?\s+not\s+form\s+part\s+of\s+the\s+statutory\s+(?:accounts|financial\s+statements)\b/i;

/** A result line inside a P&L ("Gross profit", "Operating loss"): it closes
    the group of accounts printed above it. */
const GROUP_RESULT = /\b(gross|operating|trading|net)\s+(profit|loss|margin|income|result)\b|\bprofit\b.*\b(before|after)\b/i;

const REVENUE_CAPTION = /\b(turnover|revenue|sales|income from (?:sales|services))\b/i;

export function supplementaryDetailPages<T extends MapRow>(rows: T[], detailPages: Set<number>, preferDetail = false): { rows: T[]; dropped: number; abridged?: boolean } {
  if (!detailPages.size) return { rows, dropped: 0 };
  const valued = (m: MapRow) => !m.row.isBanner && !!(m.row.values && m.row.values.length);
  const detail = rows.filter((m) => detailPages.has(m.row.page ?? -1) && valued(m));
  const face = rows.filter((m) => !detailPages.has(m.row.page ?? -1) && valued(m) && !m.skipReason);
  if (!detail.length || face.length < 3) return { rows, dropped: 0 };
  const same = (a: number[], b: number[]) =>
    a.length >= 2 && a.length === b.length && a.every((v, i) => Math.abs(Math.abs(v) - Math.abs(b[i])) <= 0.5);
  /* Judged page by page. The P&L feed also carries the notes pages (fixed
     assets, debtors, creditors), whose rows the detailed account never
     restates; counted together with the face they outvoted it, nothing was set
     aside, and turnover, cost of sales and expenses were booked twice. One
     face page whose rows the detail restates is enough. */
  const byPage = new Map<number, T[]>();
  for (const f of face) {
    const pg = f.row.page ?? -1;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg)!.push(f);
  }
  /* The detailed account itemises a face line under a heading of the same
     name and often prints the group's total without a caption, which the row
     reader cannot keep ("Administrative expenses" … 47,090 on the face, nine
     accounts under that heading on the detail page). The group's sum is the
     face line restated. */
  const groupSums: number[][] = [];
  {
    let cur: number[] | null = null;
    const ordered = rows.filter((m) => detailPages.has(m.row.page ?? -1));
    for (const m of ordered) {
      const v = (m.row.values || []) as number[];
      if (m.row.isBanner || !v.length) { if (cur) groupSums.push(cur); cur = []; continue; }
      // A result line ("Gross profit") closes the group above it.
      const lab = String(m.row.label || "").trim();
      if (isProfitLine(lab) || isResultSubtotal(lab) || TOTAL_WORD.test(lab) || GROUP_RESULT.test(lab)) { if (cur && cur.length) groupSums.push(cur); cur = null; continue; }
      if (m.skipReason || cur === null) continue;
      if (!cur.length) cur = v.map(() => 0);
      if (cur.length !== v.length) continue;
      cur = cur.map((n, i) => n + (Number(v[i]) || 0));
    }
    if (cur && cur.length) groupSums.push(cur);
  }
  const restatedPage = [...byPage.values()].some((list) => {
    const restated = list.filter((f) => detail.some((d) => same(f.row.values, d.row.values))
      || groupSums.some((g) => same(f.row.values, g))).length;
    return restated >= Math.max(3, Math.ceil(list.length / 2));
  });
  if (!restatedPage) return { rows, dropped: 0 };
  /* An ABRIDGED face statement opens at gross profit: the company was allowed
     to leave turnover and cost of sales off the statutory accounts, and only
     the detailed account prints them. Keeping the face there booked no gross
     receipts at all; keeping both counted every expense twice. So when the
     face carries no turnover line and the detail does, the detail is booked
     and the face rows it restates are set aside instead. */
  const revenue = (m: MapRow) => m.section === "income" || REVENUE_CAPTION.test(String(m.row.label || ""));
  /* The firm's policy can ask for the detailed account itself (policy.ts,
     detailedAccounts): the same restated face rows are set aside instead. */
  if ((!face.some(revenue) && detail.some(revenue)) || preferDetail) {
    /* The detail prints "-" for a year with nothing in it, so such a row
       carries one figure and the positional sums above skip it. Summed by the
       year each figure sits under, the group still restates the face line. */
    const yearGroups: Map<number, number>[] = [];
    {
      let cur: Map<number, number> | null = null;
      for (const m of rows.filter((x) => detailPages.has(x.row.page ?? -1))) {
        const v = (m.row.values || []) as number[];
        const lab = String(m.row.label || "").trim();
        if (m.row.isBanner || !v.length) { if (cur && cur.size) yearGroups.push(cur); cur = new Map(); continue; }
        if (isProfitLine(lab) || isResultSubtotal(lab) || TOTAL_WORD.test(lab) || GROUP_RESULT.test(lab)) { if (cur && cur.size) yearGroups.push(cur); cur = null; continue; }
        if (m.skipReason || cur === null || !m.row.years) continue;
        m.row.years.forEach((y, i) => { if (typeof y === "number") cur!.set(y, (cur!.get(y) || 0) + (Number(v[i]) || 0)); });
      }
      if (cur && cur.size) yearGroups.push(cur);
    }
    const yearRestated = (m: MapRow) => {
      const ys = m.row.years, v = (m.row.values || []) as number[];
      if (!ys || v.length < 2 || ys.some((y) => typeof y !== "number")) return false;
      return yearGroups.some((g) => ys.every((y, i) => g.has(y as number) && Math.abs(Math.abs(g.get(y as number) as number) - Math.abs(v[i])) <= 0.5));
    };
    let dropped = 0;
    const out = rows.map((m) => {
      if (detailPages.has(m.row.page ?? -1) || !valued(m) || m.skipReason) return m;
      const restated = detail.some((d) => same(m.row.values, d.row.values)) || groupSums.some((g) => same(m.row.values, g)) || yearRestated(m);
      if (!restated) return m;
      dropped++;
      return { ...m, skipReason: preferDetail && face.some(revenue) ? "restated by the detailed account, which the mapping policy books instead of the face statement" : "restated by the detailed account, which the abridged face statement summarises" };
    });
    return { rows: out, dropped, abridged: true };
  }
  const kept = rows.filter((m) => !detailPages.has(m.row.page ?? -1));
  return { rows: kept, dropped: rows.length - kept.length };
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
const PROFIT_LINE = new RegExp(
  "^(net\\s+(income|earnings|profit|loss)"
  /* "Profit (loss) for the period", "Profit / loss for the financial year"
     and "Result for the financial year": how a Nordic statement (and
     Google's English of one) closes its P&L. */
  + "|(profit|loss)\\s*(?:\\(\\s*(?:profit|loss)\\s*\\)|\\/\\s*(?:profit|loss))?\\s+(for|of)\\s+the\\s+(financial\\s+)?(year|period)"
  + "|result\\s+for\\s+the\\s+(financial\\s+)?(year|period)"
  + "|current[-\\s]year\\s+(earnings|profit|net\\s+income|result)"
  /* The same line in the languages the statements arrive in. A Mexican
     balance sheet closes its equity block with "Utilidad o Pérdida del
     Ejercicio"; skipped as a P&L subtotal, the year's result never reached
     retained earnings and closing equity was short by the whole year. */
  + "|utilidad\\s*\\(?o\\)?\\s*p[e\\u00e9]rdida(\\s+del\\s+ejercicio)?"
  + "|(utilidad|p[e\\u00e9]rdida|resultado)\\s+(neta?\\s+)?del\\s+(ejercicio|per[i\\u00ed]odo)"
  /* "GANANCIA O (PERDIDA) NETA DEL PERIODO" — the Panamanian form of it. */
  + "|ganancia\\s*o?\\s*\\(?\\s*p[e\\u00e9]rdida\\s*\\)?\\s+(neta\\s+)?del\\s+(ejercicio|per[i\\u00ed]odo)"
  + "|resultado\\s+del\\s+ejercicio"
  + "|lucro\\s+(l[i\\u00ed]quido\\s+)?do\\s+exerc[i\\u00ed]cio"
  + "|r[e\\u00e9]sultat\\s+de\\s+l.exercice"
  /* A Swiss/French balance sheet closes its equity with "Bénéfice de
     l'exercice" (or "Perte de l'exercice"). With the apostrophe read, the SKIP
     for the P&L's bottom line claimed it, retained earnings missed the year's
     result, and Schedule F was out by exactly that amount. German and Italian
     statements print the same line. */
  + "|(b[e\\u00e9]n[e\\u00e9]fice|perte|r[e\\u00e9]sultat)\\s+(net\\s+)?de\\s+l.?exercice"
  + "|jahres(gewinn|verlust|[u\\u00fc]berschuss|fehlbetrag|ergebnis)"
  + "|(utile|perdita)\\s+(netto\\s+)?dell.?esercizio"
  /* v16: "Result after taxation" — the bottom line of Dutch-style accounts
     printed in English. Before tax is a subtotal, never the year's result. */
  + "|(result|profit|loss)\\s+after\\s+tax(ation|es)?"
  + ")\\b",
  "i",
);

/** Is this caption the year's result ("Net Income", "Bénéfice de l'exercice")? */
export const isProfitLine = (label: string): boolean => PROFIT_LINE.test(deglue(String(label || "").trim()));

/* A Spanish P&L's own running results: "GANANCIA O (PÉRDIDA) BRUTA",
   "… OPERATIVA", "… ANTES DE IMPUESTOS", "… NETA DEL PERIODO". Each is the
   statement's arithmetic on the lines above it, never a line of its own. */
const RESULT_SUBTOTAL = /^(?:ganancias?|utilidad(?:es)?|p[e\u00e9]rdidas?|resultados?)\b[\s\w\u00e0-\u00ff()]*\b(?:brut[ao]|operativ[ao]|operacional|de\s+operaci[o\u00f3]n|antes\s+de(?:l)?\s+impuestos?|net[ao])\b/i;
export const isResultSubtotal = (label: string): boolean => RESULT_SUBTOTAL.test(deglue(String(label || "").trim()));

/** The retained-earnings line, when a SKIP-matched profit caption sits on the
    balance-sheet side; null when the SKIP should stand. */
export function equityOverride(label: string, feed: MapRow["feed"], section?: Section | null): string | null {
  if (feed !== "bs" && section !== "liabilities") return null;
  return PROFIT_LINE.test(String(label || "").trim()) ? "BS:61" : null;
}
