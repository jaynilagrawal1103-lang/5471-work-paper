/* The section-banner lexicon.
 *
 * Its own module, with no imports, because BOTH the readers in engine.ts and
 * the section logic in sections.ts need it, and sections.ts reads the template
 * line table out of engine.ts. Keeping the lexicon at the bottom of the
 * dependency graph is what stops that from being a cycle.
 *
 * Six languages, because these are the statements the analysts actually sent:
 * English, Dutch, French, German, Spanish and Italian.
 */

/* "cash" and "cogs" are narrower than the four sides of the statement: a
   QuickBooks balance sheet groups its bank sub-accounts under "Bank Accounts"
   and names them after the bank, not after what they hold ("Sales", "Property",
   "Merchant Account"), and a P&L groups its bought-in costs under "Cost of
   Sales" and names them after the supplier ("Shopify fees", "Freight"). Both
   groups are unreachable by keyword, and both have exactly one right answer
   for anything printed under them, so the banner carries the answer. */
export type Section = "assets" | "liabilities" | "income" | "costs" | "cash" | "cogs" | "otherIncome" | "termLiabilities" | "fixedAssets" | "equity";

/* Anchored on both ends: a banner is a SHORT line that is nothing but the
   section name. "Total current assets 412,500" is a data row that happens to
   contain "current assets", and must not be read as a banner. */
