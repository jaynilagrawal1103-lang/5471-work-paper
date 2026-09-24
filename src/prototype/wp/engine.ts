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
  schP: "Schedule P",
  schQ: "Schedule Q",
  schR: "Schedule R",
  /** The roll-forward tab: prior-filed opening + net income − distributions
      ± adjustments = closing per Schedule F. Where an unexplained difference
      between the books and the prior filing is shown, not hidden. */
  re: "Retained Earnings",
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
  { key: "booksAddr1", cell: "B22", label: "Books custodian address 1" },
  { key: "booksAddr2", cell: "B23", label: "Books custodian address 2" },
  { key: "activity", cell: "B25", label: "Principal business activity" },
  // Placeholder must read as an EXAMPLE — an analyst took a bare "GBP" for a
  // detected value on the Thompson (KYD) case.
  { key: "currency", cell: "B27", label: "Functional currency", placeholder: "e.g. KYD" },
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
  { row: 51, ref: "17", label: "Other deduction 18", group: "Deductions", relabel: true },
  { row: 52, ref: "17", label: "Other deduction 19", group: "Deductions", relabel: true },
  { row: 53, ref: "17", label: "Other deduction 20", group: "Deductions", relabel: true },
  { row: 54, ref: "17", label: "Other deduction 21", group: "Deductions", relabel: true },
  { row: 55, ref: "17", label: "Other deduction 22", group: "Deductions", relabel: true },
  { row: 56, ref: "17", label: "Other deduction 23", group: "Deductions", relabel: true },
  { row: 57, ref: "17", label: "Other deduction 24", group: "Deductions", relabel: true },
  { row: 58, ref: "17", label: "Other deduction 25", group: "Deductions", relabel: true },
  { row: 61, ref: "20", label: "Unusual or infrequently occurring items", group: "Net income" },
  { row: 62, ref: "21a", label: "Income tax expense — current", group: "Net income" },
  { row: 63, ref: "21b", label: "Income tax expense — deferred", group: "Net income" },
  { row: 65, ref: "23a", label: "Other comprehensive income — FX translation", group: "OCI" },
  { row: 66, ref: "23b", label: "Other comprehensive income — other", group: "OCI" },
  { row: 67, ref: "23c", label: "Tax on other comprehensive income", group: "OCI" },
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
  "IS:OD": { sheet: "is", rows: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58] },
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
    if (m[1] === "F" || m[1] === "H") return [9, 13, 21, 25, 33, 59, 60, 64, 68].includes(row);
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
    /* Rows 7-14 are the U.S. Shareholders block. The template ships B7/H7/J7
       as =B19/=H19/=J19 — a one-row mirror of the FIRST direct holder, which
       is only correct when that holder is itself the sole U.S. shareholder.
       Schedule B Part I names the real U.S. shareholders and states their pro
       rata Subpart F percentage, so B/F/H/J and P must be writable here; the
       % columns (L, N) stay formulas, as do the block totals on 15-16. */
    if (row >= 7 && row <= 14) return m[1] === "L" || m[1] === "N";
    if (row === 15 || row === 16) return true;            // block 1 totals
    if (row === 27 || row === 45 || row === 57) return true;
    return m[1] === "L" || m[1] === "N" || m[1] === "P";
  },
  [SHEET.basic]: (ref) => ["A6", "B59", "B60", "B61"].includes(ref),
  // Only the entry cells are writable; every USD cell and every total is a formula.
  [SHEET.re]: (ref) => !["F10", "F16", "F17", "F21", "F24", "F25"].includes(ref) && /^[A-Z]+\d+$/.test(ref) && !/^[A-E]\d+$/.test(ref),
};

/* Leftover captions from the template's demo client; cleared when the run
   leaves their row unused so junk labels never ship in a generated file. */
/* Cells where a write may REPLACE a formula the template itself shipped.
   Deliberately tiny. The U.S. Shareholders block ships B7/H7/J7 as
   =B19/=H19/=J19 — a mirror of the FIRST direct holder — and Schedule B Part I
   has to overwrite it, or row 7 keeps showing the direct shareholder while
   rows 8+ show the real U.S. ones. Every other template formula stays
   protected by FORMULA_REFS and by the belt in xlsxPatch.setCell.

   This does NOT reopen the formula-injection hole closed by the P0 audit:
   buildCell can no longer emit <f> at all, so no user-supplied string can
   become a live formula. It only allows a plain VALUE to replace a formula,
   and only in these cells. */
export const REPLACEABLE_FORMULA_REFS: Record<string, (ref: string) => boolean> = {
  [SHEET.shareholding]: (ref) => /^[BFHJP](?:[7-9]|1[0-4])$/.test(ref) || ref === "H4" || ref === "J4",
};

export const DEMO_RELABELS: Record<string, string[]> = {
  [SHEET.is]: ["C34", "C35", "C36", "C37", "C38", "C39", "C40", "C41", "C42", "C43", "C44", "C45", "C46", "C47", "C48", "C49"],
  [SHEET.bs]: ["B48", "B54", "B55"],
};

export type MappingRule = { kw: string[]; t: string };

/** What a payment processor charges to collect the money. Named once because
    two places need the same list: the rule that books it as a deduction, and
    the override that puts it back on cost of goods sold where the statement
    itself files it there. */
export const PROCESSOR_FEE_KW = [
  "shopify fee", "paypal fee", "stripe fee", "merchant account fee",
  "merchant fee", "payment processing fee", "payment fee",
  "transaction fee", "processing fee",
];

/** Is this caption a payment processor's fee? */
export const isProcessorFee = (label: string): boolean => {
  const l = String(label || "").toLowerCase();
  return PROCESSOR_FEE_KW.some((k) => l.includes(k));
};

