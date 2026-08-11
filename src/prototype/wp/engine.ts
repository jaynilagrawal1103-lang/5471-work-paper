/* Work paper engine — cell coordinates read from the uploaded master template
   Final_Copy_of_5471_workpaper.XLSX. Nothing here is invented: every cell
   reference corresponds to a designated input cell in that workbook. */

export const SHEET = {
  basic: "Basic Information",
  is: "Income Statement",
  bs: "Balance Sheet",
  shareholding: "Shareholding Details",
  dividends: "Dividends",
  schE: "Schedule E & E-1",
  schH: "Sch - H",
  schJ: "Schedule J",
  schM: "Schedule M",
  schR: "Schedule R",
};

export type FieldSpec = {
  key: string;
  cell: string;
  label: string;
  type?: "text" | "num" | "pct" | "yn";
  placeholder?: string;
};

export const PROFILE_FIELDS: FieldSpec[] = [
  { key: "cyEnd", cell: "B1", label: "Current year end", placeholder: "12/31/25" },
  { key: "pyEnd", cell: "B2", label: "Prior year end", placeholder: "12/31/24" },
  { key: "clientName", cell: "B3", label: "Client name" },
  { key: "entityShort", cell: "B4", label: "Entity name (header)" },
  { key: "legalName", cell: "B11", label: "Legal name of entity" },
  { key: "addr1", cell: "B13", label: "Address line 1" },
  { key: "addr2", cell: "B14", label: "Address line 2" },
  { key: "addr3", cell: "B15", label: "Address line 3" },
  { key: "formed", cell: "B17", label: "Date of formation" },
  { key: "countryInc", cell: "B19", label: "Country of incorporation" },
  { key: "booksPerson", cell: "B21", label: "Person in charge of books" },
  { key: "activity", cell: "B25", label: "Principal business activity" },
  { key: "currency", cell: "B27", label: "Functional currency", placeholder: "GBP" },
];

export const OWNERSHIP_FIELDS: FieldSpec[] = [
  { key: "ownStart", cell: "C33", label: "Ownership % at start of year", type: "pct" },
  { key: "ownEnd", cell: "C34", label: "Ownership % at end of year", type: "pct" },
  { key: "isOfficer", cell: "C35", label: "Filer is a director or officer?", type: "yn" },
  { key: "tenPct", cell: "C36", label: "10% corporate shareholder?", type: "yn" },
  { key: "cfc", cell: "C37", label: "CFC?", type: "yn" },
  { key: "daysCfc", cell: "C38", label: "Days entity was a CFC", type: "num" },
  { key: "daysOwned", cell: "C39", label: "Days filer owned stock", type: "num" },
  { key: "transition", cell: "C40", label: "Transition tax year?", type: "yn" },
];

export const CATEGORY_CELLS: Record<string, string> = {
  "1a": "B42", "1b": "B43", "1c": "B44", "2": "B45", "3": "B46",
  "4": "B47", "5a": "B48", "5b": "B49", "5c": "B50",
};

export const FX_FIELDS: FieldSpec[] = [
  { key: "avgRate", cell: "C59", label: "Average exchange rate" },
  { key: "cyRate", cell: "C60", label: "Current year end rate" },
  { key: "pyRate", cell: "C61", label: "Prior year end rate" },
];

export type LineSpec = { row: number; ref: string; label: string; group: string; relabel?: boolean };

/* Column F = book income in local currency. Subtotal rows (9, 13, 21, 25,
   33, 51, 52, 56, 60) are template formulas and are never written. */
