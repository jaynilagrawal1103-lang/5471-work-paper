/* Round 22 — five client cases from one ZIP (Chilean, Spanish, Colombian,
 * Finnish statements). Each check pins a general rule, not a client: the
 * captions and shapes are the documents' kind, the amounts are invented unless
 * noted.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
    alias: {
      "pdfjs-dist/build/pdf.worker.mjs": path.join(ROOT, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
      "pdfjs-dist": path.join(ROOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs"),
    },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const ENG = load("src/prototype/wp/engine.ts");
const SEC = load("src/prototype/wp/sections.ts");
const BAN = load("src/prototype/wp/sectionBanners.ts");
const CLS = load("src/prototype/wp/classify.ts");
const CF = load("src/prototype/wp/carryForward.ts");
const PDF = load("src/prototype/wp/pdfText.ts");
const STORE_SRC = fs.readFileSync(path.join(ROOT, "src", "prototype", "wp", "store.ts"), "utf8");
const DIST = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/** A top-level function of the shipped page, by name, with its body. */
function distFn(name) {
  const i = DIST.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `dist has ${name}`);
  let d = 0, k = DIST.indexOf("{", i);
  for (; k < DIST.length; k++) { if (DIST[k] === "{") d++; else if (DIST[k] === "}" && --d === 0) break; }
  return DIST.slice(i, k + 1);
}
const cell = (text, x0, x1) => ({ text, x0, x1: x1 ?? x0 + text.length * 4 });

/* ---------- reading a machine-translated statement ---------- */

/* Google Translate re-sets each caption in its own font: the amounts sit
   about two-thirds of a line ABOVE the caption they belong to. */
const floating = () => ({
  rows: [
    { page: 1, y: 669.6, cells: [cell("Tangible assets", 47)] },
    { page: 1, y: 658.1, cells: [cell("970,46", 324), cell("-242,61", 426), cell("727,85", 533)] },
    { page: 1, y: 653.6, cells: [cell("Machinery and equipment", 66)] },
    { page: 1, y: 642.1, cells: [cell("226 548,63", 308), cell("277 271,15", 413), cell("503 819,78", 517)] },
    { page: 1, y: 637.6, cells: [cell("1381, Unfinished construction project", 75)] },
  ],
  heights: [6.5, 6.5, 5.3, 6.5, 5.8],
});

t("amounts printed just above their caption are joined to it (src)", () => {
  const { rows, heights } = floating();
  PDF.attachFloatingFigures(rows, heights, 0);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows[1].cells.map((c) => c.text), ["Machinery and equipment", "970,46", "-242,61", "727,85"]);
  assert.deepStrictEqual(rows[2].cells.map((c) => c.text), ["1381, Unfinished construction project", "226 548,63", "277 271,15", "503 819,78"]);
});

t("a figures row a full line away, or a superscript, is left alone (src)", () => {
  const rows = [
    { page: 1, y: 700, cells: [cell("Revenue", 40)] },
    { page: 1, y: 688, cells: [cell("1,250.00", 400)] },          // 12pt away: a row of its own
    { page: 1, y: 676, cells: [cell("Cost of sales", 40)] },
    { page: 1, y: 664, cells: [cell("12", 120)] },                // a note number, small text
    { page: 1, y: 661, cells: [cell("Wages", 40)] },
  ];
  PDF.attachFloatingFigures(rows, [10, 10, 10, 5, 10], 0);
  assert.strictEqual(rows.length, 5);
});

t("the shipped reader joins floating figures the same way", () => {
  const f = new Function(distFn("EN9attachFloat") + ";return EN9attachFloat;")();
  const { rows, heights } = floating();
  f(rows, heights, 0);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[1].cells.length, 4);
  assert.ok(DIST.includes("EN9attachFloat(s,EN9hts,EN9first)"), "called after each page is read");
});

t("a figure that ends in its cents is complete: the next digits start a new column", () => {
  assert.strictEqual(PDF.CENTS_THEN_DIGIT("145 455,70", "687"), true);
  assert.strictEqual(PDF.CENTS_THEN_DIGIT("226", "548,63"), false);       // still building "226 548,63"
  assert.strictEqual(PDF.CENTS_THEN_DIGIT("Rate 0.924000", "1"), false);
  assert.ok(DIST.includes("/*EN9CENTSDIGIT*/"));
});

/* ---------- columns headed by a period range or a dated balance ---------- */