export const DEFAULT_RULES: MappingRule[] = [
  /* Subtotals the template recomputes itself. SKIP beats fragment keywords
     ("Cost of Sales" would otherwise hit "sales") because the longest
     matching keyword wins. The store drops SKIP rows silently. */
  { kw: [
    "cost of sales", "total trading income", "total income", "total expenses",
    // Xero and MYOB print "Total for Income" / "Total for Expenses" rather
    // than "Total Income"; without these the subtotal booked as a line item
    // and every component was counted twice.
    "total for income", "total for expenses", "total deductions",
    "gross profit", "trading profit", "net profit", "from ordinary activities",
    "total current assets", "total assets", "total non-current assets",
    "total current liabilities", "total liabilities", "net assets", "total equity",
    "opening retained profits", "closing retained profits", "total changes in equity",
    "attributable to members",
    // Software-export subtotals (observed on the analyst test cases): booking
    // a total AND its components double-counts — the components map, the
    // template recomputes the totals.
    "total net sales", "gross margin", "operating income", "total operating expenses",
    "net income", "total non-current liabilities", "total revenues",
    // Spanish/Chilean return totals. Same reasoning: the components map and
    // the template recomputes. "total de ingresos" must also outrank the bare
    // "ingresos" income keyword, or an annual total is booked as a line.
    "total de ingresos", "total de egresos", "total del activo", "total del pasivo",
    "total de activos", "total de pasivos", "total ingresos", "total egresos",
    // Chilean statements also put the total word last ("INGRESOS TOTALES").
    "ingresos totales", "gastos totales", "costos totales", "activos totales",
    "pasivos totales", "patrimonio total", "total activos", "total pasivos",
    "total gastos", "total costos", "resultado antes de impuestos",
    /* A Chilean return states depreciation twice — financiera (book) and
       tributaria (tax). Both matched the depreciation rule and the entity's
       depreciation doubled. The book figure belongs in a book income
       statement; the tax figure is a reconciling item the template does not
       carry. */
    "depreciacion tributaria", "depreciaci\u00f3n tributaria",
    "resultado financiero", "resultado del ejercicio", "utilidad del ejercicio",
    "perdida del ejercicio", "p\u00e9rdida del ejercicio",
    /* How a Mexican P&L captions its bottom line and its financing subtotal.
       Left unlisted, "Utilidad (o Pérdida)" was offered to the preparer as a
       Schedule C line to assign — booking it would have doubled the loss.
       On a BALANCE sheet the same caption is the year's result inside equity,
       and equityOverride still routes it to retained earnings. */
    "utilidad (o p\u00e9rdida)", "utilidad (o perdida)", "utilidad o p\u00e9rdida", "utilidad o perdida",
    "utilidad o p\u00e9rdida del ejercicio", "utilidad o perdida del ejercicio",
    "resultado integral de financiamiento", "resultado integral", "resultado neto",
    /* Statement subtotals the template recomputes. A Swiss client's accounts
       booked "Operating profit", "Net financial income" and "Profit before
       tax" as three DEDUCTIONS, and "Total revenue" a second time on top of
       the revenue line it totals — revenue came out at exactly twice the
       figure on the page. "total revenues" was listed; "total revenue" was
       not. */
    "total revenue", "operating profit", "profit before tax", "net financial income",
    "total foreign capital", "total fixed assets", "net income for the year",
    /* QuickBooks closes a P&L with "Net earnings"; Xero and Sage print
       "Net profit for the period" / "Net loss". None were listed, so the
       entity's whole profit was booked as an other DEDUCTION and net income
       came out at nil. */
    "net earnings", "net earnings for the year", "net profit for the period", "net loss for the year", "net loss",
    "result for the year", "profit for the year", "loss for the year",
    // The same subtotals as a French/Swiss statement prints them.
    "b\u00e9n\u00e9fice d'exploitation", "benefice d'exploitation",
    "b\u00e9n\u00e9fice de l'exercice", "benefice de l'exercice",
    "total du passif", "total de l'actif", "total des produits", "total des charges",
    "total des capitaux propres", "total des capitaux \u00e9trangers",
  ], t: "SKIP" },
  { kw: ["gross receipt", "turnover", "revenue", "sales", "chiffre d'affaires", "ingresos", "ingresos operacionales", "ventas netas", "receita", "营业收入"], t: "IS:7" },
  { kw: ["service income", "services income", "consulting fees", "consultancy fees", "fees earned"], t: "IS:7" },
  /* Contra-revenue. Line 1b is subtracted by the template, so routing a
     discount here IS the sign fix — booking it to gross receipts (which is
     where "discounts given" landed, via the income banner's catch-all) added
     the discount to income instead of taking it off. */
  { kw: ["returns and allowance", "sales return", "discount given", "discounts given",
         "sales discount", "trade discount", "discounts allowed", "sales allowance",
         "refunds given", "customer refund", "returns and refunds"], t: "IS:8" },
  { kw: ["cost of labor", "cost of labour", "direct labour"], t: "IS:10" },
  { kw: ["purchase", "achats", "cost of goods", "cogs", "costo directo", "costo de venta",
         "costos de venta", "compras", "custo dos produtos",
         // Chile's simplified-regime expense box: stock, supplies and bought-in
         // services, PAID in the year. "existencias" alone is inventory on a
         // balance sheet, so only the compound caption maps here.
         "existencias, insumos", "insumos y servicios"], t: "IS:11" },
  // "Cost of sales" totals are deliberately absent: the components map here
  // and the template's F9 subtotal recomputes the total — both would double-count.
  /* Line 2 "Other costs". The carriage captions name the supplier or the
     movement, not the cost, so no cost keyword reaches them; left unmatched
     they fell to whatever banner was above them, and under an income banner
     they became gross receipts. */
  { kw: ["direct hotel", "direct meals", "direct car rental", "direct airfare", "direct fuel", "direct parking", "direct taxi", "uber", "job cost",
         "freight", "carriage", "shipping and delivery", "delivery expense"], t: "IS:12" },
  /* A payment processor's fee is what it costs to COLLECT the money, not what
     the goods cost, so it is a deduction like any other bank charge and not
     part of cost of goods sold. It kept the fee captions out of gross receipts
     when it lived on line 2 and it still does — the rule matches either way,
     so the banner above the caption never gets to claim it. "Bank fees" and
     "bank charges" already sit in this pool; a card or wallet fee is the same
     kind of cost and now lands beside them. */
  { kw: [...PROCESSOR_FEE_KW], t: "IS:OD" },
  { kw: ["dividend income", "dividends received"], t: "IS:14" },
  { kw: ["interest income", "interest received", "produits financiers"], t: "IS:15" },
  { kw: ["rental income", "gross rent"], t: "IS:16" },
  { kw: ["royalt", "licence fee", "license fee"], t: "IS:17" },
  { kw: ["gain on sale", "loss on sale", "disposal of asset"], t: "IS:18" },
  { kw: ["unrealised exchange", "unrealized exchange"], t: "IS:19" },
  { kw: ["realised exchange", "realized exchange", "exchange gain", "exchange loss"], t: "IS:20" },
  { kw: ["management fees earned", "management fee income", "management fees", "reimbursement", "recharge income", "sundry income", "other income", "other revenue", "other revenues", "otros ingresos", "outras receitas"], t: "IS:OI" },
  { kw: ["salaries", "salary", "compensation", "personnel", "staff cost", "charges de personnel", "wages", "superannuation", "pension contribution", "gastos del personal", "gasto de personal", "gastos de personal", "sueldos", "salarios", "nomina", "n\u00f3mina", "remuneracion", "remunera\u00e7", "cesantias", "cesant\u00edas", "vacaciones consolid", "primas consolid", "despesas com pessoal"], t: "IS:26" },
  { kw: ["rent expense", "rent", "loyer", "premises rent", "arriendo"], t: "IS:27" },
  { kw: ["royalty expense"], t: "IS:28" },
  { kw: ["interest expense", "finance cost", "charges financi", "gastos financieros", "intereses"], t: "IS:29" },
  { kw: ["depreciation", "amortisation expense", "amortization expense", "dotations aux amortissements", "depreciaciones", "amortizaciones", "depreciacion", "depreciaci\u00f3n"], t: "IS:30" },
  { kw: ["depletion"], t: "IS:31" },
  { kw: ["taxes other than income", "business rates", "property tax", "impots et taxes",
         "taxes and licenses", "taxes and licences", "taxes & licenses",
         "licenses and permits", "licences and permits", "business license",
         "business licence"], t: "IS:32" },
  { kw: ["accountancy", "accounting fees", "audit fee", "bookkeeping"], t: "IS:OD" },
  { kw: ["subscription", "membership fee"], t: "IS:OD" },
  { kw: ["telecommunication", "telephone", "internet"], t: "IS:OD" },
  { kw: ["filing fee", "registration fee", "licence cost", "permits"], t: "IS:OD" },
  { kw: ["entertainment", "printing", "stationery", "postage", "advertising", "promotion"], t: "IS:OD" },
  { kw: ["insurance", "workers compensation", "bank fees", "bank charges", "sundry expense", "staff amenities", "motor vehicle", "travel expense", "legal fees", "professional fees", "consultants fees", "computer expense", "office expense", "cleaning", "utilities", "electricity", "repairs and maintenance", "gastos legales", "honorarios", "arrendamientos", "mantenimiento y reparaciones", "gastos de viaje", "seguros"], t: "IS:OD" },
  /* Floor for Spanish deductions. "Otros gastos deducibles de los ingresos" is
     a Chilean return's catch-all expense box, and the only keyword it used to
     hit was "ingresos" — an expense booked as revenue, on both sides of the
     wrong sign. A deduction landing in Other deductions is a mapping the
     preparer can move; a deduction landing in income is one they may not
     notice. More specific rules above still win, being longer. */
  { kw: ["gastos", "egresos", "despesas", "gastos deducibles", "gastos deducidos",
         // "…deducibles/deducidos DE LOS INGRESOS" — the caption of an expense
         // box names the income it is deducted from, and that lone word
         // "ingresos" was enough to book the expense as revenue.
         "de los ingresos"], t: "IS:OD" },
  { kw: ["income tax - current", "current tax", "corporation tax", "tax on profit", "tax on ordinary activities", "income tax revenue", "income tax expense", "impot sur les societes"], t: "IS:62" },
  { kw: ["deferred tax"], t: "IS:63" },
  { kw: ["cash", "bank account", "cash at bank", "banque", "tr\u00e9sorerie", "caja general", "bancos nacionales", "cuentas de ahorro", "caixa", "bancos", "efectivo", "disponibilidades", "caja y bancos", "货币资金", "merchant account", "undeposited funds", "petty cash", "checking account", "savings account",
         /* Xero/MYOB ship these names in the Commonwealth chart of accounts. */
         "cheque account", "cheque acct", "everyday account", "business bank account", "transaction account"], t: "BS:10" },
  { kw: ["trade receivable", "accounts receivable", "debtor", "trade debtor", "cr\u00e9ances clients", "deudores", "cuentas por cobrar", "contas a receber", "应收账款"], t: "BS:11" },
  { kw: ["allowance for bad debt", "provision for doubtful"], t: "BS:12" },

  /* Dutch payroll and materials captions from the analyst test cases. The
     werkkostenregeling is a staff-cost scheme, not an "other deduction". */
  { kw: ["wkr expense", "werkkostenregeling"], t: "IS:26" },
  { kw: ["small material", "kleinmateriaal"], t: "IS:OD" },
  { kw: ["issued & paid up capital", "issued and paid up capital", "paid up capital", "issued capital"], t: "BS:59" },

  /* Line 17, not line 11. "Payroll Expenses" is a QuickBooks parent group
     covering wages, employer taxes and benefits together; the preparer's line
     11 is reserved for the wage and salary captions themselves, which still
     match "wages"/"salaries" above. */
  { kw: ["payroll expense", "payroll cost", "payroll"], t: "IS:OD" },

  /* Equity, which has no keyword rule of its own and therefore fell to the
     liabilities catch-all and was reported as a current liability. Owner
     contributions are paid-in surplus; draws and distributions reduce
     retained earnings and arrive already signed. */
  { kw: ["owner investment", "owner's investment", "owners investment",
         "member capital", "members capital", "member's capital",
         "owner contribution", "owners contribution",
         "capital contribution", "partner capital", "partners capital",
         /* "Capital - Ashley Elliott". A capital account in a named person's
            name is that person's stake, which Schedule F carries on line 21
            (paid-in or capital surplus) -- never on line 20b, which is stock
            the corporation issued. The bare "capital" keyword on the BS:59
            group would otherwise claim it. */
         "capital -", "capital \u2013", "owners capital", "owner's capital",
         "members capital", "member's capital", "partners' capital", "proprietor capital"], t: "BS:60" },
  /* "Opening balance equity" is QuickBooks' setup suspense account, not
     contributed capital: a preparer clears it to retained earnings, which is
     what the hand-prepared SHORI 2024 paper does (243,156.64 - 104,008.71 -
     144,975.47 = -5,827.54 on Schedule F line 22). */
  { kw: ["owner draw", "owners draw", "owner's draw", "owner drawing",
         "opening balance equity",
         "member draw", "members draw", "partner draw", "partners draw",
         "shareholder distribution", "partner distribution", "member distribution",
         "owner distribution", "distributions to owner"], t: "BS:61" },

  /* Periodic (rather than perpetual) inventory: the P&L carries the movement
     as two separate captions, and Schedule C line 2 wants the net. Opening
     stock adds to cost; closing stock RELIEVES it, so its contribution is
     negated in the booking loop — see the closing-stock sign flip in store.ts.
     "Stock on hand" is the balance-sheet caption for the same figure and must
     not be dragged into the P&L by the "stock" fragment. */
  { kw: ["opening stock", "opening finished goods", "opening work in progress", "opening raw materials"], t: "IS:12" },
  { kw: ["closing stock", "closing finished goods", "closing work in progress", "closing raw materials"], t: "IS:12" },
  { kw: ["stock on hand"], t: "BS:14" },

  { kw: ["inventor", "存货"], t: "BS:14" },
  { kw: ["prepaid", "prepayment", "charges constatées", "accrued management fee", "accrued income", "accrued revenue"], t: "BS:OCA" },
  { kw: ["loan to shareholder", "amounts owed by"], t: "BS:19" },
  { kw: ["investment in subsidiar", "shares in group"], t: "BS:21" },
  { kw: ["building", "plant and machinery", "fixed asset", "immobilisations corporelles", "maquinaria y equipo", "equipo de oficina", "equipo de computacion", "equipo de computaci\u00f3n", "propiedad planta y equipo", "imobilizado", "edificios", "instalaciones", "固定资产",
    /* The English of "propiedad planta y equipo", which was already here. Its
       absence sent every English balance sheet's fixed assets into the
       other-assets pool, where the prior-return carry-forward then filled the
       empty lines 9a/9b with the SAME asset and counted it twice. */
    "property, plant and equipment", "property plant and equipment", "plant and equipment",
    /* An accounting package names the asset, not its class: "Computer
       Equipment", "Office Equipment", "Motor Vehicles". None of those words
       appeared here, so a whole fixed-asset register stayed unmapped while its
       accumulated depreciation booked on 9b -- a balance sheet out by the cost
       of every asset the entity owns. */
    "computer equipment", "office equipment", "furniture and fixtures", "furniture and fittings",
    "furniture & fixtures", "furniture & fittings", "fixtures and fittings", "leasehold improvement",
    "plant and machinery", "motor vehicle", "machinery"], t: "BS:28" },
  { kw: ["accumulated depreciation", "amortissements cumul\u00e9s", "depr. acumulada", "depreciacion acumulada", "depreciaci\u00f3n acumulada", "deprec. acumulada"], t: "BS:29" },
  { kw: ["land"], t: "BS:32" },
  { kw: ["goodwill", "fonds de commerce"], t: "BS:34" },
  { kw: ["organization cost", "organisation cost", "formation expenses"], t: "BS:35" },
  { kw: ["patent", "trademark", "intangible", "immobilisations incorporelles"], t: "BS:36" },
  { kw: ["accumulated amortisation", "accumulated amortization"], t: "BS:37" },
  { kw: ["accounts payable", "trade payable", "creditor", "trade creditor", "dettes fournisseurs", "acreedores", "cuentas por pagar", "proveedores", "fornecedores", "应付账款"], t: "BS:46" },
  { kw: ["vat payable", "sales tax payable", "sundry creditor", "gst", "input tax credit", "taxation", "taxation payable", "income tax payable", "provision for income tax", "provision impuesto", "provisi\u00f3n impuesto", "pr\u00e9stamo bancario", "prestamo bancario", "cr\u00e9dito bancario", "credito bancario", "superannuation payable", "super payable", "accrued wages", "accrued expense", "payg withholding payable"], t: "BS:OCL" },
  { kw: ["loan from shareholder", "director loan", "amounts owed to"], t: "BS:52" },
  { kw: ["bank loan", "borrowing", "emprunt", "garant\u00eda", "garantia", "other accounts payable", "cuentas por pagar diversas"], t: "BS:OL" },
  { kw: ["obligations under finance lease", "finance lease", "hire purchase"], t: "BS:OL" },
  { kw: ["preferred stock", "preference share"], t: "BS:58" },
  { kw: ["common stock", "share capital", "called up share", "capital social", "capital suscrito", "capital pagado", "capital", "实收资本"], t: "BS:59" },
  { kw: ["paid-in", "share premium", "capital surplus", "prime d'émission", "fondo de capital", "capital fund"], t: "BS:60" },
  { kw: ["investment", "inversiones", "inversi\u00f3n", "participation account", "cuenta de participaci\u00f3n"], t: "BS:OI" },
  { kw: ["retained earning", "retained profits", "accumulated profit", "profit and loss account", "report \u00e0 nouveau", "utilidades acumuladas", "excedentes acumulados", "resultados acumulados", "lucros acumulados", "未分配利润"], t: "BS:61" },
  { kw: ["treasury stock", "own shares"], t: "BS:62" },
  /* ---- the Mexican chart of accounts ----

     A CONTPAQ i statement names its accounts in Spanish, and in a wording the
     Chilean and Colombian entries written earlier do not cover. Without these,
     "Terrenos" — 94% of one client's total assets — matched nothing, and so
     did the whole fixed-asset register, every tax account and the accumulated
     result. Appended rather than merged into the groups above so a saved
     catalogue receives them whole; the longest keyword still wins, so position
     decides nothing. */
  { kw: ["terrenos", "terreno"], t: "BS:32" },
  { kw: ["equipo de transporte", "equipo de reparto", "autom\u00f3viles", "automoviles", "autobuses", "camiones",
          "equipo de servicios", "equipo de servicio", "mobiliario y equipo", "muebles y enseres",
          "maquinaria y equipo", "edificios", "edificio", "equipo de c\u00f3mputo", "equipo de computo"], t: "BS:28" },
  { kw: ["depreciaci\u00f3n acumulada", "depreciacion acumulada"], t: "BS:29" },
  { kw: ["amortizaci\u00f3n acumulada", "amortizacion acumulada"], t: "BS:37" },
  /* An advance PAID to a supplier is an asset. Left to the payables keyword
     "proveedores" it was booked as a liability, which moves the balance sheet
     by twice the amount; the longer keyword here wins outright. */
  { kw: ["anticipo a proveedores", "anticipos a proveedores", "pagos anticipados", "gastos pagados por anticipado",
          "impuestos a favor", "impuestos acreditables", "impuestos anticipados", "impuestos por recuperar",
          "saldo a favor de impuestos", "iva acreditable"], t: "BS:OCA" },
  { kw: ["impuestos por pagar", "impuestos y derechos por pagar", "contribuciones por pagar", "iva trasladado"], t: "BS:OCL" },
  { kw: ["resultado de ejercicios anteriores", "resultados de ejercicios anteriores", "resultado ejercicios anteriores",
          "resultados ejercicios anteriores", "utilidades retenidas", "p\u00e9rdidas acumuladas", "perdidas acumuladas"], t: "BS:61" },
  { kw: ["depreciaci\u00f3n contable", "depreciacion contable", "depreciaci\u00f3n del ejercicio", "depreciacion del ejercicio"], t: "IS:30" },
  { kw: ["gastos de servicio", "gastos de servicios", "gastos de administraci\u00f3n", "gastos de administracion",
          "gastos de venta", "gastos de ventas", "gastos generales", "gastos de operaci\u00f3n", "gastos de operacion"], t: "IS:OD" },
];