export const IS_LINES: LineSpec[] = [
  { row: 7, ref: "1a", label: "Gross receipts", group: "Income" },
  { row: 8, ref: "1b", label: "Less returns and allowances", group: "Income" },
  { row: 10, ref: "2", label: "Cost of labor", group: "Income" },
  { row: 11, ref: "2", label: "Purchases", group: "Income" },
  { row: 12, ref: "2", label: "Other costs", group: "Income" },
  { row: 14, ref: "4", label: "Dividends", group: "Income" },
  { row: 15, ref: "5", label: "Interest income", group: "Income" },
  { row: 16, ref: "6a", label: "Gross rents", group: "Income" },
  { row: 17, ref: "6b", label: "Gross royalties and licence fees", group: "Income" },
  { row: 18, ref: "7", label: "Net gain/(loss) on sale of capital assets", group: "Income" },
  { row: 19, ref: "8a", label: "FX gain/loss — unrealised", group: "Income" },
  { row: 20, ref: "8b", label: "FX gain/loss — realised", group: "Income" },
  { row: 22, ref: "9", label: "Other income 1", group: "Income", relabel: true },
  { row: 23, ref: "9", label: "Other income 2", group: "Income", relabel: true },
  { row: 24, ref: "9", label: "Other income 3", group: "Income", relabel: true },
  { row: 26, ref: "11", label: "Compensation not deducted elsewhere", group: "Deductions" },
  { row: 27, ref: "12a", label: "Rents", group: "Deductions" },
  { row: 28, ref: "12b", label: "Royalties and licence fees", group: "Deductions" },
  { row: 29, ref: "13", label: "Interest", group: "Deductions" },
  { row: 30, ref: "14", label: "Depreciation not deducted elsewhere", group: "Deductions" },
  { row: 31, ref: "15", label: "Depletion", group: "Deductions" },
  { row: 32, ref: "16", label: "Taxes (excluding income tax expense)", group: "Deductions" },
  { row: 34, ref: "17", label: "Other deduction 1", group: "Deductions", relabel: true },
  { row: 35, ref: "17", label: "Other deduction 2", group: "Deductions", relabel: true },
  { row: 36, ref: "17", label: "Other deduction 3", group: "Deductions", relabel: true },
  { row: 37, ref: "17", label: "Other deduction 4", group: "Deductions", relabel: true },
  { row: 38, ref: "17", label: "Other deduction 5", group: "Deductions", relabel: true },
  { row: 39, ref: "17", label: "Other deduction 6", group: "Deductions", relabel: true },
  { row: 40, ref: "17", label: "Other deduction 7", group: "Deductions", relabel: true },
  { row: 41, ref: "17", label: "Other deduction 8", group: "Deductions", relabel: true },
  { row: 42, ref: "17", label: "Other deduction 9", group: "Deductions", relabel: true },
  { row: 43, ref: "17", label: "Other deduction 10", group: "Deductions", relabel: true },
  { row: 44, ref: "17", label: "Other deduction 11", group: "Deductions", relabel: true },
  { row: 45, ref: "17", label: "Other deduction 12", group: "Deductions", relabel: true },
  { row: 46, ref: "17", label: "Other deduction 13", group: "Deductions", relabel: true },
  { row: 47, ref: "17", label: "Other deduction 14", group: "Deductions", relabel: true },
  { row: 48, ref: "17", label: "Other deduction 15", group: "Deductions", relabel: true },
  { row: 49, ref: "17", label: "Other deduction 16", group: "Deductions", relabel: true },
  { row: 50, ref: "17", label: "Other deduction 17", group: "Deductions", relabel: true },
  { row: 53, ref: "20", label: "Unusual or infrequently occurring items", group: "Net income" },
  { row: 54, ref: "21a", label: "Income tax expense — current", group: "Net income" },
  { row: 55, ref: "21b", label: "Income tax expense — deferred", group: "Net income" },
  { row: 57, ref: "23a", label: "Other comprehensive income — FX translation", group: "OCI" },
  { row: 58, ref: "23b", label: "Other comprehensive income — other", group: "OCI" },
  { row: 59, ref: "23c", label: "Tax on other comprehensive income", group: "OCI" },
];

/* Column D = beginning of year, column F = end of year, local currency.
   Columns G/H are the template's own USD translation formulas. */