export const SECTION_BANNERS: [RegExp, Section][] = [
  /* Narrower than "assets", and for the same reason as "cash": everything
     printed under a fixed-assets heading is a non-current asset whatever it is
     called. Xero and MYOB name the accounts after the thing — "Computer
     Equipment", "Office Equipment", "Shopfit" — and none of those words has to
     appear in any keyword list for the banner to place them. Must precede the
     general assets pattern. */
  [/^(?:total\s+)?(?:fixed|non-?current|tangible|capital|long.?term)\s+assets$/i, "fixedAssets"],
  [/^(?:property,?\s+plant\s+(?:and|&)\s+equipment|plant\s+(?:and|&)\s+equipment)$/i, "fixedAssets"],
  [/^(?:total\s+)?(?:current|non-?current|fixed|other(?:\s+current)?|tangible|intangible)?\s*assets$/i, "assets"],
  /* QuickBooks' receivables group heading, between "Bank Accounts" and
     "Other Current Assets". */
  [/^(?:total\s+)?accounts\s+receivable$/i, "assets"],
  /* The same package groups its bank accounts under "Liquid assets",
     "Checking accounts" and "Saving accounts", each printed with its total,
     and names the accounts by IBAN — only the heading says they are cash. */
  [/^(?:liquid\s+assets|liquide\s+middelen|checking\s+accounts?|savings?\s+accounts?)$/i, "cash"],
  [/^(?:cash|bank|liquid)\s+assets$/i, "assets"],
  /* QuickBooks' own group heading. Everything indented under it is a bank or
     card account whatever the account is called, so it is cash. */
  [/^(?:total\s+)?bank\s+accounts?$/i, "cash"],
  /* Xero prints the same group as a bare "Bank", and names the accounts after
     the product or the business ("Cheque Account", "Remote Boss Lifestyle").
     No keyword can reach those; the heading is the only evidence there is. */
  [/^(?:total\s+)?bank$/i, "cash"],
  [/^cash\s+and\s+cash\s+equivalents$/i, "cash"],
  [/^inventor(?:y|ies)$/i, "assets"],
  [/^current\s+tax\s+assets$/i, "assets"],
  [/^(?:vaste\s+activa|vlottende\s+activa)$/i, "assets"],
  /* Narrower than "liabilities", for the same reason "other income" is
     narrower than "income": Schedule F splits current liabilities (line 16)
     from the rest (line 19), and this banner is the statement saying which is
     which. Without it a term loan printed under "Non-Current Liabilities" fell
     to the current-liabilities catch-all. Must precede the general pattern. */
  [/^(?:total\s+)?(?:non-?current|long.?term|term|deferred)\s+liabilit(?:y|ies)$/i, "termLiabilities"],
  /* A Dutch package prints "Short-term liabilities 27.032,10": without it the
     equity banner above ran on, and every creditor was booked to retained
     earnings. */
  [/^(?:total\s+)?(?:current|non-?current|long.?term|short.?term|other)?\s*liabilit(?:y|ies)$/i, "liabilities"],
  [/^(?:current|deferred)\s+tax\s+liabilit(?:y|ies)$/i, "liabilities"],
  [/^provisions?$/i, "liabilities"],
  /* A UK balance sheet (Companies Act format) heads its deferred tax and other
     provisions "Provisions for liabilities", and its equity "Capital and
     reserves". Neither was known, so the equity lines stayed under the sticky
     "Current assets" banner and every one of them was vetoed. */
  [/^provisions\s+for\s+liabilities(?:\s+and\s+charges)?$/i, "liabilities"],
  /* Equity is not a liability, and the difference is a whole Schedule F block.
     Under the old generic "liabilities" section an unrecognised equity caption
     fell to the current-liability catch-all, so partner drawings and current
     year earnings were booked as amounts owed within twelve months. */
  [/^(?:total\s+)?equity$/i, "equity"],
  [/^(?:total\s+)?(?:owners?|members?|partners?|proprietors?)\W?\s*(?:equity|funds|capital)$/i, "equity"],
  [/^issued\s+capital$/i, "equity"],
  [/^capital\s+and\s+reserves$/i, "equity"],
  [/^shareholders?(?:'s|\u2019s|s')?\W?\s*(?:equity|funds)$/i, "equity"],
  [/^eigen\s+vermogen$/i, "equity"],
  // Continental balance sheets name the two sides as capital, not as assets
  // and liabilities: "own capital" against "foreign capital".
  [/^(?:equity|share|own)\s+capital$/i, "equity"],
  [/^(?:foreign|borrowed|outside|third.?party|debt)\s+capital$/i, "liabilities"],
  /* Finnish "pysyvät / vaihtuvat vastaavat", as Google Translate renders it. */
  [/^(?:permanent|fixed)\s+equivalents$/i, "fixedAssets"],
  [/^(?:variable|current)\s+equivalents$/i, "assets"],
  /* OCR of a letter-spaced heading often drops the space
     ("CAPITAUXPROPRES", "ACTIFIMMOBILISE"); the joined form is the same
     heading. */
  [/^capitaux\s*propres$/i, "equity"],
  [/^capitaux\s*(?:é|e)trangers$/i, "liabilities"],
  [/^passif$/i, "liabilities"],
  [/^actif(?:\s*(?:circulant|immobilis(?:é|e)))?$/i, "assets"],
  [/^(?:patrimonio|patrimonio\s+neto)$/i, "equity"],
  /* A Spanish-language balance sheet names its two sides ACTIVO and PASIVO,
     and its equity block CAPITAL — often letter-spaced across the page
     ("A C T I V O"), which is how the package draws a heading. The groups
     beneath them ("CIRCULANTE", "FIJO", "DIFERIDO") are deliberately NOT
     banners: the same three words head both sides, so only the side heading
     above them says which side a row is on. */
  [/^p\s?a\s?s\s?i\s?v\s?o\s?s?$/i, "liabilities"],
  [/^a\s?c\s?t\s?i\s?v\s?o\s?s?$/i, "assets"],
  [/^c\s?a\s?p\s?i\s?t\s?a\s?l$/i, "equity"],
  /* Schedule F splits current from non-current on both sides, and these are
     the statement saying which is which. Without them a long-term creditor
     got the same answer as a short-term one. */
  [/^(?:total\s+)?pasivos?\s+(?:a\s+)?(?:largo\s+plazo|no\s+circulantes?|no\s+corrientes?|fijos?)$/i, "termLiabilities"],
  [/^(?:total\s+)?pasivos?\s+(?:a\s+)?(?:corto\s+plazo|circulantes?|corrientes?)$/i, "liabilities"],
  [/^(?:total\s+)?activos?\s+(?:a\s+)?(?:largo\s+plazo|no\s+circulantes?|no\s+corrientes?|fijos?)$/i, "fixedAssets"],
  [/^(?:total\s+)?activos?\s+(?:a\s+)?(?:corto\s+plazo|circulantes?|corrientes?)$/i, "assets"],
  [/^pasivos?$/i, "liabilities"],
  [/^activos?$/i, "assets"],
  /* "Other income" is narrower than "income", for the same reason "cogs" is
     narrower than "costs": the form has a line for it (9, Other income), and a
     caption printed under this banner is never turnover. Without its own
     section, "Motor Vehicle Contribution" matched the motor-vehicle EXPENSE
     keyword and was deducted instead of earned -- a swing of twice itself. */
  /* QuickBooks also prints it "Other Income(Loss)". */
  [/^(?:total\s+)?other\s+income\s*(?:\(\s*(?:loss|expenses?)\s*\))?$/i, "otherIncome"],
  [/^(gross margin|revenues?|income|turnover|trading income)$/i, "income"],
  [/^(profit\s*(and|&|or)\s*loss(\s+account|\s+statement)?|income statement|statement of (comprehensive income|profit or loss|financial performance)|trading account|winst.?en.?verliesrekening)$/i, "income"],
  /* QuickBooks closes a P&L with an "Other Income" group and an "Other
     Expenses" group. Without the second one, "8150 Exchange gain or loss"
     printed under it was booked as a GAIN of 10.16 rather than a loss. */
  [/^other\s+expenses?$/i, "costs"],
  [/^(operating costs|operating expenses|expenses|costs|overheads|depreciations?|financial result|financial (?:income and )?expenses?|taxes|administrative expenses|selling expenses|personnel costs|employment expenses)$/i, "costs"],
  /* The Nordic statutory layout (Finnish, Swedish), as printed in English or
     machine-translated: "Materials and services" (the cost of the goods and
     bought-in services sold: line 2), "Personnel expenses", "Depreciation
     and impairment", "Other operating expenses". Without them every cost line
     kept the "Turnover" banner and an unplaced cost was routed to gross
     receipts. */
  [/^(?:total\s+)?materials and services$/i, "cogs"],
  [/^(?:total\s+)?(?:personnel expenses|staff expenses|other operating (?:expenses|charges)|depreciations? and (?:impairments?|amortisations?|amortizations?|write-?downs?)(?: losses)?|interest expenses and other financial expenses)$/i, "costs"],
  [/^(?:other interest and financial income|income from other investments(?: in fixed assets)?)$/i, "otherIncome"],
  /* Bought-in cost of the goods sold. Its own section because a caption
     printed here can never be revenue, however it reads — see sectionOk. */
  [/^(?:total\s+)?(?:cost of (?:sales|goods sold)|cogs|cost of revenue|direct costs)$/i, "cogs"],
  /* A Spanish-language P&L: "Estado de Resultados" titles it, and it is
     grouped under Ingresos, Costo de Ventas and Gastos. Without these a
     Panamanian or Mexican P&L carried no section of its own and kept the
     balance sheet's last banner (equity). */
  [/^estado\s+de\s+resultados?(?:\s+integral(?:es)?)?$/i, "income"],
  [/^ingresos(?:\s+(?:operacionales|de\s+operaci[oó]n|ordinarios))?$/i, "income"],
  [/^costos?\s+de\s+(?:las\s+)?ventas?$/i, "cogs"],
  [/^gastos(?:\s+(?:operacionales|de\s+operaci[oó]n|generales(?:\s+y\s+administrativos)?|administrativos|de\s+administraci[oó]n))?$/i, "costs"],
  /* A Colombian (PUC) P&L heads its expenses "GASTOS OPERACIONALES DE
     ADMINISTRACION" / "DE VENTA" and its non-operating blocks "Mas: ING. NO
     OPERACIONALES" / "Menos: GASTOS NO OPERACIONALES". Unknown, the income
     banner above them stayed open and every expense was booked as revenue. */
  [/^(?:menos:?\s*)?gastos\s+(?:operacionales|operativos|de\s+operaci[oó]n)\s+de\s+(?:administraci[oó]n|admon\.?|ventas?)$/i, "costs"],
  [/^(?:menos:?\s*)?gastos\s+(?:de\s+ventas?|no\s+operacionales|no\s+operativos|financieros)$/i, "costs"],
  [/^(?:m[aá]s:?\s*)?(?:ing(?:resos)?\.?|otros\s+ingresos)\s+no\s+operacionales$/i, "otherIncome"],
  [/^(?:m[aá]s:?\s*)?otros\s+ingresos$/i, "otherIncome"],
  [/^(?:menos:?\s*)?costos?\s+de\s+(?:actividades|producci[oó]n|operaci[oó]n|prestaci[oó]n\s+de\s+servicios)$/i, "cogs"],
];