/* ---------- numeric parsing ---------- */
export function numeric(v: unknown, opts?: { dotThousands?: boolean }): number | null {
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
  } else if (!s.includes(",") && (s.match(/\./g) || []).length > 1) {
    /* More than one dot and no comma: the dots group thousands, as Chile,
       Spain, Germany and Brazil print them. parseFloat stops at the second
       dot, so a Chilean balance sheet read 2.555.002.379 as 2.555 — every
       figure understated by a factor of a billion. One dot stays a decimal
       point: "1.234" is genuinely ambiguous and the existing reading of it
       is left alone. */
    s = s.replace(/\./g, "");
  } else if (opts?.dotThousands && !s.includes(",") && /^-?\d{1,3}\.\d{3}$/.test(s)) {
    // A single dot is ambiguous in isolation. Callers opt in only after the
    // surrounding page establishes continental grouping notation.
    s = s.replace(".", "");
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
  return matchRuleScoped(label, rules, null);
}

/** The same scan, restricted to rules that can land on one sheet.

    Two rules may own the same words for different statements: "Motor Vehicle"
    is a depreciable asset on a balance sheet and a running cost on a P&L, and
    both catalogues carry the caption. The unrestricted scan can only return
    one of them, so the loser used to be dropped by feed scoping and the line
    fell through to the banner fallback or to the unmatched list. Scoping the
    scan to the sheet the page belongs to lets the right rule win instead of
    merely letting the wrong one lose. SKIP stays reachable from either sheet:
    a total is a total wherever it is printed. */