t("a year-to-date range heads the year's column; the single months are not years", () => {
  assert.strictEqual(ENG.periodSpanYear("1/2024 - 12/2024"), 2024);
  assert.strictEqual(ENG.periodSpanYear("01.01.2024 – 31.12.2024"), 2024);
  assert.strictEqual(ENG.periodSpanYear("Jan 2024 - Dec 2024"), 2024);
  assert.strictEqual(ENG.periodSpanYear("12/2024"), null);
  const doc = { pageCount: 1, rows: [
    { page: 1, y: 490, cells: [cell("12/2024", 390, 414), cell("12/2023", 519, 543), cell("1/2024 - 12/2024", 616, 661), cell("1/2023 - 12/2023", 744, 789)] },
  ] };
  const r = ENG.detectRulers(doc);
  assert.strictEqual(r.length, 1);
  assert.deepStrictEqual(r[0].cols.map((c) => c.year), [2024, 2023]);
  assert.strictEqual(r[0].cols[0].x1, 661);
});

t("an opening balance on 1 January is the prior year's closing column", () => {
  assert.deepStrictEqual(ENG.balanceDateYear("Opening balance 01.01.2024"), { year: 2023, at: 0 });
  assert.strictEqual(ENG.balanceDateYear("Balance change Closing balance 31.12.2024").year, 2024);
  const doc = { pageCount: 1, rows: [
    { page: 1, y: 727, cells: [cell("Opening balance 01.01.2024", 267, 349), cell("Balance change Closing balance 31.12.2024", 395, 531)] },
  ] };
  const r = ENG.detectRulers(doc);
  assert.deepStrictEqual(r[0].cols.map((c) => c.year), [2023, 2024]);
  assert.ok(r[0].cols[1].x0 > 395, "the closing column starts at its own words");
});

t("the shipped header readers agree with src", () => {
  const a = DIST.indexOf("/*EN9SPANHDR-BEGIN*/"), b = DIST.indexOf("/*EN9SPANHDR-END*/");
  const f = new Function(DIST.slice(a, b) + ";return {EN9spanYear,EN9balDateYear};")();
  for (const s of ["1/2024 - 12/2024", "12/2024", "Jan 2024 - Dec 2024"]) assert.strictEqual(f.EN9spanYear(s), ENG.periodSpanYear(s), s);
  for (const s of ["Opening balance 01.01.2024", "Closing balance 31.12.2024"]) assert.deepStrictEqual(f.EN9balDateYear(s), ENG.balanceDateYear(s), s);
});

/* ---------- identifying the statements ---------- */

const money = (label, v, page, y) => ({ page, y, cells: [cell(label, 40), cell(v, 400)] });

t("a balance sheet split over two pages is identified by its two sides together", () => {
  const doc = { pageCount: 2, rows: [
    { page: 1, y: 760, cells: [cell("Accounting report type", 40), cell("Level", 380)] },
    { page: 1, y: 740, cells: [cell("Current assets", 40)] },
    money("Loan receivables", "1 000,00", 1, 720), money("Other receivables", "2 000,00", 1, 700),
    money("Prepaid expenses", "3 000,00", 1, 680), money("Cash and bank balances", "4 000,00", 1, 660),
    { page: 2, y: 760, cells: [cell("Equity", 40)] },
    money("Profit from previous periods", "5 000,00", 2, 740), money("Result for the year", "1 000,00", 2, 720),
    { page: 2, y: 700, cells: [cell("Current liabilities", 40)] },
    money("Accounts payable", "2 000,00", 2, 680), money("Accrued expenses", "2 000,00", 2, 660),
  ] };
  const kinds = CLS.classifyPages(doc).map((p) => p.kind);
  assert.deepStrictEqual(kinds, ["fs-balance-sheet", "fs-balance-sheet"]);
});