/* Statement titles that END whatever section was active and open none of
   their own: the cash-flow statement and the notes restate the other
   statements, so nothing printed under them may inherit the balance sheet's
   or the P&L's banner. Matched on a row with no figures, from the start of
   the caption ("Estado de Flujo de Efectivo por el año terminado ..."). */
export const SECTION_RESETS: RegExp[] = [
  /^estados?\s+de\s+flujos?\s+de\s+efectivo\b/i,
  /^(?:statement\s+of\s+)?cash\s*flows?(?:\s+statement)?\b/i,
  /^notas?(?:\s+a\s+los\s+estados\s+financieros)?\b/i,
  /^notes?\s+to\s+(?:the\s+)?(?:financial\s+statements|accounts)\b/i,
];

/* A UK balance sheet prints its creditors as a line that carries a figure,
   not as a heading: "Creditors: amounts falling due within one year (204,497)"
   sits inside the net-current-assets block, under the "Current assets"
   banner. The caption itself says which side and which term it is, so it
   sets the section for itself and for the rows that follow it. Kept apart
   from SECTION_BANNERS because it is data, not a heading. */
export const SELF_SECTION_ROWS: [RegExp, Section][] = [
  [/^creditors\b.*\bfalling\s+due\s+within\s+one\s+year$/i, "liabilities"],
  [/^creditors\b.*\bfalling\s+due\s+after\s+(?:more\s+than\s+)?one\s+year$/i, "termLiabilities"],
];