export function matchRuleScoped(label: string, rules: MappingRule[], sheet: "IS" | "BS" | null): string | null {
  /* A caption the accounting package itself cut short. CONTPAQ i prints
     "Depreciación acumulada de Eq. de Se.." when the account name does not
     fit the column; matched with the ellipsis attached, the visible stem
     could not end a keyword and the account went unmapped. The original text
     is what is stored, shown and cited — only the scan sees the stem. */
  const l = String(label).toLowerCase().replace(/\s*(?:\.{2,}|\u2026)\s*$/, "").trim();
  /* "Total for Current Liabilities", "Total for Assets", "Subtotal of …":
     a total is a total whatever it totals, and the keyword list cannot
     enumerate every section name a report engine might put after "for".
     Checked before the keywords so that "Total for Assets" cannot fall
     through to the "assets" fragment. */
  if (/^(sub-?)?totals?\s+(for|of)\b/.test(l)) return "SKIP";
  /* "SUMA DEL ACTIVO", "SUMA DEL PASIVO Y CAPITAL" — how a Spanish-language
     package closes a side of the balance sheet. Nothing skipped it, so the
     bare "capital" keyword claimed the equity total for common stock and
     booked the whole accumulated deficit onto Schedule F line 20b. */
  if (/^sumas?\s+de(l|\s+l[ao]s?)?\b/.test(l)) return "SKIP";
  // Spanish totals can put "total" at either end. Catch them before broad
  // ingresos/gastos keywords see a second revenue or deduction line.
  if (/^(?:total(?:es)?\s+(?:de\s+)?)?(?:ingresos|gastos|costos|activos|pasivos|patrimonio)(?:\s+totales?)?$/.test(l)) return "SKIP";
  /* The same total without the "for". QuickBooks closes a group by repeating
     the group's own name: "Bank Accounts" … "Total Bank Accounts". Anything
     the banner lexicon recognises as a group name is a group name here too,
     so "Total <banner>" is that group's subtotal and its components are
     already listed above it. Left to the keyword scan, "Total Bank Accounts"
     matched the "bank account" rule and cash was counted twice. */
  const bare = l.replace(/^(sub-?)?totals?\s+/, "");
  if (bare !== l && isBannerLabel(bare)) return "SKIP";
  let best: string | null = null;
  let bestLen = 0;
  for (const r of rules) {
    if (sheet && r.t !== "SKIP" && !r.t.startsWith(sheet)) continue;
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
  /** The period column the value was taken from ("本年累计数 · YTD"). */
  period?: string;
  /** Why the row could not be booked (surfaces in the review queue). */
  reason?: string;
  /** Left edge of the caption in PDF points. The indent IS the statement's
      hierarchy, and the structural-subtotal detection reads nothing else. */
  x0?: number;
  /** A value-less caption that announces a section ("Current assets"). Row
      hygiene otherwise discards rows with no figure; this one is kept because
      it tells the rows beneath it what they are, and it is never booked.
      See sections.ts. */
  isBanner?: boolean;
};

/* ---------- statement column roles (line numbers, period columns) ---------- */

const LINE_NO_HEADER = /^(行次|序号|項次|line\s*(no\.?|number)?|no\.?|s\.?\s*no\.?|sr\.?\s*no\.?|item\s*no\.?|ref\.?)$/i;
const MONTH_HEADER = /^(本月数|本月數|当月数|本月发生额|本期发生额|current\s*month|month(ly)?\s*(amount|total)?|mtd)$/i;
const YTD_HEADER = /^(本年累计数?|本年累計數?|年累计数?|累计数?|累計數?|year[\s-]*to[\s-]*date|ytd|cumulative(\s*amount)?)$/i;

export type ColumnRoles = {
  lineNoCols: Set<number>;
  monthCol?: number;
  ytdCol?: number;
  ytdHeader?: string;
};

/** Read the header band for column semantics: a 行次/序号/Line-No. column is
    never money, and 本月数/本年累计数 mark period columns — the YTD column is
    chosen deliberately, not by right-most accident. */
export function detectColumnRoles(rows: string[][]): ColumnRoles {
  const roles: ColumnRoles = { lineNoCols: new Set() };
  for (const r of rows.slice(0, 10)) {
    if (!r) continue;
    let hits = 0;
    const found: ColumnRoles = { lineNoCols: new Set() };
    for (let i = 0; i < r.length; i++) {
      const cell = String(r[i] ?? "").trim();
      if (!cell) continue;
      if (LINE_NO_HEADER.test(cell)) { found.lineNoCols.add(i); hits++; }
      else if (MONTH_HEADER.test(cell)) { found.monthCol = i; hits++; }
      else if (YTD_HEADER.test(cell)) { found.ytdCol = i; found.ytdHeader = cell; hits++; }
    }
    if (hits) {
      // One header row wins; merge line-number columns across candidates.
      found.lineNoCols.forEach((c) => roles.lineNoCols.add(c));
      if (found.monthCol !== undefined) roles.monthCol = found.monthCol;
      if (found.ytdCol !== undefined) { roles.ytdCol = found.ytdCol; roles.ytdHeader = found.ytdHeader; }
      if (found.ytdCol !== undefined || found.monthCol !== undefined) break;
    }
  }
  return roles;
}

/** Header-less fallback: a column whose numbers are small ascending integers
    while another column carries money is a line-number column. */
export function detectLineNoColumnByStats(rows: string[][]): number | null {
  const byCol = new Map<number, number[]>();
  const moneyCols = new Set<number>();
  for (const r of rows) {
    if (!r) continue;
    let labelSeen = false;
    for (let i = 0; i < r.length; i++) {
      const cell = String(r[i] ?? "").trim();
      if (!cell) continue;
      if (textualCell(cell)) { labelSeen = true; continue; }
      const n = numericCell(cell);
      if (n === null || !labelSeen) continue;
      if (!byCol.has(i)) byCol.set(i, []);
      byCol.get(i)!.push(n);
      if (Math.abs(n) >= 1000 || !Number.isInteger(n)) moneyCols.add(i);
    }
  }
  if (!moneyCols.size) return null;
  for (const [col, vals] of byCol) {
    if (moneyCols.has(col) || vals.length < 5) continue;
    const smallInts = vals.filter((v) => Number.isInteger(v) && v >= 1 && v <= 999).length;
    if (smallInts / vals.length < 0.8) continue;
    let ascending = 0;
    for (let i = 1; i < vals.length; i++) if (vals[i] >= vals[i - 1]) ascending++;
    if (ascending / Math.max(1, vals.length - 1) >= 0.8) return col;
  }
  return null;
}

/* A cell is numeric when it parses and carries no words \u2014 but ledger
   suffixes like "1,234 CR" must still count as numbers. Exported: the
   carry-forward form reader must never book a digit residue of prose like
   "(combine lines 7 through 13)" as a money value. */
export const numericCell = (cell: string, opts?: { dotThousands?: boolean }): number | null => {
  const s = String(cell).trim();
  if (!s) return null;
  /* A slash or colon between digits is a page count ("1/1"), a fraction, a
     date or a clock time — never an amount. numeric() strips punctuation, so
     without this "1/1" read as eleven and "09:58" as 958, and a report footer
     became a line item worth 11. */
  if (/\d\s*[/:]\s*\d/.test(s)) return null;
  if (/^\(?\s*-?[\d.,\s ']+\s*\)?\s*(?:CR|DR)?\s*\/?\s*$/i.test(s) && /\d/.test(s)) return numeric(s, opts);
  const textual = /[A-Za-z\u00C0-\u024F\u0600-\u06FF\u4E00-\u9FFF]/.test(s);
  const n = numeric(s, opts);
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
/* Lines a report engine prints on every page that are not captions: the
   accrual/cash-basis stamp, a weekday-and-date, a clock time, "Page 1 of 3".
   A one-page report never trips the cross-page furniture test, so this is
   the only thing standing between a QuickBooks footer and the ledger. */
const REPORT_FURNITURE = new RegExp(
  "\\b(accrual|cash)\\s+basis\\b|"
  + "\\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b|"
  + "\\b\\d{1,2}:\\d{2}\\s*(am|pm)\\b|"
  + "\\bpage\\s+\\d+\\s+of\\s+\\d+\\b|"
  + "\\b(gmt|utc)z?\\b",
  "i",
);

/* Exported for the parity harness, which replays real document rows through
   this pipeline and the shipped one and compares the results. Nothing else in
   the app calls it from outside this module. */
export function applyRowHygiene(row: ExtractedRow): ExtractedRow | null {
  let { label, values, years } = row;
  // Before anything reads the caption: the lexicon is ASCII.
  label = sanitize(String(label || ""));
  if (REPORT_FURNITURE.test(label)) return null;
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
  if (!values.length) {
    /* A short caption with no figure that names a section is not noise: it is
       the banner that tells every row beneath it which statement it belongs
       to. Kept, flagged, and never booked. Length-capped because a long line
       with no number is prose, not a heading. */
    if (label.length <= 40 && isBannerLabel(label)) {
      return { ...row, label, values: [], years, isBanner: true };
    }
    return null;
  }
  // A sole "value" equal to the row's own line number is the number box, not money.
  if (formLine && values.length === 1 && values[0] === Number(formLine.replace(/[a-c]$/, ""))) return null;
  if (formLine && FORM_CAPTIONS.has(normCaption(label))) return null;
  if (label.length > 64) return null;                    // captions are short
  /* Prose, not a ledger line — but an ABBREVIATION is not a sentence. A
     CONTPAQ i statement shortens a long account name to "Depreciación
     acumulada de Eq. de Se..", and the full stop after "Eq" read as the end
     of a sentence, so the whole row was discarded before anything could map
     it. A stop after a token of three letters or fewer is an abbreviation. */
  const prose = label.replace(/\b([A-Za-z]{1,3})\.(?=\s)/g, "$1");
  if (/[.!?]\s+\S/.test(prose) || /\n/.test(label)) return null;
  if (label.split(/\s+/).length > 9) return null;
  /* Unmatched brackets mean the caption is the tail (or head) of a sentence
     that wrapped across PDF lines, not a ledger line. A Chilean return's
     "...deber\u00e1 declarar por Internet)" was nine words — just inside the prose
     guard above — and booked the annual tax settlement as telephone expense
     on the word "Internet". A leading enumerator ("a) Cash", "1) Sales") is
     not a bracket and is discounted first. */
  const body = label.replace(/^\s*[A-Za-z0-9]{1,3}[).]\s+/, "");
  if ((body.match(/[([]/g) || []).length !== (body.match(/[)\]]/g) || []).length) return null;
  return { ...row, label, values, years, formLine };
}

/* A value with TWO or more dot groups can only be dots-as-thousands:
   "1.973.582.648" is not a number with two decimal points. One group on its
   own ("622.624") is ambiguous and cannot settle anything, which is why a
   document must be read as a whole before any of its figures are. Without
   this the unambiguous values came out right and the ambiguous ones came out
   a thousand times too small, in the same column. No vocabulary is involved,
   so it holds for every language that writes numbers this way. */
export const dotThousandsDocument = (text: string): boolean => /\d{1,3}(?:\.\d{3}){2,}/.test(text);

export function extractRows(rows: string[][] | null): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  if (!rows) return out;
  const gridText = rows.map((r) => (r || []).join(" ")).join(" ");
  const dotThousands = dotThousandsDocument(gridText);
  const colYears = detectGridYearHeader(rows);
  const roles = detectColumnRoles(rows);
  // Header-less documents still get line-number protection, by column shape.
  if (!roles.lineNoCols.size) {
    const statCol = detectLineNoColumnByStats(rows);
    if (statCol !== null) roles.lineNoCols.add(statCol);
  }
  for (const r of rows) {
    if (!r || !r.length) continue;
    let label: string | null = null;
    let labelCol = -1;
    const nums: { v: number; col: number }[] = [];
    for (let i = 0; i < r.length; i++) {
      if (roles.lineNoCols.has(i)) continue;              // 行次/序号/Line No. — never money
      const cell = r[i];
      if (cell === "" || cell === undefined) continue;
      const n = numericCell(String(cell), { dotThousands });
      if (n !== null) nums.push({ v: n, col: i });
      else if (label === null && textualCell(String(cell)) && String(cell).trim().length > 2) {
        label = String(cell).trim();
        labelCol = i;
      }
    }
    if (!label) continue;
    // A number to the left of the caption is an account code, not a balance.
    let kept = nums.filter((x) => x.col > labelCol);
    let period: string | undefined;
    if (roles.ytdCol !== undefined) {
      // The YTD column is the authoritative period figure. A row without one
      // has no bookable value — a month-only figure must not masquerade as YTD.
      kept = kept.filter((x) => x.col === roles.ytdCol);
      period = `${roles.ytdHeader} · YTD`;
    } else if (kept.length >= 2) {
      // No header knowledge: a small leading integer glued to the caption,
      // followed by real money, is a line number.
      const first = kept[0];
      const restMoney = kept.slice(1).some((x) => Math.abs(x.v) >= 1000 || !Number.isInteger(x.v));
      if (first.col === labelCol + 1 && Number.isInteger(first.v) && first.v >= 1 && first.v <= 999 && restMoney) {
        kept = kept.slice(1);
      }
    }
    const values = kept.map((x) => x.v);
    if (!values.length) continue;
    // A row whose numbers are all bare years is a column header, not data.
    if (kept.length >= 2 && kept.every((x) => /^(19|20)\d{2}$/.test(String(r[x.col]).trim()))) continue;
    const years = colYears ? kept.map((x) => colYears[x.col] ?? null) : undefined;
    const cleaned = applyRowHygiene({ label, values, years, period });
    if (cleaned) out.push(cleaned);
  }
  return out;
}


/* ---------- what a column header says the column is ----------

   A statement does not always head its figure columns with a bare year. The
   same balance sheet that prints "2025  2024" on the profit and loss prints
   "31 MAR 2025  31 MAR 2024" over the balances, and a New Zealand or
   Australian pack often prints "FY24" or "Current Year / Prior Year". Reading
   only a bare year left those pages with no ruler at all: every row then
   carried numbers with no year identity, the router refused all of them, and
   a whole balance sheet went to review unbooked.

   The reading is deliberately strict. A year is accepted only when, after the
   date and period words are taken out, NOTHING else is left — so "2024 Budget"
   and "Note 2024/25" are not years, and a figure such as "1,995.00" can never
   become one. */

const clampYear = (y: number): number | null => (y >= 1990 && y <= 2035 ? y : null);

/** Headers that name the period by position rather than by year. Resolved
    against the engagement's own years once those are known. */
const CY_WORD = /^(current\s+(financial\s+)?year|this\s+year|cy)$/i;
const PY_WORD = /^((prior|previous|last)\s+(financial\s+)?year|py)$/i;

/* A three-letter word is dropped only when it is a currency code ("2024 NZD"),
   never when it is something else the header happens to say. */
let ccyCodes: Set<string> | null = null;
const currencyToken = (word: string): string => {
  if (ccyCodes === null) {
    try { ccyCodes = new Set(Object.keys(FX_META)); } catch { ccyCodes = new Set(); }
  }
  return ccyCodes.has(word.toUpperCase()) ? " " : word;
};

const PERIOD_WORD = /\b(year|years|yr|period|ended|ending|end|as|at|on|of|for|the|to)\b/gi;
const MONTH_WORD = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/gi;

/** The year a column header names, or null when it names none. */
export function headerYear(text: string): number | null {
  const t = String(text ?? "").trim();
  let m: RegExpExecArray | null;
  if (/^(19|20)\d{2}$/.test(t)) return parseInt(t, 10);
  if ((m = /^fy\s*'?((19|20)\d{2})$/i.exec(t))) return clampYear(parseInt(m[1], 10));
  if ((m = /^fy\s*'?(\d{2})$/i.exec(t))) return clampYear(2000 + parseInt(m[1], 10));
  // A long caption is prose, and a two-decimal tail is money.
  if (t.length > 30 || /[.,]\d{2}$/.test(t)) return null;
  if (numericCell(t) !== null && /[()\-]|CR|DR/i.test(t)) return null;
  // Exactly one four-digit year, and not part of a longer number.
  const hits = [...t.matchAll(/(?:19|20)\d{2}/g)].filter((h) => {
    const before = t[(h.index as number) - 1], after = t[(h.index as number) + 4];
    return !(before >= "0" && before <= "9") && !(after >= "0" && after <= "9");
  });
  if (hits.length !== 1) return null;
  const i = hits[0].index as number;
  const rest = (t.slice(0, i) + t.slice(i + 4))
    .replace(PERIOD_WORD, " ")
    .replace(MONTH_WORD, " ")
    .replace(/'0{3}s?|\b000s?\b/gi, " ")       // "2024 '000"
    .replace(/\b[A-Za-z]{3}\b/g, currencyToken)
    .replace(/\b\d{1,2}(st|nd|rd|th)?\b/gi, " ")
    .replace(/[\s.,\/\-–—:;()'"$€£¥₹]+/g, "");
  return rest === "" ? clampYear(parseInt(hits[0][0], 10)) : null;
}

/** A spreadsheet header row of years maps grid columns to years. A bare year
    on its own is enough; a dated or worded header needs a second column to
    agree, so a stray "2024" in a one-column sheet cannot rule it. */
export function detectGridYearHeader(rows: string[][]): (number | null)[] | null {
  for (const r of rows.slice(0, 10)) {
    if (!r) continue;
    const filled = r.map((c, i) => ({ c: String(c ?? "").trim(), i })).filter((x) => x.c !== "");
    if (!filled.length) continue;
    const years: Array<{ y: number; i: number; bare: boolean }> = [];
    const worded: Array<{ y: number; i: number }> = [];
    const rest: Array<{ c: string; i: number }> = [];
    for (const x of filled) {
      const bare = /^(19|20)\d{2}$/.test(x.c);
      const y = bare ? parseInt(x.c, 10) : headerYear(x.c);
      if (bare) years.push({ y: y as number, i: x.i, bare: true });
      else if (y !== null) years.push({ y, i: x.i, bare: false });
      else if (CY_WORD.test(x.c)) worded.push({ y: -1, i: x.i });
      else if (PY_WORD.test(x.c)) worded.push({ y: -2, i: x.i });
      else rest.push(x);
    }
    const quiet = rest.every((x) => x.c.length <= 14) && rest.length <= 1;
    if (years.length >= 1 && years.length <= 4 && !worded.length && quiet &&
        (years.every((x) => x.bare) || years.length >= 2)) {
      const map: (number | null)[] = [];
      for (const y of years) map[y.i] = y.y;
      return map;
    }
    if (!years.length && worded.length === 2 &&
        worded.some((x) => x.y === -1) && worded.some((x) => x.y === -2) &&
        quiet && rest.every((x) => numericCell(x.c) === null)) {
      const map: (number | null)[] = [];
      for (const w of worded) map[w.i] = w.y;
      return map;
    }
  }
  return null;
}

/* ---------- spreadsheet reader (no external parser) ---------- */
declare const JSZip: any;

import { pdfToDoc } from "./pdfText";
import { sanitize } from "./hygiene";
import { isBannerLabel } from "./sectionBanners";
import { FX_META } from "./fxRates";
import type { PdfDoc, PdfRow, PdfCell } from "./pdfText";

/* ---------- statements printed as two facing panels ----------

   A Mexican, Spanish or Latin-American balance sheet is commonly printed as
   two halves of one page: ACTIVO down the left, PASIVO and CAPITAL down the
   right, with an account on each side sharing every print line. Read as
   ordinary rows, the line

       Bancos            71.89      Acreedores diversos a corto plazo  15,541,257.57

   becomes ONE row captioned "Bancos" carrying two numbers, which the column
   router then reads as two period columns of the same account. The liability
   is attached to the asset, and the account that owned it is never emitted at
   all — it is not booked, not unmatched and not in Review.

   The layout is found from the page's own geometry rather than from any
   wording, so it holds for a statement in any language. A vertical band that
   no cell crosses divides the page; the test that makes it a PANEL divide
   rather than the ordinary gap before a figures column is that BOTH sides
   carry captions of their own, and that several print lines carry a caption
   and a figure on each side at once. */

type Panel = { x0: number; x1: number };

const panelTextual = (t: string): boolean =>
  /\p{L}/u.test(t) && t.trim().length >= 3 && numericCell(t) === null && !/^(19|20)\d{2}$/.test(t.trim());

/** The x of a vertical band no cell crosses, splitting a page into two
    caption-and-figure panels; null when the page is an ordinary statement. */
export function panelSplitX(rows: PdfRow[]): number | null {
  /* The bands are measured on the rows that carry a figure on EACH side —
     never on the letterhead. A page header runs the client's name across the
     middle of the page, and one such row bridges the very gap the two panels
     are divided by, so a page that plainly has two panels appeared to have
     none. Rows with two or more figures are the ones the layout question is
     actually about. */
  const body = rows.filter((r) => r.cells.filter((c) => numericCell(c.text) !== null).length >= 2);
  if (body.length < 3) return null;
  const cells = body.flatMap((r) => r.cells);
  if (cells.length < 12) return null;
  const left = Math.min(...cells.map((c) => c.x0));
  const right = Math.max(...cells.map((c) => c.x1));
  const width = right - left;
  if (!(width > 0)) return null;

  // Occupied x-ranges, merged; the holes between them are the candidate bands.
  const spans = cells.map((c) => ({ a: c.x0, b: c.x1 })).sort((p, q) => p.a - q.a);
  const merged: { a: number; b: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.a <= last.b) last.b = Math.max(last.b, s.b);
    else merged.push({ ...s });
  }

  let best: { x: number; w: number } | null = null;
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i].a - merged[i - 1].b;
    if (gap < 12) continue;
    const x = (merged[i - 1].b + merged[i].a) / 2;
    // Both panels must be a real share of the page.
    if (x - left < width * 0.25 || right - x < width * 0.25) continue;
    if (!panelsQualify(rows, x)) continue;
    if (!best || gap > best.w) best = { x, w: gap };
  }
  return best ? best.x : null;
}

/** Both sides carry their own captions with figures, and they do so on the
    same lines — which a caption column followed by figure columns never does. */
function panelsQualify(rows: PdfRow[], x: number): boolean {
  let leftRows = 0, rightRows = 0, shared = 0;
  for (const r of rows) {
    const l = r.cells.filter((c) => c.x1 <= x);
    const rt = r.cells.filter((c) => c.x0 >= x);
    const pair = (cs: PdfCell[]) => {
      const li = cs.findIndex((c) => panelTextual(c.text));
      return li >= 0 && cs.slice(li + 1).some((c) => numericCell(c.text) !== null);
    };
    const lp = pair(l), rp = pair(rt);
    if (lp) leftRows++;
    if (rp) rightRows++;
    if (lp && rp) shared++;
  }
  return leftRows >= 3 && rightRows >= 3 && shared >= 2;
}

/** Re-cut a document so each panel of a two-panel page is read on its own.
    Pages that are not printed this way come back untouched, and so does the
    order of everything on them. Left panel first, then right, so that a
    section heading still precedes the rows it announces. Each panel's left
    edge becomes its own zero, so indentation stays comparable between them. */
export function splitSidePanels(doc: PdfDoc): PdfDoc {
  const pages = new Map<number, PdfRow[]>();
  for (const r of doc.rows) {
    if (!pages.has(r.page)) pages.set(r.page, []);
    pages.get(r.page)!.push(r);
  }
  let changed = false;
  const out: PdfRow[] = [];
  for (const [, rows] of [...pages.entries()].sort((a, b) => a[0] - b[0])) {
    const x = panelSplitX(rows);
    if (x === null) { out.push(...rows); continue; }
    changed = true;
    /* A cell that straddles the divide — a running header, a title — belongs
       to whichever side holds more of it, so nothing printed on the page is
       silently dropped by the cut. */
    const sideOf = (c: PdfCell) => (c.x1 <= x ? "l" : c.x0 >= x ? "r" : (x - c.x0 >= c.x1 - x ? "l" : "r"));
    const side = (want: "l" | "r") => {
      const kept: PdfRow[] = [];
      for (const r of rows) {
        const cells = r.cells.filter((c) => sideOf(c) === want);
        if (cells.length) kept.push({ page: r.page, y: r.y, cells });
      }
      if (!kept.length) return kept;
      const edge = Math.min(...kept.flatMap((r) => r.cells.map((c) => c.x0)));
      return kept.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, x0: c.x0 - edge, x1: c.x1 - edge })) }));
    };
    out.push(...side("l"), ...side("r"));
  }
  return changed ? { ...doc, rows: out } : doc;
}

/* ---------- positional extraction: column rulers and year snapping ---------- */

export type ColumnRuler = { page: number; y: number; cols: { year: number; x0: number; x1: number }[] };

/** A printed header row that names its columns' years rules the rows below it.
    "2024   2023" and "31 MAR 2025   31 MAR 2024" are both read; so are
    "Current Year / Prior Year", which carry -1 and -2 until the engagement
    years resolve them (see resolveWordRulers).

    A header cell that is not a bare year has to be confirmed by a second year
    column, so a single dated caption cannot rule a page on its own. */
export function detectRulers(doc: PdfDoc): ColumnRuler[] {
  const out: ColumnRuler[] = [];
  for (const r of doc.rows) {
    const years: Array<{ year: number; x0: number; x1: number; bare: boolean }> = [];
    const worded: Array<{ year: number; x0: number; x1: number }> = [];
    const rest: PdfCell[] = [];
    for (const c of r.cells) {
      const bare = /^(19|20)\d{2}$/.test(c.text);
      const y = bare ? parseInt(c.text, 10) : headerYear(c.text);
      if (bare) years.push({ year: y as number, x0: c.x0, x1: c.x1, bare: true });
      else if (y !== null) years.push({ year: y, x0: c.x0, x1: c.x1, bare: false });
      else if (CY_WORD.test(c.text.trim())) worded.push({ year: -1, x0: c.x0, x1: c.x1 });
      else if (PY_WORD.test(c.text.trim())) worded.push({ year: -2, x0: c.x0, x1: c.x1 });
      else rest.push(c);
    }
    // Whatever else is on the line is the row's caption, never a figure.
    const quiet = !(rest.length > 1 || rest.some((c) => c.text.length > 14 || numericCell(c.text) !== null));
    if (years.length >= 1 && years.length <= 4 && !worded.length && quiet &&
        (years.every((x) => x.bare) || years.length >= 2)) {
      out.push({ page: r.page, y: r.y, cols: years.map((x) => ({ year: x.year, x0: x.x0, x1: x.x1 })) });
    } else if (!years.length && worded.length === 2 &&
               worded.some((x) => x.year === -1) && worded.some((x) => x.year === -2) && quiet) {
      out.push({ page: r.page, y: r.y, cols: worded.map((x) => ({ year: x.year, x0: x.x0, x1: x.x1 })) });
    }
  }
  return out;
}

/** "Current Year / Prior Year" only means a year once the engagement says
    which years those are. A ruler still carrying a placeholder when they are
    unknown is dropped rather than guessed. */
export function resolveWordRulers(
  rulers: ColumnRuler[],
  years: { cy: number | null; py: number | null } | null | undefined,
): ColumnRuler[] {
  const out: ColumnRuler[] = [];
  for (const r of rulers) {
    if (!r.cols.some((c) => c.year < 0)) { out.push(r); continue; }
    if (!years || !years.cy) continue;
    out.push({
      ...r,
      cols: r.cols.map((c) => ({
        ...c,
        year: c.year === -1 ? (years.cy as number) : c.year === -2 ? (years.py ?? (years.cy as number) - 1) : c.year,
      })),
    });
  }
  return out;
}

/** A statement that runs over a page break prints its column header once. The
    pages that follow, up to three of them, are ruled by the last header above
    them — and only pages in the same feed, so a balance sheet never inherits
    the profit and loss's columns. */
export function inheritRulers(rulers: ColumnRuler[], pages: Set<number>): Map<number, number> {
  const from = new Map<number, number>();
  const ruled = new Set(rulers.map((r) => r.page));
  let last: number | null = null;
  for (const p of [...pages].sort((a, b) => a - b)) {
    if (ruled.has(p)) last = p;
    else if (last !== null && p - last <= 3) from.set(p, last);
  }
  return from;
}

/* ---------- columns named by what they measure, not by a year ----------

   A ledger export often heads its figure columns with the PERIOD TYPE rather
   than a year: "Periodo | % | Acumulado | %" on a Mexican CONTPAQ i statement,
   "本月数 | 本年累计数" on a Chinese one, "MTD | YTD" on an English one. The
   year ruler cannot tag any of those, so every row arrived carrying four
   numbers with no year identity and the router refused all of them — the whole
   profit and loss went unbooked. Worse, a router that simply took the first
   number would take the MONTH: 46.54 of finance cost where the year's figure
   is 5,878.11.

   The cumulative column is the year. The percentage columns are not money at
   all and are dropped before anything can mistake one for an amount. */

export type PeriodRuler = {
  page: number;
  y: number;
  /** The year-to-date column(s), and their printed heading. */
  cumulative: { x0: number; x1: number }[];
  heading: string;
  /** Columns that are not the year: this period alone, and percentages. */
  other: { x0: number; x1: number }[];
};

const CUMULATIVE_HEAD = /^(acumulad[oa]s?|acumulado del ejercicio|ytd|year[\s-]*to[\s-]*date|cumulative(\s+amount)?|saldo acumulado|acumulat|本年累计数?|本年累計數?|年累计数?|累计数?|累計數?)$/i;
const PERIOD_HEAD = /^(per[ií]odo|periodo actual|del per[ií]odo|mes|mes actual|del mes|month(ly)?(\s+(amount|total))?|mtd|current\s*month|本月数|本月數|当月数|本月发生额|本期发生额)$/i;
const PERCENT_HEAD = /^(%|%\s*$|porcentaje|percent(age)?|pct)$/i;

/** Rows that head their figure columns by period type rather than by year. */
export function detectPeriodRulers(doc: PdfDoc): PeriodRuler[] {
  const out: PeriodRuler[] = [];
  for (const r of doc.rows) {
    const cum: { x0: number; x1: number }[] = [];
    const other: { x0: number; x1: number }[] = [];
    let heading = "";
    let foreign = 0;
    for (const c of r.cells) {
      const t = c.text.trim();
      if (!t) continue;
      if (CUMULATIVE_HEAD.test(t)) { cum.push({ x0: c.x0, x1: c.x1 }); heading = heading || t; }
      else if (PERIOD_HEAD.test(t) || PERCENT_HEAD.test(t)) other.push({ x0: c.x0, x1: c.x1 });
      else if (numericCell(t) !== null) foreign++;   // a figure: this is data, not a header
      else if (t.length > 2) foreign++;
    }
    // A header row, not a data row: at least one cumulative column, at least
    // one column that is not it, and nothing else on the line.
    if (cum.length && other.length && !foreign) out.push({ page: r.page, y: r.y, cumulative: cum, heading, other });
  }
  return out;
}

/** Which column a printed figure sits in — by overlap, because a figure can
    run wider than the word above it ("0.00" under "%"). */
const colOverlap = (a: { x0: number; x1: number }, b: { x0: number; x1: number }): number =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));