t("a title given as a header field's value names the page; its continuation pages follow", () => {
  const hdr = (page) => ({ page, y: 490, cells: [cell("12/2024", 390), cell("12/2023", 519), cell("1/2024 - 12/2024", 616), cell("1/2023 - 12/2023", 744)] });
  const doc = { pageCount: 2, rows: [
    { page: 1, y: 520, cells: [cell("Business ID", 38), cell("3179533-6", 346), cell("Accounting report type", 500), cell("Income statement", 654)] },
    hdr(1),
    money("3000, Sales", "826 393,96", 1, 460), money("4210, Purchases", "-2 469,54", 1, 440),
    money("5000, Salaries", "-27 482,52", 1, 420), money("6100, Pensions", "-20 176,06", 1, 400),
    hdr(2),
    money("7500, Vehicle leasing", "-47 915,84", 2, 460), money("7800, Travel", "-12 330,98", 2, 440),
    money("8500, Telephone", "-1 206,45", 2, 420), money("8620, Office supplies", "-81,84", 2, 400),
  ] };
  const kinds = CLS.classifyPages(doc).map((p) => p.kind);
  assert.deepStrictEqual(kinds, ["fs-pnl", "fs-pnl"]);
});

t("the shipped classifier carries the same two passes", () => {
  assert.ok(DIST.includes("/*EN9PASS5-BEGIN*/") && DIST.includes("function EN9colHdrSig("));
  assert.ok(DIST.includes("/*EN9TITLECELL*/"));
  assert.ok(DIST.includes("/*EN9LEDGERYEAR*/"));
  assert.ok(DIST.includes("/*EN9COLABEL*/"));
});

/* ---------- the statement's own structure ---------- */

const R = (label, values, x0, extra = {}) => ({ row: { label, values, page: extra.page ?? 1, ...(extra.isBanner ? { isBanner: true } : {}) }, x0, docId: "d", feed: extra.feed ?? "is", ...(extra.section ? { section: extra.section } : {}) });

t("indents a hair apart are one indent: the group still adds up", () => {
  const rows = [
    R("Turnover", [826403.95], 38.6),
    R("General sales accounts", [826393.96], 56.0),
    R("3000, Sales", [826393.96], 65.3),
    R("Sales, securities and real estate", [9.99], 56.6),
    R("3470, Dividend income", [9.99], 65.3),
  ];
  const out = SEC.structRows(rows);
  assert.ok(/summary of the 2 row/.test(out[0].skipReason || ""), out[0].skipReason);
  assert.ok(!out[2].skipReason && !out[4].skipReason, "the accounts are kept");
});

t("a group whose closing column is nil proves itself by its other columns", () => {
  const rows = [
    R("Profit (loss) for the period", [281466.94, 0], 47, { feed: "bs" }),
    R("2370, Result for the financial period", [281466.94, 0], 56, { feed: "bs" }),
    R("Result for the financial year", [0, 491628.16], 47, { feed: "bs" }),
  ];
  const out = SEC.structRows(rows);
  assert.ok(/summary of the 1 row/.test(out[0].skipReason || ""), String(out[0].skipReason));
  assert.ok(!out[1].skipReason && !out[2].skipReason);
});

t("a heading of another section ends a group however deep it is printed", () => {
  const rows = SEC.tagSections([
    R("Turnover", [100], 38),
    R("3000, Sales", [100], 56),
    R("Materials and services", [], 47, { isBanner: true }),
    R("4210, Purchases", [-40], 65),
  ]);
  const out = SEC.structRows(rows);
  assert.ok(/summary of the 1 row/.test(out[0].skipReason || ""), String(out[0].skipReason));
  assert.strictEqual(rows[2].section, "cogs", "Materials and services is the Nordic cost of sales");
});

t("an account no rule knows takes the line of the proven heading it adds up to", () => {
  const rows = SEC.structRows(SEC.tagSections([
    R("Other operating expenses", [-1500], 47),
    R("Vehicle expenses", [-1000], 56),
    R("7500, Vehicle leasing", [-1000], 65),
    R("Travel expenses", [-500], 56),
    R("7800, Travel tickets", [-500], 65),
  ]));
  SEC.tagStatementGroups(rows);
  assert.deepStrictEqual(rows[2].summaryGroups, ["Vehicle expenses", "Other operating expenses"]);
  assert.ok(STORE_SRC.includes("function summaryHeadTarget(m: MapRow)"));
  assert.ok(/const sum = byBanner === null \|\| byBanner === SECTION_FALLBACK\[m\.section\] \? summaryHeadTarget\(m\) : null;/.test(STORE_SRC),
    "a proven heading outranks the banner's catch-all, never a specific banner route");
});

t("a heading that reads like a banner but carries its own proven figure is a group", () => {
  const rows = SEC.structRows([
    R("Other current assets", [1848.16], 65, { feed: "bs" }),
    R("1543, Securities", [1848.16], 74, { feed: "bs" }),
  ]);
  SEC.tagStatementGroups(rows);
  assert.deepStrictEqual(rows[1].summaryGroups, ["Other current assets"]);
});