/* A statement title never carries a figure. On a UK balance sheet the
   retained-earnings reserve is called "Profit and loss account", which is
   also the P&L's title; read as a banner it re-tagged the reserve as income
   and moved it to the P&L. With a figure on the line it is the reserve. */
export const TITLE_NOT_BANNER_WITH_FIGURES = /^profit\s*(?:and|&)\s*loss\s+account$/i;

/* ---------- OCR words run together ----------

   PaddleOCR drops the spaces in a bold capital heading: a Panamanian balance
   sheet read as "ACTIVOSCORRIENTES", "TOTAL DEACTIVOS", "PASIVOSNO
   CORRIENTES" and "GANANCIAO (PERDIDA)ANTES DEIMPUESTOS". None of those is
   a banner, a total or a result line to a pattern that expects the spaces,
   so the balance sheet's sections never changed and its totals were booked.
   A run-together word is split back into the statement words it is made of,
   for MATCHING only; the caption as read is what is stored and shown. A word
   is split only when every piece is a known statement word, and "no" / "mas"
   only in the pairings a statement prints ("no corrientes", "mas
   patrimonio"). */
const GLUE_WORDS = new Set([
  "total", "totales", "de", "del", "y", "o", "no", "mas", "por",
  "activo", "activos", "pasivo", "pasivos", "patrimonio", "capital", "social",
  "corriente", "corrientes", "circulante", "circulantes", "fijo", "fijos",
  "ingresos", "ingreso", "costo", "costos", "venta", "ventas", "gasto", "gastos", "generales", "administrativos",
  "ganancia", "ganancias", "perdida", "perdidas", "utilidad", "utilidades", "resultado", "resultados",
  "bruta", "bruto", "operativa", "operativo", "operacional", "neta", "neto", "antes", "impuesto", "impuestos",
  "periodo", "ejercicio", "cuentas", "pagar", "cobrar", "accionistas", "efectivo", "caja", "equivalentes",
  "largo", "corto", "plazo", "otros", "otras", "estado", "estados", "flujo", "balance", "general",
]);
const GLUE_AFTER: Record<string, Set<string>> = {
  no: new Set(["corriente", "corrientes", "circulante", "circulantes"]),
  mas: new Set(["patrimonio", "capital"]),
};
const fold = (w: string) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function splitGlued(word: string, next: string): string {
  const low = fold(word);
  if (low.length !== word.length || low.length < 5 || GLUE_WORDS.has(low)) return word;
  const n = low.length;
  const best: (string[] | null)[] = new Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 0; i < n; i++) {
    if (!best[i]) continue;
    for (let j = i + 1; j <= n; j++) {
      const piece = low.slice(i, j);
      if (!GLUE_WORDS.has(piece)) continue;
      const prev = best[i]![best[i]!.length - 1];
      if (prev && GLUE_AFTER[prev] && !GLUE_AFTER[prev].has(piece)) continue;
      if (!best[j] || best[j]!.length > best[i]!.length + 1) best[j] = [...best[i]!, piece];
    }
  }
  const parts = best[n];
  if (!parts || parts.length < 2) return word;
  const last = parts[parts.length - 1];
  if (GLUE_AFTER[last] && !GLUE_AFTER[last].has(fold(next))) return word;
  let at = 0;
  return parts.map((p) => { const w = word.slice(at, at + p.length); at += p.length; return w; }).join(" ");
}

/** The caption with OCR-glued statement words split apart. */
export function deglue(label: string): string {
  const s = String(label || "");
  if (!/\p{L}{5,}/u.test(s)) return s;
  const spaced = s.replace(/\)(?=\p{L})/gu, ") ").replace(/(\p{L})\(/gu, "$1 (");
  return spaced.replace(/\p{L}+/gu, (w, at: number) => splitGlued(w, (/^\P{L}*(\p{L}+)/u.exec(spaced.slice(at + w.length)) || ["", ""])[1]));
}

/** A heading as the lexicon compares it: a spreadsheet prints its group
    headings with a trailing colon ("Revenues:", "Current liabilities:"), and
    the colon says nothing about which section it is. */
export const bannerKey = (label: string) => deglue(String(label || "").trim()).replace(/\s*:\s*$/, "");

/** Does this caption, standing alone, announce a section? Used by the readers
    to keep a value-less row that would otherwise be discarded. */
export const isBannerLabel = (label: string) => SECTION_BANNERS.some(([re]) => re.test(bannerKey(label)));

/** A cash GROUP heading: printed with its total, it still opens the group of
    accounts beneath it (unlike "Cash and cash equivalents 65,029", which is
    the cash line itself). */
export const CASH_GROUP = /^(?:total\s+)?(?:liquid\s+assets|liquide\s+middelen|checking\s+accounts?|savings?\s+accounts?|bank\s+accounts?)$/i;
