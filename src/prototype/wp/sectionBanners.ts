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
  [/^(?:total\s+)?(?:fixed|non-?current|tangible|capital)\s+assets$/i, "fixedAssets"],
  [/^(?:property,?\s+plant\s+(?:and|&)\s+equipment|plant\s+(?:and|&)\s+equipment)$/i, "fixedAssets"],
  [/^(?:total\s+)?(?:current|non-?current|fixed|other|tangible|intangible)?\s*assets$/i, "assets"],
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
  [/^(?:total\s+)?(?:current|non-?current|long.?term|other)?\s*liabilit(?:y|ies)$/i, "liabilities"],
  [/^(?:current|deferred)\s+tax\s+liabilit(?:y|ies)$/i, "liabilities"],
  [/^provisions?$/i, "liabilities"],
  /* Equity is not a liability, and the difference is a whole Schedule F block.
     Under the old generic "liabilities" section an unrecognised equity caption
     fell to the current-liability catch-all, so partner drawings and current
     year earnings were booked as amounts owed within twelve months. */
  [/^(?:total\s+)?equity$/i, "equity"],
  [/^(?:total\s+)?(?:owners?|members?|partners?|proprietors?)\W?\s*(?:equity|funds|capital)$/i, "equity"],
  [/^issued\s+capital$/i, "equity"],
  [/^shareholders?\W?\s*(?:equity|funds)$/i, "equity"],
  [/^eigen\s+vermogen$/i, "equity"],
  // Continental balance sheets name the two sides as capital, not as assets
  // and liabilities: "own capital" against "foreign capital".
  [/^(?:equity|share|own)\s+capital$/i, "equity"],
  [/^(?:foreign|borrowed|outside|third.?party)\s+capital$/i, "liabilities"],
  [/^capitaux\s+propres$/i, "equity"],
  [/^capitaux\s+(?:é|e)trangers$/i, "liabilities"],
  [/^passif$/i, "liabilities"],
  [/^actif(?:\s+(?:circulant|immobilis(?:é|e)))?$/i, "assets"],
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
  [/^(?:total\s+)?pasivos?\s+(?:a\s+)?(?:largo\s+plazo|no\s+circulante|no\s+corriente|fijo)$/i, "termLiabilities"],
  [/^(?:total\s+)?pasivos?\s+(?:a\s+)?(?:corto\s+plazo|circulante|corriente)$/i, "liabilities"],
  [/^(?:total\s+)?activos?\s+(?:a\s+)?(?:largo\s+plazo|no\s+circulante|no\s+corriente|fijo)$/i, "fixedAssets"],
  [/^(?:total\s+)?activos?\s+(?:a\s+)?(?:corto\s+plazo|circulante|corriente)$/i, "assets"],
  [/^pasivos?$/i, "liabilities"],
  [/^activos?$/i, "assets"],
  /* "Other income" is narrower than "income", for the same reason "cogs" is
     narrower than "costs": the form has a line for it (9, Other income), and a
     caption printed under this banner is never turnover. Without its own
     section, "Motor Vehicle Contribution" matched the motor-vehicle EXPENSE
     keyword and was deducted instead of earned -- a swing of twice itself. */
  [/^(?:total\s+)?other\s+income$/i, "otherIncome"],
  [/^(gross margin|revenue|income|turnover|trading income)$/i, "income"],
  [/^(profit\s*(and|&|or)\s*loss(\s+account|\s+statement)?|income statement|statement of (comprehensive income|profit or loss|financial performance)|trading account|winst.?en.?verliesrekening)$/i, "income"],
  /* QuickBooks closes a P&L with an "Other Income" group and an "Other
     Expenses" group. Without the second one, "8150 Exchange gain or loss"
     printed under it was booked as a GAIN of 10.16 rather than a loss. */
  [/^other\s+expenses?$/i, "costs"],
  [/^(operating costs|operating expenses|expenses|costs|overheads|depreciations?|financial result|financial (?:income and )?expenses?|taxes|administrative expenses|selling expenses|personnel costs|employment expenses)$/i, "costs"],
  /* Bought-in cost of the goods sold. Its own section because a caption
     printed here can never be revenue, however it reads — see sectionOk. */
  [/^(?:total\s+)?(?:cost of (?:sales|goods sold)|cogs|cost of revenue|direct costs)$/i, "cogs"],
];

/** Does this caption, standing alone, announce a section? Used by the readers
    to keep a value-less row that would otherwise be discarded. */
export const isBannerLabel = (label: string) => SECTION_BANNERS.some(([re]) => re.test(label));