t("a statement that runs onto the next page keeps its section; a closed one does not", () => {
  const rows = SEC.markContinuedPages([
    R("6100, Pensions", [-20], 65, { page: 1 }),
    R("7990, Other entertainment", [-10], 65, { page: 2 }),
    R("Profit for the period", [500], 38, { page: 2 }),
    R("Cash", [50], 40, { page: 3 }),
  ]);
  assert.strictEqual(rows[1].continuesSection, true);
  assert.ok(!rows[3].continuesSection, "a page after the result line starts afresh");
});

t("the shipped structure helpers behave like src", () => {
  const snap = new Function(distFn("EN9snapIndents") + ";return EN9snapIndents;")();
  const rows = [{ x0: 56.0, docId: "d" }, { x0: 56.6, docId: "d" }, { x0: 65.3, docId: "d" }];
  snap(rows);
  assert.deepStrictEqual(rows.map((r) => r.x0), [56.0, 56.0, 65.3]);
  const same = new Function(distFn("EN9same") + ";return EN9same;")();
  const every = new Function("EN9same", distFn("EN9everyCol") + ";return EN9everyCol;")(same);
  assert.strictEqual(every({ row: { values: [5, 0] } }, [{ row: { values: [2, 0] } }, { row: { values: [3, 0] } }]), true);
  assert.strictEqual(every({ row: { values: [0, 0] } }, [{ row: { values: [0, 0] } }]), false, "nil everywhere proves nothing");
  assert.ok(DIST.includes("/*EN9BANNERBREAK*/") && DIST.includes("/*EN9SUMSECT*/") && DIST.includes("/*EN9SUMCHAIN*/"));
  assert.ok(DIST.includes("/*EN9CONTPAGE*/") && DIST.includes("/*EN9SUMHEADFN*/"));
});

/* ---------- placing and signing what was read ---------- */

t("a loan from a bank is borrowing, not a shareholder's money", () => {
  assert.strictEqual(SEC.sectionRoute("liabilities", "Loans from financial institutions"), "BS:OCL");
  assert.strictEqual(SEC.sectionRoute("liabilities", "2830, Short-term financial institution loan"), "BS:OCL");
  assert.strictEqual(SEC.sectionRoute("liabilities", "Shareholder loan"), "BS:52");
  assert.ok(DIST.includes("/*EN9BANKLOAN*/"));
});

t("the Nordic result lines are the year's result", () => {
  for (const l of ["Profit (loss) for the period", "Profit / loss for the financial year", "Result for the financial year"]) assert.ok(SEC.isProfitLine(l), l);
  assert.ok(!SEC.isProfitLine("Profit before appropriations and taxes"));
  assert.strictEqual(ENG.matchRuleScoped("Profit before appropriations and taxes", ENG.DEFAULT_RULES, "IS"), "SKIP");
});

t("catalogue v19 places the Nordic captions", () => {
  const m = (l, s) => ENG.matchRuleScoped(l, ENG.DEFAULT_RULES, s);
  assert.strictEqual(m("Income taxes", "IS"), "IS:62");
  assert.strictEqual(m("Other receivables", "BS"), "BS:OCA");
  assert.strictEqual(m("1763, Value added tax receivables", "BS"), "BS:OCA");
  assert.strictEqual(m("1750, Annual repayments on loans granted", "BS"), "BS:OCA");
  assert.strictEqual(m("Long-term receivables", "BS"), "BS:39");
  assert.strictEqual(m("1381, Unfinished construction project", "BS"), "BS:39");
  assert.strictEqual(m("9610, Collection costs", "IS"), "IS:OD");
  assert.ok(/RULE_CATALOGUE_VERSION = 19/.test(STORE_SRC) && DIST.includes("EN9RULEVER=19"));
});

t("the Nordic banners are known, and each side keeps its meaning", () => {
  const sec = (l) => BAN.SECTION_BANNERS.filter(([re]) => re.test(BAN.bannerKey(l))).map((x) => x[1]);
  assert.deepStrictEqual(sec("Materials and services"), ["cogs"]);
  assert.ok(sec("Personnel expenses").includes("costs"));
  assert.ok(sec("Interest expenses and other financial expenses").includes("costs"));
  assert.ok(sec("Other interest and financial income").includes("otherIncome"));
  assert.ok(sec("Debt capital").includes("liabilities"));
  assert.ok(sec("Permanent equivalents").includes("fixedAssets"));
});