export const BS_LINES: LineSpec[] = [
  { row: 10, ref: "1", label: "Cash", group: "Assets" },
  { row: 11, ref: "2a", label: "Trade notes and accounts receivable", group: "Assets" },
  { row: 12, ref: "2b", label: "Less allowance for bad debts", group: "Assets" },
  { row: 13, ref: "3", label: "Derivatives", group: "Assets" },
  { row: 14, ref: "4", label: "Inventories", group: "Assets" },
  { row: 16, ref: "5", label: "Prepaid expenses", group: "Assets", relabel: true },
  { row: 17, ref: "5", label: "Other current asset 2", group: "Assets", relabel: true },
  { row: 18, ref: "5", label: "Other current asset 3", group: "Assets", relabel: true },
  { row: 19, ref: "6", label: "Loans to shareholders / related persons", group: "Assets" },
  { row: 21, ref: "7", label: "Investment in subsidiary 1", group: "Assets", relabel: true },
  { row: 22, ref: "7", label: "Investment in subsidiary 2", group: "Assets", relabel: true },
  { row: 23, ref: "7", label: "Investment in subsidiary 3", group: "Assets", relabel: true },
  { row: 25, ref: "8", label: "Other investment 1", group: "Assets", relabel: true },
  { row: 26, ref: "8", label: "Other investment 2", group: "Assets", relabel: true },
  { row: 27, ref: "8", label: "Other investment 3", group: "Assets", relabel: true },
  { row: 28, ref: "9a", label: "Buildings and other depreciable assets", group: "Assets" },
  { row: 29, ref: "9b", label: "Less accumulated depreciation (negative)", group: "Assets" },
  { row: 30, ref: "10a", label: "Depletable assets", group: "Assets" },
  { row: 31, ref: "10b", label: "Less accumulated depletion (negative)", group: "Assets" },
  { row: 32, ref: "11", label: "Land (net of amortisation)", group: "Assets" },
  { row: 34, ref: "12a", label: "Goodwill", group: "Assets" },
  { row: 35, ref: "12b", label: "Organization costs", group: "Assets" },
  { row: 36, ref: "12c", label: "Patents, trademarks, other intangibles", group: "Assets" },
  { row: 37, ref: "12d", label: "Less accumulated amortisation (negative)", group: "Assets" },
  { row: 39, ref: "13", label: "Other asset 1", group: "Assets", relabel: true },
  { row: 40, ref: "13", label: "Other asset 2", group: "Assets", relabel: true },
  { row: 41, ref: "13", label: "Other asset 3", group: "Assets", relabel: true },
  { row: 46, ref: "15", label: "Accounts payable", group: "Liabilities & equity" },
  { row: 48, ref: "16", label: "Other current liability 1", group: "Liabilities & equity", relabel: true },
  { row: 49, ref: "16", label: "Other current liability 2", group: "Liabilities & equity", relabel: true },
  { row: 50, ref: "16", label: "Other current liability 3", group: "Liabilities & equity", relabel: true },
  { row: 51, ref: "17", label: "Derivatives", group: "Liabilities & equity" },
  { row: 52, ref: "18", label: "Loans from shareholders / related persons", group: "Liabilities & equity" },
  { row: 54, ref: "19", label: "Other liability 1", group: "Liabilities & equity", relabel: true },
  { row: 55, ref: "19", label: "Other liability 2", group: "Liabilities & equity", relabel: true },
  { row: 56, ref: "19", label: "Other liability 3", group: "Liabilities & equity", relabel: true },
  { row: 58, ref: "20a", label: "Preferred stock", group: "Liabilities & equity" },
  { row: 59, ref: "20b", label: "Common stock", group: "Liabilities & equity" },
  { row: 60, ref: "21", label: "Paid-in or capital surplus", group: "Liabilities & equity" },
  { row: 61, ref: "22", label: "Retained earnings", group: "Liabilities & equity" },
  { row: 62, ref: "23", label: "Less cost of treasury stock", group: "Liabilities & equity" },
];

/* Multi-slot pools: a rule may target a pool ("IS:OD") instead of a fixed
   row; the mapping pass allocates one relabel row per distinct caption, in
   document order, and aggregates any overflow into the pool's last row. */
export const POOLS: Record<string, { sheet: "is" | "bs"; rows: number[] }> = {
  "IS:OI": { sheet: "is", rows: [22, 23, 24] },
  "IS:OD": { sheet: "is", rows: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50] },
  "BS:OCA": { sheet: "bs", rows: [16, 17, 18] },
  "BS:OCL": { sheet: "bs", rows: [48, 49, 50] },
  "BS:OL": { sheet: "bs", rows: [54, 55, 56] },
};

/* Formula cells per sheet — buildWrites refuses these; the runtime belt in
   xlsxPatch.setCell is the second line of defence. */
export const FORMULA_REFS: Record<string, (ref: string) => boolean> = {
  [SHEET.is]: (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return false;
    const row = Number(m[2]);
    if (m[1] === "F" || m[1] === "H") return [9, 13, 21, 25, 33, 51, 52, 56, 60].includes(row);
    return m[1] === "J" || m[1] === "L";
  },
  [SHEET.bs]: (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return false;
    const row = Number(m[2]);
    if (m[1] === "G" || m[1] === "H") return true;
    if (m[1] === "D" || m[1] === "F") return [15, 20, 24, 38, 42, 47, 53, 63].includes(row);
    return false;
  },
  [SHEET.schJ]: (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return false;
    if (m[1] === "AH") return true;
    return [16, 20, 23, 27, 31, 36, 41, 49].includes(Number(m[2]));
  },
  [SHEET.schM]: (ref) => [22, 35].includes(Number((/\d+$/.exec(ref) || ["0"])[0])),
  [SHEET.dividends]: (ref) => /^E\d+$/.test(ref) || ref === "C12",
  [SHEET.schE]: (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return false;
    const row = Number(m[2]);
    if ((m[1] === "S" || m[1] === "U") && row >= 16 && row <= 41) return true;
    return [49, 53, 61, 65, 70, 75].includes(row);
  },
  [SHEET.shareholding]: (ref) => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) return false;
    const row = Number(m[2]);
    if (row >= 7 && row <= 16) return true;               // block 1 mirrors + totals
    if (row === 27 || row === 45 || row === 57) return true;
    return m[1] === "L" || m[1] === "N" || m[1] === "P";
  },
  [SHEET.basic]: (ref) => ["A6", "B59", "B60", "B61"].includes(ref),
};

