/* Related-party invoice ledger ("Expenses by Contact" export).

   Summarizes the counterparty's spend with the entity: functional-currency
   invoices and credit notes net into the Schedule M services figure; USD
   "Cash Paid" rows are surfaced for review and NEVER become balance-sheet
   writes (the class of bug that once put US$47,418 into the cash line).
   Returns plain facts; the store materializes writes and review items. */

import { numeric } from "./engine";

export type LedgerRow = {
  date: string;                    // "1/16/24"
  details: string;
  reference: string;
  currency: string;
  source: number | null;           // functional-currency amount
  usd: number | null;
};

export type LedgerSummary = {
  counterparty: string | null;
  subjectEntity: string | null;    // whose ledger this is about (title row)
  currency: string | null;         // dominant non-USD currency
  invoicesFunctional: number;      // invoices + credit notes, functional ccy
  invoiceCount: number;
  creditNoteCount: number;
  cashPaidUSD: { date: string; amount: number }[];
  ledgerTotalUSD: number | null;   // the file's own grand total, if present
  rows: LedgerRow[];
  warnings: string[];
};

/** Excel serial date → "m/d/yy". */
export function serialToDate(n: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
}

const HEADERS = ["date", "details", "reference", "currency"];

export function summarizeLedger(grid: string[][], fileName: string): LedgerSummary | null {
  // Locate the header row and map columns by name, not position.
  let headerIdx = -1;
  const colOf: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const cells = grid[i].map((c) => String(c || "").toLowerCase().trim());
    const hits = HEADERS.filter((h) => cells.includes(h)).length;
    if (hits >= 3) {
      headerIdx = i;
      cells.forEach((c, idx) => {
        if (c === "date") colOf.date = idx;
        else if (c === "details") colOf.details = idx;
        else if (c === "reference") colOf.reference = idx;
        else if (c === "currency") colOf.currency = idx;
        else if (/^total \(source\)/.test(c)) colOf.source = idx;
        else if (/^total \(usd\)/.test(c) || c === "total") colOf.usd = idx;
      });
      break;
    }
  }
  if (headerIdx < 0) return null;

  const out: LedgerSummary = {
    counterparty: null,
    subjectEntity: null,
    currency: null,
    invoicesFunctional: 0,
    invoiceCount: 0,
    creditNoteCount: 0,
    cashPaidUSD: [],
    ledgerTotalUSD: null,
    rows: [],
    warnings: [],
  };

  // Title block: "Expenses by Contact - <subject>" then the counterparty name.
  for (const row of grid.slice(0, headerIdx)) {
    const t = row.map((c) => String(c || "")).join(" ").trim();
    if (!t) continue;
    const m = /expenses? by contact\s*[-–]\s*(.+)$/i.exec(t);
    if (m) out.subjectEntity = m[1].trim();
    else if (!out.counterparty && /[A-Za-z]{3}/.test(t) && !/for the period|expenses? by contact/i.test(t)) {
      out.counterparty = t;
    }
  }

  const ccyCounts = new Map<string, number>();
  for (const row of grid.slice(headerIdx + 1)) {
    const cell = (i: number | undefined) => (i === undefined ? "" : String(row[i] ?? "").trim());
    const details = cell(colOf.details);
    const dateRaw = cell(colOf.date);
    if (/^total/i.test(details) || (/^total/i.test(dateRaw) && !details)) {
      out.ledgerTotalUSD = numeric(cell(colOf.usd));
      continue;
    }
    if (!details && !dateRaw) continue;

    const serial = numeric(dateRaw);
    const date = serial !== null && serial > 20000 && serial < 80000 ? serialToDate(serial) : dateRaw;
    const currency = cell(colOf.currency).toUpperCase();
    let source = numeric(cell(colOf.source));
    const usd = numeric(cell(colOf.usd));

    // Belt for extractors that drop a credit note's minus sign.
    if (/credit note/i.test(details) && source !== null && source > 0) {
      source = -source;
      out.warnings.push(`Credit note ${cell(colOf.reference)} arrived positive — sign restored.`);
    }

    const r: LedgerRow = { date, details, reference: cell(colOf.reference), currency, source, usd };
    out.rows.push(r);

    if (/cash paid/i.test(details)) {
      if (usd !== null) out.cashPaidUSD.push({ date, amount: usd });
      continue;                     // never a mapped amount, review-only
    }
    if (/invoice|credit note/i.test(details) && currency && currency !== "USD" && source !== null) {
      out.invoicesFunctional += source;
      if (/credit note/i.test(details)) out.creditNoteCount++;
      else out.invoiceCount++;
      ccyCounts.set(currency, (ccyCounts.get(currency) || 0) + 1);
    }
  }

  let best: string | null = null;
  let n = 0;
  for (const [c, v] of ccyCounts) if (v > n) { best = c; n = v; }
  out.currency = best;
  out.invoicesFunctional = Math.round(out.invoicesFunctional * 100) / 100;
  if (!out.rows.length) out.warnings.push(`${fileName}: ledger header found but no data rows parsed.`);
  return out;
}