t("on a statement that prints costs negative, a positive cost is a credit", () => {
  assert.ok(SEC.deductionMagnitudeFlip("IS:11", "cogs", true, -2469.54), "cost of goods sold flips like the deductions");
  assert.ok(STORE_SRC.includes("id: `deduction-credit-${target}-${norm(m.row.label)}`"));
  assert.ok(DIST.includes("/*EN9DEDCREDIT*/"));
  assert.strictEqual((DIST.match(/\/\*EN9DEDMAG\*\//g) || []).length, 1, "the magnitude flip runs once, so the credit is never undone");
});

/* ---------- the prior-year return ---------- */

t("a prior return whose closing column is blank carries nothing into the opening column", () => {
  const rows = [
    { page: 51, cells: [cell("(a) Beginning of annual accounting period", 400, 470), cell("(b) End of annual accounting period", 500, 570)] },
    { page: 51, cells: [cell("1 Cash", 40), cell("1", 372), cell("3,874.", 430, 470)] },
    { page: 51, cells: [cell("13 Other assets (attach statement)", 40), cell("13", 372), cell("360,525.", 422, 470)] },
  ];
  const heads = { a: 435, b: 535 };
  assert.strictEqual(CF.matchFormLineAtColumn(rows, /^cash$/i, null, 45, heads), null);
  assert.strictEqual(CF.matchFormLineAtColumn(rows, /^cash$/i, null).value, 3874, "with no headings to judge by, the rightmost value is still the fallback");
  const filled = [{ page: 51, cells: [cell("1 Cash", 40), cell("1", 372), cell("3,874.", 430, 470), cell("75,207.", 525, 570)] }];
  assert.strictEqual(CF.matchFormLineAtColumn(filled, /^cash$/i, null, 45, heads).value, 75207);
  assert.ok(DIST.includes("/*EN9COLHEADS*/") && DIST.includes("EN9colHeads(EN9fgeo)"));
});

t("the Schedule M receivable note uses the closing balance when it was read", () => {
  assert.ok(STORE_SRC.includes("opened the year at ${rpBoy.toLocaleString()} and closed it at ${rpEoy.toLocaleString()}"));
  assert.ok(!STORE_SRC.includes("(missing 2024 balance sheet)"), "no hard-coded year");
  assert.ok(DIST.includes("/*EN9SCHMAR*/") && !DIST.includes("(missing 2024 balance sheet)"));
});

t("a negative line-17 account keeps its sign only when the stated result proves it", () => {
  assert.ok(STORE_SRC.includes("if (!(asPrinted !== null && resigned !== null && asPrinted + 0.005 < resigned)) fixed.push(k);"));
  const fn = STORE_SRC.slice(STORE_SRC.indexOf("function negativeDeductionTotals"), STORE_SRC.indexOf("function negativeDeductionTotals") + 600);
  assert.ok(!/POOLS\["IS:OD"\]/.test(fn), "the pool is no longer skipped wholesale");
  assert.ok(DIST.includes("/*EN9ODCREDIT*/(function(){var pool=") && DIST.includes("if(!(asPr!==null&&re!==null&&asPr+.005<re))fx.push(k)"));
});

/* ---------- the earlier clients of this round ---------- */

t("other investments have a pool of rows, and sit on the assets side", () => {
  assert.deepStrictEqual(ENG.POOLS["BS:OI"].rows, [25, 26, 27]);
  assert.strictEqual(SEC.sectionOk("assets", "BS:OI"), true);
  assert.strictEqual(SEC.sectionOk("liabilities", "BS:OI"), false);
});

t("a participation account under liabilities is a long-term obligation", () => {
  assert.strictEqual(SEC.sectionRoute("liabilities", "Cta. Particip. Socio"), "BS:OL");
});

t("a bank named only by its bank under the assets banner is cash", () => {
  assert.strictEqual(SEC.sectionRoute("assets", "Banco Santander"), "BS:10");
  assert.notStrictEqual(SEC.sectionRoute("assets", "Bank loan"), "BS:10", "a loan is never cash");
});

t("catalogue v18 (Chilean captions) is in place", () => {
  const m = (l, s) => ENG.matchRuleScoped(l, ENG.DEFAULT_RULES, s);
  assert.strictEqual(m("Bienes raíces", "BS"), "BS:28");
  assert.strictEqual(m("Cta. participación", "BS"), "BS:OI");
  assert.strictEqual(m("Corrección monetaria", "IS"), "IS:20");
  assert.strictEqual(m("Impuesto 1era categoría", "IS"), "IS:32");
  assert.strictEqual(m("Accum. Dep. - Vehicles", "BS"), "BS:29");
  assert.strictEqual(m("Talent fees", "IS"), "IS:10");
});

t("a total that closes the cash group hands the section back to assets", () => {
  const rows = SEC.tagSections([
    R("Cash and cash equivalents", [], 40, { isBanner: true, feed: "bs" }),
    R("Bank A", [10], 50, { feed: "bs" }),
    R("Total", [10], 40, { feed: "bs" }),
    R("Trade receivables", [20], 50, { feed: "bs" }),
  ]);
  assert.strictEqual(rows[1].section, "cash");
  assert.notStrictEqual(rows[3].section, "cash", "the receivable is no longer under cash");
});

/* ---------- UK abridged accounts (Gallium Ventures) ---------- */

t("an abridged face P&L gives way to the detailed account that prints turnover", () => {
  assert.ok(SEC.TRADING_PNL_TITLE.test("Abridged Trading Profit and Loss Account"));
  assert.ok(!SEC.TRADING_PNL_TITLE.test("Abridged Profit and Loss Account"), "the face statement is not the detail");
  assert.ok(SEC.NOT_STATUTORY.test("The following pages do not form part of the statutory accounts:"));
  const P = (label, values, page, years, extra = {}) => ({ row: { label, values, page, years, ...(extra.isBanner ? { isBanner: true } : {}) }, x0: 40, docId: "d", feed: "is", ...(extra.section ? { section: extra.section } : {}) });
  const rows = [
    P("Administrative expenses", [-566607, -490610], 6, [2024, 2023], { section: "costs" }),
    P("Other interest receivable", [8292, 4993], 6, [2024, 2023]),
    P("Tax on Profit", [-75675, -55718], 6, [2024, 2023]),
    P("GROSS PROFIT", [857642, 726437], 6, [2024, 2023]),
    P("Sales", [882881, 732000], 10, [2024, 2023], { section: "income" }),
    P("Administrative Expenses", [], 10, undefined, { isBanner: true }),
    P("Wages and salaries", [552607, 482360], 10, [2024, 2023]),
    P("Bad debts written off", [8250], 10, [2023]),
    P("Sundry expenses", [14000], 10, [2024]),
    P("OPERATING PROFIT", [291035, 235827], 10, [2024, 2023]),
    P("GROSS PROFIT", [857642, 726437], 10, [2024, 2023]),
    P("Bank interest receivable", [8292, 4993], 11, [2024, 2023]),
    P("Corporation tax charge", [75675, 55718], 11, [2024, 2023]),
  ];
  const r = SEC.supplementaryDetailPages(rows, new Set([10, 11]));
  assert.strictEqual(r.abridged, true);
  assert.strictEqual(r.dropped, 4, "admin expenses (by year, despite the dashes), interest, tax and gross profit restated");
  assert.ok(r.rows.filter((m) => m.row.page >= 10).every((m) => !m.skipReason), "the detail is kept");
  assert.ok(DIST.includes("/*EN9ABRIDGED*/") && DIST.includes("EN9TRADINGTITLE") && DIST.includes("/*EN9NSCALL*/"));
});

t("a full face P&L still keeps the face and sets the detail aside", () => {
  const P = (label, values, page, extra = {}) => ({ row: { label, values, page, years: [2024, 2023] }, x0: 40, docId: "d", feed: "is", ...extra });
  const rows = [P("Turnover", [64048, 77107], 5, { section: "income" }), P("Administrative expenses", [47090, 55367], 5), P("Cost of sales", [11932, 6858], 5),
    P("Sales", [64048, 77107], 10, { section: "income" }), P("Purchases", [11932, 6858], 10), P("Rent", [47090, 55367], 10)];
  const r = SEC.supplementaryDetailPages(rows, new Set([10]));
  assert.ok(!r.abridged);
  assert.ok(r.rows.every((m) => m.row.page !== 10));
});

t("an expense caption under an expense heading is never turnover", () => {
  assert.strictEqual(SEC.sectionOk("costs", "IS:7"), false);
  assert.strictEqual(SEC.sectionOk("costs", "IS:OD"), true);
  assert.ok(DIST.includes("/*EN9COSTSNOTGR*/"));
});

t("the pre-tax subtotal and the equity total are skipped", () => {
  const m = (l, sh) => ENG.matchRuleScoped(l, ENG.DEFAULT_RULES, sh);
  assert.strictEqual(m("PROFIT BEFORE TAXATION", "IS"), "SKIP");
  assert.strictEqual(m("Tax on Profit", "IS"), "IS:62");
  assert.strictEqual(m("SHAREHOLDERS' FUNDS", "BS"), "SKIP");
  assert.ok(DIST.includes("/*EN9UKSKIP*/"));
});

t("a caption wrapped after 'Within' / 'Current' joins its continuation", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "prototype", "wp", "pdfText.ts"), "utf8");
  assert.ok(/before\|per\|not\|within\|after\|than\|less\|due\|by\|with\|at\|current\)/.test(src));
  assert.ok(DIST.includes("/*EN9WRAPCONN*/"));
});