/* Leftover captions from the template's demo client; cleared when the run
   leaves their row unused so junk labels never ship in a generated file. */
export const DEMO_RELABELS: Record<string, string[]> = {
  [SHEET.is]: ["C34", "C35", "C36", "C37", "C38", "C39", "C40", "C41", "C42", "C43", "C44", "C45", "C46", "C47", "C48", "C49"],
  [SHEET.bs]: ["B54", "B55"],
};

export type MappingRule = { kw: string[]; t: string };

export const DEFAULT_RULES: MappingRule[] = [
  /* Subtotals the template recomputes itself. SKIP beats fragment keywords
     ("Cost of Sales" would otherwise hit "sales") because the longest
     matching keyword wins. The store drops SKIP rows silently. */
  { kw: [
    "cost of sales", "total trading income", "total income", "total expenses", "total deductions",
    "gross profit", "trading profit", "net profit", "from ordinary activities",
    "total current assets", "total assets", "total non-current assets",
    "total current liabilities", "total liabilities", "net assets", "total equity",
    "opening retained profits", "closing retained profits", "total changes in equity",
    "attributable to members",
  ], t: "SKIP" },
  { kw: ["gross receipt", "turnover", "revenue", "sales", "chiffre d'affaires", "ingresos", "营业收入"], t: "IS:7" },
  { kw: ["service income", "services income", "consulting fees", "consultancy fees", "fees earned"], t: "IS:7" },
  { kw: ["returns and allowance", "sales return"], t: "IS:8" },
  { kw: ["cost of labor", "cost of labour", "direct labour"], t: "IS:10" },
  { kw: ["purchase", "achats", "cost of goods", "cogs"], t: "IS:11" },
  // "Cost of sales" totals are deliberately absent: the components map here
  // and the template's F9 subtotal recomputes the total — both would double-count.
  { kw: ["direct hotel", "direct meals", "direct car rental", "direct airfare", "direct fuel", "direct parking", "direct taxi", "uber", "job cost"], t: "IS:12" },
  { kw: ["dividend income", "dividends received"], t: "IS:14" },
  { kw: ["interest income", "interest received", "produits financiers"], t: "IS:15" },
  { kw: ["rental income", "gross rent"], t: "IS:16" },
  { kw: ["royalt", "licence fee", "license fee"], t: "IS:17" },
  { kw: ["gain on sale", "loss on sale", "disposal of asset"], t: "IS:18" },
  { kw: ["unrealised exchange", "unrealized exchange"], t: "IS:19" },
  { kw: ["realised exchange", "realized exchange", "exchange gain", "exchange loss"], t: "IS:20" },
  { kw: ["management fees earned", "management fee income", "management fees", "reimbursement", "recharge income", "sundry income", "other income"], t: "IS:OI" },
  { kw: ["salaries", "salary", "payroll", "compensation", "personnel", "staff cost", "charges de personnel", "wages", "superannuation", "pension contribution"], t: "IS:26" },
  { kw: ["rent expense", "rent", "loyer", "premises rent"], t: "IS:27" },
  { kw: ["royalty expense"], t: "IS:28" },
  { kw: ["interest expense", "finance cost", "charges financi"], t: "IS:29" },
  { kw: ["depreciation", "amortisation expense", "amortization expense", "dotations aux amortissements"], t: "IS:30" },
  { kw: ["depletion"], t: "IS:31" },
  { kw: ["taxes other than income", "business rates", "property tax", "impots et taxes"], t: "IS:32" },
  { kw: ["accountancy", "accounting fees", "audit fee", "bookkeeping"], t: "IS:OD" },
  { kw: ["subscription", "membership fee"], t: "IS:OD" },
  { kw: ["telecommunication", "telephone", "internet"], t: "IS:OD" },
  { kw: ["filing fee", "registration fee", "licence cost", "permits"], t: "IS:OD" },
  { kw: ["entertainment", "printing", "stationery", "postage", "advertising", "promotion"], t: "IS:OD" },
  { kw: ["insurance", "workers compensation", "bank fees", "bank charges", "sundry expense", "staff amenities", "motor vehicle", "travel expense", "legal fees", "professional fees", "consultants fees", "computer expense", "office expense", "cleaning", "utilities", "electricity", "repairs and maintenance"], t: "IS:OD" },
  { kw: ["income tax - current", "current tax", "corporation tax", "tax on profit", "tax on ordinary activities", "income tax revenue", "income tax expense", "impot sur les societes"], t: "IS:54" },
  { kw: ["deferred tax"], t: "IS:55" },
  { kw: ["cash", "bank account", "cash at bank", "banque", "trésorerie", "货币资金"], t: "BS:10" },
  { kw: ["trade receivable", "accounts receivable", "debtor", "trade debtor", "créances clients", "应收账款"], t: "BS:11" },
  { kw: ["allowance for bad debt", "provision for doubtful"], t: "BS:12" },
  { kw: ["inventor", "存货"], t: "BS:14" },
  { kw: ["prepaid", "prepayment", "charges constatées", "accrued management fee", "accrued income", "accrued revenue"], t: "BS:OCA" },
  { kw: ["loan to shareholder", "amounts owed by"], t: "BS:19" },
  { kw: ["investment in subsidiar", "shares in group"], t: "BS:21" },
  { kw: ["building", "plant and machinery", "fixed asset", "immobilisations corporelles", "固定资产"], t: "BS:28" },
  { kw: ["accumulated depreciation", "amortissements cumulés"], t: "BS:29" },
  { kw: ["land"], t: "BS:32" },
  { kw: ["goodwill", "fonds de commerce"], t: "BS:34" },
  { kw: ["organization cost", "organisation cost", "formation expenses"], t: "BS:35" },
  { kw: ["patent", "trademark", "intangible", "immobilisations incorporelles"], t: "BS:36" },
  { kw: ["accumulated amortisation", "accumulated amortization"], t: "BS:37" },
  { kw: ["accounts payable", "trade payable", "creditor", "trade creditor", "dettes fournisseurs", "应付账款"], t: "BS:46" },
  { kw: ["vat payable", "sales tax payable", "sundry creditor", "gst", "input tax credit", "taxation", "taxation payable", "income tax payable", "provision for income tax", "superannuation payable", "super payable", "accrued wages", "accrued expense", "payg withholding payable"], t: "BS:OCL" },
  { kw: ["loan from shareholder", "director loan", "amounts owed to"], t: "BS:52" },
  { kw: ["bank loan", "borrowing", "emprunt"], t: "BS:OL" },
  { kw: ["obligations under finance lease", "finance lease", "hire purchase"], t: "BS:OL" },
  { kw: ["preferred stock", "preference share"], t: "BS:58" },
  { kw: ["common stock", "share capital", "called up share", "capital social", "实收资本"], t: "BS:59" },
  { kw: ["paid-in", "share premium", "capital surplus", "prime d'émission"], t: "BS:60" },
  { kw: ["retained earning", "retained profits", "accumulated profit", "profit and loss account", "report à nouveau", "未分配利润"], t: "BS:61" },
  { kw: ["treasury stock", "own shares"], t: "BS:62" },
];