/** Extract ledger rows from a positional document, snapping each number to
    the year column it was printed under. Financial columns right-align, so
    snapping matches right edges (x0 when widths are only estimates). */
export function extractPositionedRows(
  doc: PdfDoc,
  rulers: ColumnRuler[],
  opts?: {
    pages?: Set<number>;
    inheritRulerFrom?: Map<number, number>;
    /** Skip ledger-line hygiene — for narrative pages (equity movements)
        where long captions still carry the values that matter. */
    raw?: boolean;
    /** Columns headed by period type ("Periodo | % | Acumulado | %"). */
    periodRulers?: PeriodRuler[];
  },
): ExtractedRow[] {
  const out: ExtractedRow[] = [];
  const byPage = new Map<number, ColumnRuler[]>();
  const periodByPage = new Map<number, PeriodRuler[]>();
  for (const pr of opts?.periodRulers || []) {
    if (!periodByPage.has(pr.page)) periodByPage.set(pr.page, []);
    periodByPage.get(pr.page)!.push(pr);
  }
  const periodRulerFor = (page: number, y: number): PeriodRuler | null => {
    const own = (periodByPage.get(page) || []).filter((pr) => pr.y > y);
    return own.length ? own.reduce((a, b) => (a.y < b.y ? a : b)) : null;
  };
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
    /* Chilean statements use dots as thousands separators, including a
       single group (79.242). Establish that convention from the page, never
       from one ambiguous token, so ordinary decimal statements are unchanged. */
    const statementText = doc.rows.filter((r) => r.page === row.page)
      .map((r) => r.cells.map((c) => c.text).join(" ")).join(" ").toLowerCase();
    const chileanStyle = dotThousandsDocument(statementText)
      || (/\b(balance|estado de resultados|ingresos|gastos|activos|pasivos|patrimonio)\b/.test(statementText)
        && /\b\d{1,3}\.\d{3}\b/.test(statementText));
    for (let i = 0; i < row.cells.length; i++) {
      const c = row.cells[i];
      const n = numericCell(c.text, { dotThousands: chileanStyle });
      if (n !== null) nums.push({ v: n, x0: c.x0, x1: c.x1, idx: i });
      else if (label === null && textualCell(c.text) && c.text.trim().length > 2) {
        label = c.text.trim();
        labelIdx = i;
      }
    }
    if (!label) continue;
    // The caption's own left edge: the statement's indent hierarchy, which is
    // the only evidence structural-subtotal detection has to work from.
    const x0 = row.cells[labelIdx] ? row.cells[labelIdx].x0 : undefined;
    let kept = nums.filter((x) => x.idx > labelIdx);
    /* Columns headed by period type rather than by year. The cumulative
       column is the year's figure; the period column is one month of it and
       the percentage columns are not money. Keeping all four left the row
       with no single current-year value and nothing could be booked. */
    let periodHeading: string | undefined;
    const pr = periodRulerFor(row.page, row.y);
    if (pr && kept.length > 1) {
      const inCumulative = kept.filter((k) =>
        pr.cumulative.some((c) => colOverlap(k, c) > 0)
        && !pr.other.some((o) => colOverlap(k, o) > colOverlap(k, pr.cumulative.reduce((a, b) => (colOverlap(k, a) >= colOverlap(k, b) ? a : b)))));
      if (inCumulative.length) { kept = inCumulative; periodHeading = pr.heading; }
    }
    if (!kept.length) {
      /* No figure on the line. Usually noise — but a short caption that names
         a section is the banner the rows beneath it belong to, so it is
         emitted rather than dropped. Never on a raw page: those are narrative
         (equity movements), where a bare line is prose, not a heading. */
      if (!opts?.raw && label.length <= 40 && isBannerLabel(label)) {
        out.push({ label, values: [], years: undefined, page: row.page, x0, isBanner: true });
      }
      continue;
    }
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

    const candidate: ExtractedRow = {
      label, values: kept.map((x) => x.v), years, page: row.page, x0,
      ...(periodHeading ? { period: periodHeading } : {}),
    };
    if (opts?.raw) { out.push(candidate); continue; }
    const cleaned = applyRowHygiene(candidate);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

const unesc = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/* ---------- notes to the financial statements ----------

   Schedule F wants a fixed asset at COST on line 9a with accumulated
   depreciation on 9b, but almost every set of accounts prints only the NET
   figure on the face and puts the split in a note. Read the note.

   The note headings ("4. Property, Plant and Equipment") carry no figure, so
   the row reader drops them. What survives is the shape the note closes with:

       Cost                                  43,517   21,479
       Accumulated Depreciation             (29,537)  (6,202)
       Total Plant and Equipment              13,980   15,277
       Cost                                  53,838   35,793
       Accumulated Depreciation             (44,465) (22,404)
       Total Vehicles                          9,373   13,389
       Total Property, Plant and Equipment    23,353   28,667

   So a note is read BACKWARDS from its closing total: everything above it,
   down to the previous total at the same or a shallower indent, belongs to
   it. Nothing is booked on the strength of the shape alone -- each consumer
   below has to prove its arithmetic against the note's own total first. */

/** One note, as its closing "Total ..." line and the rows that line adds. */
export type StatementNote = {
  /** The closing line's caption with the leading total word removed. */
  title: string;
  /** The closing line's own figures, one per printed column. */
  total: number[];
  /** Everything the closing line covers, in printed order. */
  components: ExtractedRow[];
  page?: number;
};

const NOTE_TOTAL = /^(?:total|sub-?total)\s+(.+)$/i;
const indentOfRow = (r: ExtractedRow): number =>
  typeof r.x0 === "number" ? Math.round(r.x0 * 10) / 10 : 0;

/** Split the rows of the notes pages into notes. */
export function statementNotes(rows: ExtractedRow[]): StatementNote[] {
  const out: StatementNote[] = [];
  for (let i = 0; i < rows.length; i++) {
    const m = NOTE_TOTAL.exec(String(rows[i].label || "").trim());
    if (!m || !rows[i].values.length) continue;
    const ind = indentOfRow(rows[i]);
    const components: ExtractedRow[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const prev = rows[j];
      // the previous note closed here, at this level or outside it
      if (NOTE_TOTAL.test(String(prev.label || "").trim()) && indentOfRow(prev) <= ind) break;
      // a note does not run onto another page; without this the walk ran back
      // through the whole of the previous page once a note opened with a row
      // that is not itself a total
      if (prev.page !== rows[i].page) break;
      if (!prev.values.length) break;
      components.unshift(prev);
    }
    if (components.length) {
      out.push({ title: m[1].trim(), total: rows[i].values.slice(), components, page: rows[i].page });
    }
  }
  return out;
}

/** Equal enough for a note: statements round each line, so a total can differ
    from its own components by up to half a unit per line. */
const noteTies = (parts: number[], total: number): boolean =>
  Math.abs(parts.reduce((n, v) => n + v, 0) - total) <= Math.max(0.02, parts.length * 0.5);

const COST_ROW = /^(?:at\s+)?cost(?:\s+price|\s+or\s+valuation)?$/i;
const DEP_ROW = /^(?:less\s+)?accumulated\s+(?:depreciation|amortisation|amortization)$/i;
const FIXED_ASSET_NOTE = /^(?:property,?\s*)?plant\s*(?:,|and|&)?\s*(?:and\s+)?equipment$|^property,?\s+plant\s+(?:and|&)\s+equipment$|^fixed\s+assets$|^(?:tangible\s+)?fixed\s+asset\s+(?:summary|schedule)$/i;

/** Cost and accumulated depreciation for Schedule F lines 9a and 9b, per
    printed column, taken from the fixed-asset note.
 *
 * Returns null unless the note proves itself: every class must state both a
 * cost and an accumulated depreciation, and cost less depreciation must equal
 * the note's own total in every column. A note that does not tie is a note we
 * have misread, and a misread fixed asset is worse than a net one. */
export function fixedAssetSplit(
  notes: StatementNote[],
): { cost: number[]; accumDep: number[]; net: number[] } | null {
  /* "Property, Plant and Equipment" closes over "Plant and Equipment" and
     "Vehicles", and all three titles match. Take the one that covers the most
     rows: the classes are inside it, and only the outer note's total is the
     figure the balance sheet carries. */
  const note = notes.filter((n) => FIXED_ASSET_NOTE.test(n.title))
    .sort((a, b) => b.components.length - a.components.length)[0];
  if (!note) return null;
  const costs = note.components.filter((r) => COST_ROW.test(String(r.label || "").trim()));
  const deps = note.components.filter((r) => DEP_ROW.test(String(r.label || "").trim()));
  if (!costs.length || costs.length !== deps.length) return null;
  const cols = note.total.length;
  if (!cols) return null;
  const cost: number[] = [], accumDep: number[] = [];
  for (let c = 0; c < cols; c++) {
    // every class has to state this column, or the note is not comparable
    if (costs.some((r) => r.values.length <= c) || deps.some((r) => r.values.length <= c)) return null;
    cost.push(costs.reduce((n, r) => n + r.values[c], 0));
    accumDep.push(deps.reduce((n, r) => n + Math.abs(r.values[c]), 0));
    if (!noteTies([cost[c], -accumDep[c]], note.total[c])) return null;
  }
  return { cost, accumDep, net: note.total.slice() };
}

/** Notes that turn out to hold exactly ONE thing.
 *
 *   5. Other Non Current Assets
 *      Intangible Assets                 2,411   2,411
 *      Total Other Non Current Assets    2,411   2,411
 *
 * "Other Non Current Assets" is unmappable and lands in the other-assets pool;
 * "Intangible Assets" is line 12c. The note says they are the same figure, so
 * the note's own caption is the better one to map. Only a single component
 * that equals the total qualifies -- a note listing several things says
 * nothing about which line the face caption belongs on. */
export function noteLookthrough(notes: StatementNote[]): Map<string, string> {
  const out = new Map<string, string>();
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const n of notes) {
    if (n.components.length !== 1) continue;
    const only = n.components[0];
    const cols = Math.min(n.total.length, only.values.length);
    if (!cols) continue;
    let ties = true;
    for (let c = 0; c < cols; c++) if (!noteTies([only.values[c]], n.total[c])) ties = false;
    if (!ties) continue;
    const from = key(n.title), to = String(only.label || "").trim();
    if (!from || !to || from === key(to)) continue;
    out.set(from, to);
  }
  return out;
}

