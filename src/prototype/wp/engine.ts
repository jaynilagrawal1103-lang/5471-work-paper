/* Work paper engine — cell coordinates read from the uploaded master template
   Final_Copy_of_5471_workpaper.XLSX. Nothing here is invented: every cell
   reference corresponds to a designated input cell in that workbook. */

export const SHEET = {
  basic: "Basic Information",
  is: "Income Statement",
  bs: "Balance Sheet",
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
  { row: 53, ref: "20", label: "Unusual or infrequently occurring items", group: "Net income" },
  { row: 54, ref: "21a", label: "Income tax expense — current", group: "Net income" },
  { row: 55, ref: "21b", label: "Income tax expense — deferred", group: "Net income" },
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
  { row: 25, ref: "8", label: "Other investment 1", group: "Assets", relabel: true },
  { row: 28, ref: "9a", label: "Buildings and other depreciable assets", group: "Assets" },
  { row: 29, ref: "9b", label: "Less accumulated depreciation (negative)", group: "Assets" },
  { row: 32, ref: "11", label: "Land (net of amortisation)", group: "Assets" },
  { row: 34, ref: "12a", label: "Goodwill", group: "Assets" },
  { row: 35, ref: "12b", label: "Organization costs", group: "Assets" },
  { row: 36, ref: "12c", label: "Patents, trademarks, other intangibles", group: "Assets" },
  { row: 37, ref: "12d", label: "Less accumulated amortisation (negative)", group: "Assets" },
  { row: 39, ref: "13", label: "Other asset 1", group: "Assets", relabel: true },
  { row: 40, ref: "13", label: "Other asset 2", group: "Assets", relabel: true },
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

export type MappingRule = { kw: string[]; t: string };

export const DEFAULT_RULES: MappingRule[] = [
  { kw: ["gross receipt", "turnover", "revenue", "sales", "chiffre d'affaires", "ingresos", "营业收入"], t: "IS:7" },
  { kw: ["returns and allowance", "sales return"], t: "IS:8" },
  { kw: ["cost of labor", "cost of labour", "direct labour"], t: "IS:10" },
  { kw: ["purchase", "achats", "cost of goods", "cogs"], t: "IS:11" },
  { kw: ["dividend income", "dividends received"], t: "IS:14" },
  { kw: ["interest income", "interest received", "produits financiers"], t: "IS:15" },
  { kw: ["rental income", "gross rent"], t: "IS:16" },
  { kw: ["royalt", "licence fee", "license fee"], t: "IS:17" },
  { kw: ["gain on sale", "loss on sale", "disposal of asset"], t: "IS:18" },
  { kw: ["unrealised exchange", "unrealized exchange"], t: "IS:19" },
  { kw: ["realised exchange", "realized exchange", "exchange gain", "exchange loss"], t: "IS:20" },
  { kw: ["salaries", "salary", "payroll", "compensation", "personnel", "staff cost", "charges de personnel"], t: "IS:26" },
  { kw: ["rent expense", "rent", "loyer", "premises rent"], t: "IS:27" },
  { kw: ["royalty expense"], t: "IS:28" },
  { kw: ["interest expense", "finance cost", "charges financi"], t: "IS:29" },
  { kw: ["depreciation", "amortisation expense", "amortization expense", "dotations aux amortissements"], t: "IS:30" },
  { kw: ["depletion"], t: "IS:31" },
  { kw: ["taxes other than income", "business rates", "rates", "property tax", "impots et taxes"], t: "IS:32" },
  { kw: ["income tax - current", "current tax", "corporation tax", "tax on profit", "tax on ordinary activities", "impot sur les societes"], t: "IS:54" },
  { kw: ["deferred tax"], t: "IS:55" },
  { kw: ["cash", "bank account", "banque", "trésorerie", "货币资金"], t: "BS:10" },
  { kw: ["trade receivable", "accounts receivable", "debtor", "trade debtor", "créances clients", "应收账款"], t: "BS:11" },
  { kw: ["allowance for bad debt", "provision for doubtful"], t: "BS:12" },
  { kw: ["inventor", "存货"], t: "BS:14" },
  { kw: ["prepaid", "prepayment", "charges constatées"], t: "BS:16" },
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
  { kw: ["vat payable", "sales tax payable"], t: "BS:48" },
  { kw: ["loan from shareholder", "director loan", "amounts owed to"], t: "BS:52" },
  { kw: ["bank loan", "borrowing", "emprunt"], t: "BS:54" },
  { kw: ["obligations under finance lease", "finance lease", "hire purchase"], t: "BS:54" },
  { kw: ["preferred stock", "preference share"], t: "BS:58" },
  { kw: ["common stock", "share capital", "called up share", "capital social", "实收资本"], t: "BS:59" },
  { kw: ["paid-in", "share premium", "capital surplus", "prime d'émission"], t: "BS:60" },
  { kw: ["retained earning", "accumulated profit", "profit and loss account", "report à nouveau", "未分配利润"], t: "BS:61" },
  { kw: ["treasury stock", "own shares"], t: "BS:62" },
];

/* ---------- numeric parsing ---------- */
export function numeric(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (v === null || v === undefined || v === "") return null;
  let s = String(v).trim().replace(/[\s\u00A0']/g, "");
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/[^0-9.,\-]/g, "");
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

export type ExtractedRow = { label: string; values: number[] };

export function extractRows(rows: string[][] | null): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  if (!rows) return out;
  for (const r of rows) {
    if (!r || !r.length) continue;
    let label: string | null = null;
    let labelCol = -1;
    const nums: { v: number; col: number }[] = [];
    for (let i = 0; i < r.length; i++) {
      const cell = r[i];
      if (cell === "" || cell === undefined) continue;
      const n = numeric(cell);
      const textual = /[A-Za-z\u00C0-\u024F\u0600-\u06FF\u4E00-\u9FFF]/.test(String(cell));
      if (n !== null && !textual) nums.push({ v: n, col: i });
      else if (label === null && textual && String(cell).trim().length > 2) {
        label = String(cell).trim();
        labelCol = i;
      }
    }
    if (!label) continue;
    // A number to the left of the caption is an account code, not a balance.
    const values = nums.filter((x) => x.col > labelCol).map((x) => x.v);
    if (!values.length) continue;
    if (label.length > 64) continue;                    // captions are short
    if (/[.!?]\s+\S/.test(label) || /\n/.test(label)) continue;  // prose, not a ledger line
    if (label.split(/\s+/).length > 9) continue;
    out.push({ label, values });
  }
  return out;
}

/* ---------- spreadsheet reader (no external parser) ---------- */
declare const JSZip: any;

import { pdfToRows } from "./pdfText";

const unesc = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export async function readSpreadsheet(file: File): Promise<string[][] | null> {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) {
    const text = await file.text();
    const first = text.split("\n")[0] || "";
    const sep = name.endsWith(".tsv")
      ? "\t"
      : first.split(";").length > first.split(",").length ? ";" : ",";
    return text.split(/\r?\n/).filter(Boolean).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
  }
  if (/\.pdf$/.test(name)) {
    const rows = await pdfToRows(await file.arrayBuffer());
    if (!rows.length) throw new Error("no text layer — this PDF is a scanned image");
    return rows;
  }
  if (!/\.(xlsx|xlsm)$/.test(name)) return null;

  const zip = await JSZip.loadAsync(await file.arrayBuffer());
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
  return rows;
}