/* ---- comparative statements: the year before, printed beside this year ---- */
const AG = load("src/prototype/wp/agent.ts");
const INS = load("src/prototype/wp/insights.ts");
const tests = [];
const doc = (o) => ({ docId: "d", name: "fs.pdf", kind: "cfc-financial-statements", pages: 9, statementYear: 2024,
  periodEnd: "12/31/2024", rowsRead: 40, rowsWithFigures: 40, rowsDropped: 0, sections: [], language: "English",
  feedsLineItems: true, ...o });
const understand = (docs) => AG.runAgent({ phase: "understand", rows: [], docs, haveModel: false, requiredYear: 2024,
  yearSource: "selected", detectedYears: [2024] }, { ask: async () => "", timeoutMs: 10 });
tests.push(understand([doc({ columnYears: [2024, 2023] })]).then((st) => t("statements with a prior-year column are the opening evidence, not a missing document", () => {
  assert.ok(!st.failures.some((f) => /no document covers 2023/.test(f.what)));
  assert.ok(st.notes.some((n) => /comparative statements recognised/.test(n)));
})));
tests.push(understand([doc({ columnYears: [2024] })]).then((st) => t("single-year statements still raise the missing opening year", () => {
  assert.ok(st.failures.some((f) => /no document covers 2023/.test(f.what)));
})));
tests.push(understand([doc({ columnYears: [2024, 2023] }), doc({ docId: "e", name: "copy.pdf", rowsRead: 0, rowsWithFigures: 0, duplicateOf: "d" })]).then((st) => t("an excluded duplicate copy reading nothing is not a failure", () => {
  assert.ok(!st.failures.some((f) => /copy\.pdf produced no readable line items/.test(f.what)));
})));
t("a prior-year file left unused does not ask for this year's statements already booked", () => {
  const ent = { processedAt: "x", profile: { cyEnd: "12/31/24", legalName: "Co" }, name: "Co", files: [], unmatched: [],
    contributions: { "IS:7": [{ docName: "fs.pdf", value: 1 }] },
    docClasses: {
      a: { fileId: "a", fileName: "fs.pdf", kind: "cfc-financial-statements", statementYear: 2024, pages: [] },
      b: { fileId: "b", fileName: "return23.pdf", kind: "unknown", statementYear: 2023, pages: [], textRows: 50, textChars: 900 },
    } };
  const out = INS.documentDiagnosis(ent);
  const m = out.find((x) => x.id === "doc-diagnosis-b").message;
  assert.ok(/comparative statements in fs\.pdf/.test(m) && !/Upload the 2024 statements/.test(m));
  delete ent.contributions["IS:7"];
  const m2 = INS.documentDiagnosis(ent).find((x) => x.id === "doc-diagnosis-b").message;
  assert.ok(/Upload the 2024 statements/.test(m2));
});
t("dist carries the comparative-statement fixes", () => {
  for (const k of ["/*EN9DUPNOFAIL*/", "/*EN9COMPARATIVE-BEGIN*/", "/*EN9COMPARATIVE-END*/", "/*EN9CMPNOTE*/", "/*EN9DOCCOLYEARS*/", "/*EN9CYDOC*/", "/*EN9PRIORDIAG*/"]) assert.ok(DIST.includes(k), k);
});

Promise.all(tests).catch((e) => { console.log("FAILED: agent run -", e.message); fail++; }).then(() => {
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
});