/* ---------- worksheet selection ----------

   A client workbook is rarely one statement. It is a cover sheet, an index, a
   lead schedule, the trial balance, the P&L, the balance sheet, a notes tab and
   three tabs of queries. Reading every tab into one flat grid means the notes
   and the query log compete with the statements for the same captions, and a
   caption that appears on both wins by position rather than by meaning.

   So rank the tabs by name. Statement tabs are read; administrative tabs are
   skipped and NAMED in the log, because a wrongly skipped tab must be visible
   and correctable (DocKindOverride.sheets pins an explicit list per document).
   When nothing scores as a statement, everything non-administrative is read —
   the ranking narrows the input, it never empties it. */

/** Tab names that read as a financial statement. Mirrors STATEMENT_TITLE in
    classify.ts, plus the trial-balance and ledger wordings that only ever
    appear as tab names. */
const SHEET_STATEMENT = new RegExp(
  "(balance sheet|statement of financial position|balance general|balance de situaci\u00f3n|"
  + "estado de situaci\u00f3n financiera|estado de situacion financiera|balan\u00e7o|balanco|"
  + "bilan\\b|bilanz|bilancio|balans|"
  + "income statement|profit (and|or|&) loss|p ?& ?l\\b|p and l\\b|compte de profits et pertes|"
  + "compte de r\u00e9sultat|compte de resultat|statement of comprehensive income|"
  + "statement of financial performance|estado de resultados?|cuenta de resultados|"
  + "demonstra\u00e7\u00e3o do resultado|demonstracao do resultado|conto economico|"
  + "winst- en verliesrekening|gewinn- und verlustrechnung|erfolgsrechnung|"
  + "trial balance|balanza de comprobaci\u00f3n|balanza de comprobacion|proefbalans|"
  + "general ledger|grootboek)",
);