/* ---------- numeric parsing ---------- */
export function numeric(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "") return null;
  let s = String(v).trim().replace(/[\s\u00A0']/g, "");
  // Ledger suffixes: "1,234 CR" is a credit, "1,234-" a trailing-minus negative.
  let neg = /^\(.*\)$/.test(s) || /CR$/i.test(s) || /-$/.test(s.replace(/[^0-9.,\-]/g, ""));
  s = s.replace(/(CR|DR)$/i, "");
  s = s.replace(/[()]/g, "").replace(/[^0-9.,\-]/g, "").replace(/-+$/, "");
  if (!s || !/[0-9]/.test(s)) return null;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if ((s.match(/,/g) || []).length === 1 && /,\d{1,2}$/.test(s)) {
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

/* ---------- keyword matching ---------- */
const kwCache = new Map<string, RegExp>();

function kwHit(label: string, kw: string): boolean {
  if (!kw) return false;
  if (/[^\u0000-\u024F]/.test(kw)) return label.includes(kw);
  let re = kwCache.get(kw);
  if (!re) {
    // Short stems must match exactly or "Iceland" hits the land rule; longer
    // stems may take an inflection so "purchase" catches "purchases".
    const tail = kw.length >= 5 ? "[\\p{L}]{0,3}" : "";
    re = new RegExp(
      "(^|[^\\p{L}\\p{N}])" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + tail + "($|[^\\p{L}\\p{N}])",
      "u",
    );
    kwCache.set(kw, re);
  }
  return re.test(label);
}

/** Longest matching keyword wins, so "accumulated depreciation" beats "depreciation". */
export function matchRule(label: string, rules: MappingRule[]): string | null {
  const l = String(label).toLowerCase();
  let best: string | null = null;
  let bestLen = 0;
  for (const r of rules) {
    for (const k of r.kw) {
      const kk = String(k).toLowerCase();
      if (kk.length > bestLen && kwHit(l, kk)) {
        best = r.t;
        bestLen = kk.length;
      }
    }
  }
  return best;
}

export type ExtractedRow = {
  label: string;
  values: number[];
  /** PDF page the row came from (1-based); absent on spreadsheet rows. */
  page?: number;
  /** Per-value header year (parallel to values); null when un-snapped. */
  years?: (number | null)[];
  /** Leading form line number stripped off the label ("1a", "15"). */
  formLine?: string;
};

/* A cell is numeric when it parses and carries no words \u2014 but ledger
   suffixes like "1,234 CR" must still count as numbers. */
const numericCell = (cell: string): number | null => {
  const s = String(cell).trim();
  if (!s) return null;
  if (/^\(?\s*-?[\d.,\s ']+\s*\)?\s*(?:CR|DR)?\s*\/?\s*$/i.test(s) && /\d/.test(s)) return numeric(s);
  const textual = /[A-Za-z\u00C0-\u024F\u0600-\u06FF\u4E00-\u9FFF]/.test(s);
  const n = numeric(s);
  return n !== null && !textual ? n : null;
};

const textualCell = (cell: string): boolean =>
  /[A-Za-z\u00C0-\u024F\u0600-\u06FF\u4E00-\u9FFF]/.test(String(cell)) && numericCell(String(cell)) === null;

/* Form captions that must never be treated as ledger lines when they arrive
   with a form line number (an IRS/ATO page leaking into generic mapping). */
const FORM_CAPTIONS = new Set([
  "total assets", "total income", "total deductions", "total liabilities and shareholders equity",
  "total liabilities and capital", "gross receipts or sales", "cost of goods sold", "gross profit",
  "total current and accumulated ep", "balance at beginning of year", "balance at beginning of next year",
  "net income or loss per books", "current year net income or loss per books", "taxable income",
  "other income see instructions attach statement", "other deductions attach statement",
  "other current assets attach statement", "other current liabilities attach statement",
  "other investments attach statement", "other assets attach statement", "other liabilities attach statement",
  "reference id number", "identifying number", "employer identification number",
]);

const normCaption = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

/** Contra-asset and allowance captions are stated positive but mean negative. */
export function signForLabel(label: string): 1 | -1 {
  const l = label.toLowerCase();
  if (/^less\b/.test(l)) return -1;
  if (/\baccumulated (depreciation|amorti[sz]ation|depletion)\b/.test(l)) return -1;
  if (/\b(allowance|provision) for (bad|doubtful)\b/.test(l)) return -1;
  return 1;
}

/* Shared hygiene: strip the form-line token, drop line-number echoes and
   known form captions. Returns null when the row is not a ledger line. */
function applyRowHygiene(row: ExtractedRow): ExtractedRow | null {
  let { label, values, years } = row;
  let formLine: string | undefined;
  const lm = /^(\d{1,2})([a-c])?[.)]?\s+(.+)$/.exec(label);
  if (lm && lm[3].length > 2) {
    formLine = lm[1] + (lm[2] || "");
    label = lm[3].trim();
    // The form repeats its line number to the right of the caption; strip it.
    if (values.length && values[0] === Number(lm[1])) {
      values = values.slice(1);
      years = years ? years.slice(1) : years;
    }
  }
  if (!values.length) return null;
  // A sole "value" equal to the row's own line number is the number box, not money.
  if (formLine && values.length === 1 && values[0] === Number(formLine.replace(/[a-c]$/, ""))) return null;
  if (formLine && FORM_CAPTIONS.has(normCaption(label))) return null;
  if (label.length > 64) return null;                    // captions are short
  if (/[.!?]\s+\S/.test(label) || /\n/.test(label)) return null;  // prose, not a ledger line
  if (label.split(/\s+/).length > 9) return null;
  return { ...row, label, values, years, formLine };
}

export function extractRows(rows: string[][] | null): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  if (!rows) return out;
  const colYears = detectGridYearHeader(rows);
  for (const r of rows) {
    if (!r || !r.length) continue;
    let label: string | null = null;
    let labelCol = -1;
    const nums: { v: number; col: number }[] = [];
    for (let i = 0; i < r.length; i++) {
      const cell = r[i];
      if (cell === "" || cell === undefined) continue;
      const n = numericCell(String(cell));
      if (n !== null) nums.push({ v: n, col: i });
      else if (label === null && textualCell(String(cell)) && String(cell).trim().length > 2) {
        label = String(cell).trim();
        labelCol = i;
      }
    }
    if (!label) continue;
    // A number to the left of the caption is an account code, not a balance.
    const kept = nums.filter((x) => x.col > labelCol);
    const values = kept.map((x) => x.v);
    if (!values.length) continue;
    // A row whose numbers are all bare years is a column header, not data.
    if (kept.length >= 2 && kept.every((x) => /^(19|20)\d{2}$/.test(String(r[x.col]).trim()))) continue;
    const years = colYears ? kept.map((x) => colYears[x.col] ?? null) : undefined;
    const cleaned = applyRowHygiene({ label, values, years });
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** A spreadsheet header row of bare years maps grid columns to years. */
export function detectGridYearHeader(rows: string[][]): (number | null)[] | null {
  for (const r of rows.slice(0, 10)) {
    if (!r) continue;
    const filled = r.map((c, i) => ({ c: String(c ?? "").trim(), i })).filter((x) => x.c !== "");
    if (!filled.length) continue;
    const yearCells = filled.filter((x) => /^(19|20)\d{2}$/.test(x.c));
    const textCells = filled.filter((x) => !/^(19|20)\d{2}$/.test(x.c));
    if (yearCells.length >= 1 && yearCells.length <= 4 &&
        textCells.every((x) => x.c.length <= 14) && textCells.length <= 1) {
      const map: (number | null)[] = [];
      for (const y of yearCells) map[y.i] = parseInt(y.c, 10);
      return map;
    }
  }
  return null;
}

/* ---------- spreadsheet reader (no external parser) ---------- */
declare const JSZip: any;

import { pdfToDoc } from "./pdfText";
import type { PdfDoc } from "./pdfText";

/* ---------- positional extraction: column rulers and year snapping ---------- */

export type ColumnRuler = { page: number; y: number; cols: { year: number; x0: number; x1: number }[] };

/** A printed header row of bare years ("2024   2023") rules the rows below it. */
export function detectRulers(doc: PdfDoc): ColumnRuler[] {
  const out: ColumnRuler[] = [];
  for (const r of doc.rows) {
    const yearCells = r.cells.filter((c) => /^(19|20)\d{2}$/.test(c.text));
    if (!yearCells.length || yearCells.length > 4) continue;
    const others = r.cells.filter((c) => !/^(19|20)\d{2}$/.test(c.text));
    if (others.length > 1) continue;
    if (others.some((c) => c.text.length > 14 || numericCell(c.text) !== null)) continue;
    out.push({
      page: r.page,
      y: r.y,
      cols: yearCells.map((c) => ({ year: parseInt(c.text, 10), x0: c.x0, x1: c.x1 })),
    });
  }
  return out;
}

/** Extract ledger rows from a positional document, snapping each number to
    the year column it was printed under. Financial columns right-align, so
    snapping matches right edges (x0 when widths are only estimates). */
export function extractPositionedRows(
  doc: PdfDoc,
  rulers: ColumnRuler[],
  opts?: { pages?: Set<number>; inheritRulerFrom?: Map<number, number> },
): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  const byPage = new Map<number, ColumnRuler[]>();
  for (const rl of rulers) {
    if (!byPage.has(rl.page)) byPage.set(rl.page, []);
    byPage.get(rl.page)!.push(rl);
  }

  const rulerFor = (page: number, y: number): ColumnRuler | null => {
    const own = (byPage.get(page) || []).filter((rl) => rl.y > y);
    if (own.length) return own.reduce((a, b) => (a.y < b.y ? a : b));  // closest above
    const src = opts?.inheritRulerFrom?.get(page);
    if (src !== undefined) {
      const inherited = byPage.get(src) || [];
      if (inherited.length) return inherited[inherited.length - 1];
    }
    return null;
  };

  for (const row of doc.rows) {
    if (opts?.pages && !opts.pages.has(row.page)) continue;
    let label: string | null = null;
    let labelIdx = -1;
    const nums: { v: number; x0: number; x1: number; idx: number }[] = [];
    for (let i = 0; i < row.cells.length; i++) {
      const c = row.cells[i];
      const n = numericCell(c.text);
      if (n !== null) nums.push({ v: n, x0: c.x0, x1: c.x1, idx: i });
      else if (label === null && textualCell(c.text) && c.text.trim().length > 2) {
        label = c.text.trim();
        labelIdx = i;
      }
    }
    if (!label) continue;
    const kept = nums.filter((x) => x.idx > labelIdx);
    if (!kept.length) continue;
    // A row whose numbers are all bare years is a column header, not data.
    if (kept.length >= 2 && kept.every((x) => /^(19|20)\d{2}$/.test(row.cells[x.idx].text.trim()))) continue;

    const ruler = rulerFor(row.page, row.y);
    let years: (number | null)[] | undefined;
    if (ruler) {
      const edges = ruler.cols.map((c) => (doc.approxWidths ? c.x0 : c.x1)).sort((a, b) => a - b);
      const gaps = edges.slice(1).map((e, i) => e - edges[i]);
      const spacing = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
      const tol = doc.approxWidths ? 40 : Math.max(24, spacing * 0.45);
      const taken = new Map<number, { dist: number; slot: number }>();  // col index -> best claim
      years = kept.map(() => null);
      kept.forEach((cell, slot) => {
        let best = -1;
        let bestDist = Infinity;
        ruler.cols.forEach((col, ci) => {
          const dist = doc.approxWidths ? Math.abs(cell.x0 - col.x0) : Math.abs(cell.x1 - col.x1);
          if (dist < bestDist) { bestDist = dist; best = ci; }
        });
        if (best >= 0 && bestDist <= tol) {
          const prev = taken.get(best);
          if (!prev || bestDist < prev.dist) {
            if (prev) years![prev.slot] = null;         // the earlier claim was worse
            taken.set(best, { dist: bestDist, slot });
            years![slot] = ruler.cols[best].year;
          }
        }
      });
    }

    const cleaned = applyRowHygiene({ label, values: kept.map((x) => x.v), years, page: row.page });
    if (cleaned) out.push(cleaned);
  }
  return out;
}

const unesc = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export type ParsedDoc = {
  kind: "pdf" | "xlsx" | "csv";
  /** Plain text grid — the shape every existing consumer understands. */
  grid: string[][];
  /** Positional document, PDFs only. */
  pdf?: PdfDoc;
  /** Workbook sheet names, xlsx only (used by document classification). */
  sheetNames?: string[];
};

/** Back-compat: the plain grid, regardless of source. */
export async function readSpreadsheet(file: File): Promise<string[][] | null> {
  const doc = await readDocument(file);
  return doc ? doc.grid : null;
}

export async function readDocument(file: File): Promise<ParsedDoc | null> {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) {
    const text = await file.text();
    const first = text.split("\n")[0] || "";
    const sep = name.endsWith(".tsv")
      ? "\t"
      : first.split(";").length > first.split(",").length ? ";" : ",";
    const grid = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
    return { kind: "csv", grid };
  }
  if (/\.pdf$/.test(name)) {
    const pdf = await pdfToDoc(await file.arrayBuffer());
    if (!pdf.rows.length) throw new Error("no text layer — this PDF is a scanned image");
    return { kind: "pdf", grid: pdf.rows.map((r) => r.cells.map((c) => c.text)), pdf };
  }
  if (!/\.(xlsx|xlsm)$/.test(name)) return null;

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const wbFile = zip.file("xl/workbook.xml");
  const sheetNames: string[] = wbFile
    ? [...(await wbFile.async("string")).matchAll(/<sheet[^>]*\sname="([^"]+)"/g)].map((m) => unesc(m[1]))
    : [];
  const ssFile = zip.file("xl/sharedStrings.xml");
  let shared: string[] = [];
  if (ssFile) {
    const xml: string = await ssFile.async("string");
    shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
    );
  }
  const paths = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
    .slice(0, 25);
  if (!paths.length) return null;

  let sx = "";
  for (const p of paths) sx += await zip.file(p)!.async("string");

  const rows: string[][] = [];
  for (const rm of sx.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[2] || "";
      const body = cm[3] || "";
      const tm = /t="([^"]+)"/.exec(attrs);
      const type = tm ? tm[1] : "n";
      let val = "";
      if (type === "inlineStr") {
        val = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        val = v ? v[1] : "";
        if (type === "s") val = shared[parseInt(val, 10)] || "";
      }
      const col = cm[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      cells[col] = unesc(String(val));
    }
    if (cells.length) rows.push([...cells].map((c) => (c === undefined ? "" : c)));
  }
  return { kind: "xlsx", grid: rows, sheetNames };
}