/** Tab names that are administration around the statements, never the figures. */
const SHEET_ADMIN = new RegExp(
  "^(cover|contents|table of contents|index|notes?|note \\d|instructions?|"
  + "lead|lead schedule|queries|query log|q&a|review|checklist|control|"
  + "assumptions|workings|scratch|sheet\\d*)$|"
  + "\\b(cover sheet|notes to the (financial )?(statements|accounts)|"
  + "query log|lead schedule)\\b",
);

/** Which worksheets to read, and which to leave out, given their names.
    Pure and exported so the decision can be tested and shown to the user. */
export function rankSheets(names: string[]): { read: string[]; skip: string[] } {
  const norm = (n: string) => n.toLowerCase().replace(/\s+/g, " ").trim();
  const statements = names.filter((n) => SHEET_STATEMENT.test(norm(n)));
  if (statements.length) {
    return { read: statements, skip: names.filter((n) => !statements.includes(n)) };
  }
  const keep = names.filter((n) => !SHEET_ADMIN.test(norm(n)));
  // Every tab looked administrative — that is a naming convention this lexicon
  // does not know, not an empty workbook. Read it all rather than lose it.
  if (!keep.length) return { read: [...names], skip: [] };
  return { read: keep, skip: names.filter((n) => !keep.includes(n)) };
}

/** Why this particular file could not be read, and what to do about it.
 *
 * A single "unsupported format" line sent preparers to convert files that
 * were already supported, and left them re-uploading the same broken .xls.
 * Each answer names the actual obstacle and the actual remedy — and the .xls
 * case is the reason this exists: the format IS read, so a failure there is
 * about the file, not the extension. */
export function explainUnreadable(name: string): string {
  const ext = "." + (name.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case ".xls":
      return "This legacy .xls workbook could not be opened. .xls itself is supported, so the file rather than the format is the obstacle: it may be password-protected, truncated by an incomplete download, or an Excel 5.0/95 workbook older than the BIFF8 format the reader handles. Open it in Excel and re-save as .xlsx, then re-upload.";
    case ".doc":
      return "Legacy .doc is a binary Word 97–2003 document, not a zipped XML package. Re-save as .docx (File ▸ Save As ▸ Word Document) and re-upload.";
    case ".ppt": case ".pptx":
      return "Presentations are not a source of financial statement data, so no reader exists for them. If the figures you need are on a slide, copy them into a spreadsheet or enter them directly on the schedule line.";
    case ".png": case ".jpg": case ".jpeg": case ".gif": case ".webp": case ".tiff": case ".bmp":
      return "Images carry no text layer. Convert the scan to PDF and use the OCR card on Document intake (runs in this browser), supply the original spreadsheet, or type the figures onto the schedule line.";
    case ".zip": case ".rar": case ".7z":
      return "Archives are not opened. Extract the files and upload the statements individually.";
    case ".json": case ".xml":
      return "Structured data files have no fixed financial-statement shape the tool can rely on. Export the figures as .csv and re-upload.";
    case ".pdf":
      return "The PDF opened but carries no text layer, which means it is a scan or photograph of a page rather than a digital document. Use the OCR card on Document intake to build a searchable copy in this browser, or supply a text-based PDF or the source spreadsheet.";
    default:
      return `${ext} is not one of the formats the tool reads. Supported: .pdf (with a text layer), .xlsx, .xlsm, .xls, .docx, .csv, .tsv and .txt. Convert the file to one of these and re-upload.`;
  }
}

export type ParsedDoc = {
  kind: "pdf" | "xlsx" | "csv" | "docx";
  /** Plain text grid — the shape every existing consumer understands. */
  grid: string[][];
  /** Positional document, PDFs only. */
  pdf?: PdfDoc;
  /** Workbook sheet names, xlsx only (used by document classification). */
  sheetNames?: string[];
  /** Tabs whose rows are in `grid`, and the tabs deliberately left out. Both
      xlsx only; empty `sheetsSkipped` means everything was read. */
  sheetsUsed?: string[];
  sheetsSkipped?: string[];
};

/** Back-compat: the plain grid, regardless of source. */
export async function readSpreadsheet(file: File): Promise<string[][] | null> {
  const doc = await readDocument(file);
  return doc ? doc.grid : null;
}

/* ---------- stacked-caption forms ---------- */

/* Some official forms do not print a caption and its amount on one line. The
   tax authority draws numbered boxes instead: the box's code sits at the far
   left, its caption on the line above, and the amount right-aligned in the
   box. The row reader needs label and number on the same row, so it sees
   nothing at all on such a form.

   The rescue below rebuilds caption/amount pairs from the geometry, then
   appends them to the grid so the ordinary keyword mapping, translation and
   review path apply unchanged. It is not tied to one country: the layout it
   keys off — code left of caption, amount right-aligned in a column — is what
   makes a boxed form a boxed form.

   Two things on such a row look alike and must not be confused: the box CODE
   and the AMOUNT are both bare digits. They are separated structurally, not by
   shape. Amounts are right-aligned to a column the page repeats down its whole
   length; codes are left-aligned where the box starts. So the page's amount
   columns are measured first, from figures that are unambiguously money
   (they carry a grouping separator), and only cells landing on one of those
   columns can be read as amounts. A figure that is neither is dropped rather
   than guessed at: against a filing, a missing number the preparer supplies
   beats a box code booked as an amount. */

/* Right-hand edges shared by enough money-shaped cells to be a column. */
function valueColumnAnchors(rows: PdfRow[]): number[] {
  const GROUPED = /^\(?-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\)?$/;
  const xs: number[] = [];
  for (const r of rows) for (const c of r.cells) if (GROUPED.test(c.text.trim())) xs.push(c.x1);
  xs.sort((a, b) => a - b);
  const anchors: number[] = [];
  let run: number[] = [];
  const close = () => {
    if (run.length >= 2) anchors.push(run[Math.floor(run.length / 2)]);
    run = [];
  };
  for (const x of xs) {
    if (run.length && x - run[0] > 6) close();
    run.push(x);
  }
  close();
  return anchors;
}

/* The amount, when a box code from the next column has been glued onto it by
   the row builder ("928.368.104 1409"). Only a leading, self-contained figure
   counts — never a digit residue of prose, and never a date. */
function leadingAmount(text: string): string | null {
  const tok = text.trim().split(/\s+/)[0];
  return /^\(?-?\d[\d.,]*\)?$/.test(tok) && numericCell(tok) !== null ? tok : null;
}

/* A box caption is a heading and is printed as one. Long captions wrap, and
   the tail of a wrap lands on a value row looking exactly like a caption of
   its own — "resultado es negativo o cero, deber\u00e1 declarar por Internet)"
   was pairing with a refund figure and mapping, on the word "Internet", to
   telephone expense. Headings open with a capital or a digit; a continuation
   opens mid-sentence. Scripts without case (Chinese, Arabic) are unaffected:
   only a letter that is demonstrably lower-case rejects the caption. */
function isBoxCaption(label: string): boolean {
  const first = label.match(/\p{L}/u)?.[0];
  if (!first) return false;
  return !(first.toLowerCase() === first && first.toUpperCase() !== first);
}

export function stackedCaptionRows(pdf: PdfDoc): string[][] {
  const TEXTUAL = (t: string) => textualCell(t) && t.trim().length > 2;
  const GROUPED = (t: string) => /\d[.,]\d\d\d/.test(t);

  // Captions the row reader can already pair on their own row are its business.
  const alreadyPaired = new Set<string>();
  for (const r of pdf.rows) {
    if (!r.cells.some((c) => numericCell(c.text) !== null)) continue;
    for (const c of r.cells) if (TEXTUAL(c.text)) alreadyPaired.add(c.text.trim());
  }

  const byPage = new Map<number, PdfRow[]>();
  for (const r of pdf.rows) {
    const list = byPage.get(r.page);
    if (list) list.push(r); else byPage.set(r.page, [r]);
  }

  const out: string[][] = [];
  const seen = new Set<string>();
  for (const pageRows of byPage.values()) {
    const anchors = valueColumnAnchors(pageRows);
    if (!anchors.length) continue;
    const onColumn = (x1: number) => anchors.some((a) => Math.abs(a - x1) <= 6);

    const ordered = [...pageRows].sort((a, b) => b.y - a.y);   // top of page first
    for (let i = 1; i < ordered.length; i++) {
      const valRow = ordered[i];
      const capRow = ordered[i - 1];                            // the line directly above
      if (capRow.y - valRow.y > 12) continue;

      const caps = capRow.cells.filter((c) => TEXTUAL(c.text));
      if (!caps.length || capRow.cells.some((c) => numericCell(c.text) !== null)) continue;

      const codes: Array<{ x0: number }> = [];
      const vals: Array<{ x0: number; text: string }> = [];
      /* Where a token sits inside a cell the row builder ran together, by
         character offset. Only ever used to tell one box's span from the
         next, so an approximation is enough. */
      const charX = (c: PdfCell, i: number) =>
        c.x0 + (c.x1 - c.x0) * (i / Math.max(1, c.text.length));
      for (const c of valRow.cells) {
        const text = c.text.trim();
        // "928.368.104 1409" — this box's amount, then the next box's code.
        const glued = /^(\(?-?\d[\d.,]*\)?)\s+(\d{1,4})(?:\s|$)/.exec(text);
        if (glued && numericCell(glued[1]) !== null) {
          vals.push({ x0: c.x0, text: glued[1] });
          codes.push({ x0: charX(c, text.indexOf(glued[2], glued[1].length)) });
          continue;
        }
        // "1109 imputación parcial de créditos…" — this box's code, then the
        // caption above having wrapped down onto the value line.
        const leadCode = /^(\d{1,4})\s+\D/.exec(text);
        if (leadCode) { codes.push({ x0: c.x0 }); continue; }
        const amt = leadingAmount(text);
        if (amt === null) continue;
        if (onColumn(c.x1) || GROUPED(amt)) vals.push({ x0: c.x0, text: amt });
        else if (/^\d{1,4}$/.test(text)) codes.push({ x0: c.x0 });
      }
      codes.sort((a, b) => a.x0 - b.x0);
      vals.sort((a, b) => a.x0 - b.x0);
      // A boxed row opens with its own code, printed left of the caption above.
      if (!codes.length || !vals.length || codes[0].x0 >= caps[0].x0) continue;

      for (let k = 0; k < codes.length; k++) {
        const from = codes[k].x0;
        const to = k + 1 < codes.length ? codes[k + 1].x0 : Infinity;
        const val = vals.find((v) => v.x0 >= from && v.x0 < to);
        const cap = caps.find((c) => c.x0 >= from && c.x0 < to);
        if (!val || !cap) continue;
        const label = cap.text.trim();
        if (!isBoxCaption(label)) continue;
        if (alreadyPaired.has(label) || seen.has(label)) continue;
        seen.add(label);
        out.push([label, val.text]);
      }
    }
  }
  return out;
}

/* SheetJS is loaded from a <script> tag by the build, not imported, because it
   is vendored rather than an npm dependency. */
declare const XLSX: any;

/** Legacy .xls (BIFF8) through the vendored SheetJS.
 *
 * Guarded on XLSX being present rather than assumed: the library is a separate
 * script tag, and a page that loaded without it must refuse the file with the
 * ordinary "could not be read" path instead of throwing a ReferenceError that
 * takes processing down with it. */
function readXls(buf: ArrayBuffer): ParsedDoc | null {
  if (typeof XLSX === "undefined") return null;
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: false });
  const sheetNames: string[] = (wb.SheetNames || []).slice(0, 25);
  if (!sheetNames.length) return null;
  const grid: string[][] = [];
  for (const name of sheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    for (const row of XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })) {
      const cells = ((row as unknown[]) || []).map((v) => (v == null ? "" : String(v).trim()));
      if (cells.some(Boolean)) grid.push(cells);
    }
  }
  return grid.length ? { kind: "xlsx", grid, sheetNames } : null;
}

/** .docx tables and paragraphs.
 *
 * Accountants send entity questionnaires and engagement letters as Word
 * documents, and the particulars are in a two-column table.
 *
 * The cell walk is DEPTH-AWARE, and what that buys is worth being precise
 * about. Word nests tables inside cells. A flat regex for <w:tc> pairs closes
 * the OUTER cell on the inner cell's tag, so "Address" and "inner a" merge
 * into one cell and every column after that shifts by one — the value of each
 * later field lands under the wrong caption, silently. Depth counting turns
 * that into a clean loss instead: the outer cell never closes within the row
 * fragment, so the row is dropped rather than mis-columned.
 *
 * KNOWN LIMITATION, shared with the shipped app and verified against it: the
 * row and table matchers are non-greedy, so an outer row containing a nested
 * table is truncated at the inner </w:tr> and that outer row is lost. Losing a
 * row is visible in the grid; a value under the wrong caption is not, which is
 * why this is the trade being made. */
async function readDocx(buf: ArrayBuffer): Promise<ParsedDoc | null> {
  const doc = (await JSZip.loadAsync(buf)).file("word/document.xml");
  if (!doc) return null;
  const xml: string = await doc.async("string");

  // Word splits a single run of text across many <w:t> elements whenever
  // formatting changes mid-word; joining them is what makes a caption whole.
  const textOf = (fragment: string) =>
    sanitize([...fragment.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("")).trim();

  const cellsOf = (rowXml: string): string[] => {
    const out: string[] = [];
    const tag = /<(\/?)w:tc(?:\s[^>]*)?(\/?)>/g;
    let depth = 0;
    let start = -1;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(rowXml))) {
      if (m[2] === "/") continue;                 // self-closing, not a cell
      if (m[1]) {                                 // closing tag
        if (--depth === 0 && start >= 0) { out.push(textOf(rowXml.slice(start, m.index))); start = -1; }
      } else if (depth++ === 0) {
        start = m.index + m[0].length;
      }
    }
    return out;
  };

  const grid: string[][] = [];
  for (const block of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    const chunk = block[0];
    if (chunk.startsWith("<w:tbl>")) {
      for (const row of chunk.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        const cells = cellsOf(row[0]);
        if (cells.some(Boolean)) grid.push(cells);
      }
    } else {
      const text = textOf(chunk);
      if (text) grid.push([text]);
    }
  }
  return grid.length ? { kind: "docx", grid } : null;
}

export async function readDocument(
  file: File,
  /** Explicit tab list for this document, if the preparer pinned one
      (DocKindOverride.sheets). Overrides the automatic ranking. */
  opts?: { sheets?: string[] },
): Promise<ParsedDoc | null> {
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
    // Stacked pairs are appended, never substituted: the row reader keeps
    // whatever it already finds and these fill in what it cannot see.
    const grid = pdf.rows.map((r) => r.cells.map((c) => c.text));
    return { kind: "pdf", grid: [...grid, ...stackedCaptionRows(pdf)], pdf };
  }
  if (/\.docx$/.test(name)) return readDocx(await file.arrayBuffer());
  if (/\.xls$/.test(name)) return readXls(await file.arrayBuffer());
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
  const allPaths = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
    .slice(0, 25);
  if (!allPaths.length) return null;

  /* Tab name → part path, through the relationship table. The Nth <sheet> in
     workbook.xml is NOT reliably sheetN.xml — that alignment is a convention,
     and acting on it would silently read the wrong tab. If the rels cannot be
     resolved for every named sheet, no selection is made at all: the whole
     workbook is read exactly as before. Narrowing on a guess is worse than
     reading too much. */
  const rels = zip.file("xl/_rels/workbook.xml.rels");
  const relMap = new Map<string, string>();
  if (rels) {
    for (const m of (await rels.async("string")).matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const tgt = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (!id || !tgt) continue;
      const path = tgt.replace(/^\/?(xl\/)?/, "xl/");
      relMap.set(id, path);
    }
  }
  const wbXml = wbFile ? await wbFile.async("string") : "";
  const sheetPaths: { name: string; path: string }[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\sname="([^"]+)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const path = rid ? relMap.get(rid) : undefined;
    if (name && path && zip.file(path)) sheetPaths.push({ name: unesc(name), path });
  }
  const resolvable = sheetNames.length > 0 && sheetPaths.length === sheetNames.length;

  let paths = allPaths;
  let sheetsUsed: string[] | undefined;
  let sheetsSkipped: string[] | undefined;
  if (resolvable) {
    const wanted = opts?.sheets?.length
      ? { read: sheetPaths.filter((sp) => opts.sheets!.includes(sp.name)).map((sp) => sp.name),
          skip: sheetPaths.filter((sp) => !opts.sheets!.includes(sp.name)).map((sp) => sp.name) }
      : rankSheets(sheetPaths.map((sp) => sp.name));
    // A pinned list that matches nothing is a stale pin, not an instruction to
    // read an empty workbook.
    if (wanted.read.length) {
      sheetsUsed = wanted.read;
      sheetsSkipped = wanted.skip;
      paths = sheetPaths.filter((sp) => wanted.read.includes(sp.name)).map((sp) => sp.path).slice(0, 25);
    }
  }

  let sx = "";
  for (const p of paths) sx += await zip.file(p)!.async("string");

  const rows: string[][] = [];
  for (const rm of sx.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    /* The attribute group is LAZY on purpose. Greedy, it swallows the "/" of
       a self-closing cell -- `<c r="A9" s="1"/>` leaves attrs as ` s="1"/`,
       the alternation then takes the ">" branch, and the body runs on to the
       next `</c>`, which belongs to a later cell. Every cell in between is
       lost and its value is reported against the wrong column. A styled but
       empty cell is written exactly that way by any workbook that formats a
       blank grid, so a client questionnaire came through as a column of
       shared-string INDEXES ("35" where "Taxpayer Name:" should have been)
       and was classified as a trial balance with nothing on it. */
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
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
  return { kind: "xlsx", grid: rows, sheetNames, sheetsUsed, sheetsSkipped };
}
