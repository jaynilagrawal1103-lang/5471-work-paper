/* Multi-year statements (2022 | 2023 | 2024) and the Andrew Ban / Macroroots
   spreadsheets.

   - A small first-year balance under a year heading was thrown away as a
     "line number" (payables 97 beside 5,079 and 9,990).
   - Spreadsheet headings ("Revenues:", "Cost of sales:") were never read, so
     "Services" (twice) could not be placed.
   - Tight three-year columns were glued into one number, in digital PDFs and
     in the OCR text layer alike ("6,124,500 5,483,000" -> 612,450,054,830,005).
   - "Taxes" under the operating result is the tax charge.
   - A calendar-year prior return names the year before the work paper.
   - "Cash and cash equivalents 65,029" is a line, not a heading over the
     receivables printed beneath it. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const root = path.join(__dirname, "..");
const ENG = SRC.ENG, SECT = SRC.SECT;
const load = (entry) => {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
};
const CLS = load("src/prototype/wp/classify.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const layer = fs.readFileSync(path.join(root, "layer-src", "enhance.js"), "utf8");

const BS = [
  ["Amended"], ["", "December 31,", "December 31,", "December 31,"], ["", "2022", "2023", "2024"],
  ["ASSETS:"], ["Current assets:"],
  ["Cash and cash equivalents", "31201", "68638", "65029"],
  ["Accounts receivable, net", "40630.3", "49978.03", "28625"],
  ["Current liabilities:"],
  ["Accounts payable", "97", "5079", "9990"],
  ["Taxase payable", "10397", "12251", "38555"],
  ["Non-current liabilities:"],
  ["Short-term debt", "0", "262997", "0"],
  ["Shareholder's equity:"],
  ["Dividend Payouts", "15809", "0", "43478"],
];
const IS = [
  ["Macroroots Fintech Consulting SRL"], ["", "December 31,", "December 31,", "December 31,"], ["", "2022", "2023", "2024"],
  ["Revenues:"], ["Services", "80200", "258728", "312687"],
  ["Cost of sales:"], ["Services", "3028", "10859", "1258"],
  ["Operating expenses:"], ["Wages, general and administrative", "153", "58515", "184721"],
  ["Operating income", "68243", "94561", "43644"], ["Taxes", "1528", "2352", "7110"],
];

t("a small first-year balance under a year heading is kept", () => {
  const rows = ENG.extractRows(BS);
  const ap = rows.find((r) => r.label === "Accounts payable");
  assert.deepStrictEqual(ap.values, [97, 5079, 9990]);
  assert.deepStrictEqual(ap.years, [2022, 2023, 2024]);
  const wages = ENG.extractRows(IS).find((r) => /^Wages/.test(r.label));
  assert.deepStrictEqual(wages.values, [153, 58515, 184721]);
});

t("without a year heading a leading small integer is still a line number", () => {
  const r = ENG.extractRows([["Rent", "12", "36,000", "33,600"]])[0];
  assert.deepStrictEqual(r.values, [36000, 33600]);
});

t("spreadsheet headings with a colon are read as sections, only when asked", () => {
  const plain = ENG.extractRows(IS);
  assert.ok(!plain.some((r) => r.isBanner), "the default reader is unchanged");
  const rows = ENG.extractRows(IS, { banners: true });
  const mr = rows.map((row) => ({ row, docId: "d", docName: "d", feed: "both", kind: "grid" }));
  const tagged = SECT.tagSections(mr).filter((m) => !m.row.isBanner);
  const sec = (label, n = 0) => tagged.filter((m) => m.row.label === label)[n].section;
  assert.strictEqual(sec("Services", 0), "income");
  assert.strictEqual(sec("Services", 1), "cogs");
  assert.strictEqual(SECT.sectionRoute("income", "Services"), "IS:7");
  assert.strictEqual(SECT.sectionRoute("cogs", "Services"), "IS:12");
});

t("balance-sheet headings: liabilities, a short-term debt under a non-current heading, equity", () => {
  const rows = ENG.extractRows(BS, { banners: true }).map((row) => ({ row, docId: "d", docName: "d", feed: "both", kind: "grid" }));
  const tagged = SECT.tagSections(rows).filter((m) => !m.row.isBanner);
  const sec = (label) => tagged.find((m) => m.row.label === label).section;
  assert.strictEqual(sec("Accounts receivable, net"), "assets", "the valued cash line does not become a heading");
  assert.strictEqual(sec("Cash and cash equivalents"), "cash");
  assert.strictEqual(sec("Taxase payable"), "liabilities");
  assert.strictEqual(sec("Dividend Payouts"), "equity");
  assert.strictEqual(SECT.sectionRoute("liabilities", "Taxase payable"), "BS:OCL", "a tax owed is not a trade payable");
  assert.strictEqual(SECT.sectionRoute("termLiabilities", "Short-term debt"), "BS:OL", "a borrowing is line 19, as the filed return carried it");
  assert.strictEqual(SECT.sectionRoute("termLiabilities", "Current portion of long-term debt"), "BS:OCL");
  assert.strictEqual(SECT.sectionRoute("equity", "Dividend Payouts"), "BS:61");
  assert.strictEqual(ENG.matchRule("Total shareholder's equity", ENG.DEFAULT_RULES), "SKIP");
});

t("in a spreadsheet only a heading row opens a section, never a title carrying its year", () => {
  const grid = [["Income statement", "2024"], ["Turnover", "500000"], ["Zzq holding charge", "250"]];
  const rows = ENG.extractRows(grid, { banners: true }).map((row) => ({ row, docId: "d", docName: "d", feed: "both", kind: "grid" }));
  const tagged = SECT.tagSections(rows, { headingsOnly: true });
  assert.ok(tagged.every((m) => !m.section), "no section: an unknown caption stays unassigned, never gross receipts");
});

t("the new rules", () => {
  const R = ENG.DEFAULT_RULES, is = (l) => ENG.matchRuleScoped(l, R, "IS"), bs = (l) => ENG.matchRuleScoped(l, R, "BS");
  assert.strictEqual(is("Other expenses"), "IS:OD");
  assert.strictEqual(bs("Short-term debt"), "BS:OL");
  assert.strictEqual(bs("Long-term debt"), "BS:OL");
  assert.strictEqual(bs("Taxes payable"), "BS:OCL");
});

t("a grid's period is read from its year heading", () => {
  assert.strictEqual(CLS.gridPeriodEnd(BS), "12/31/2024");
  assert.strictEqual(CLS.gridPeriodEnd([["", "31 March 2025", "31 March 2024"]]), "03/31/2025");
  assert.strictEqual(CLS.gridPeriodEnd([["Rent", "36,000"]]), null);
});

t("a calendar prior-year return sets the work paper year to the year after it", () => {
  const stmt = { kind: "cfc-financial-statements", statementYear: 2024 };
  const prior = (y, end) => ({ kind: "prior-year-us-return", statementYear: y, statementPeriodEnd: end });
  let r = CLS.deriveCaseYears([stmt, prior(2022, "12/31/2022")]);
  assert.deepStrictEqual([r.cy, r.py, r.afterPrior], [2023, 2022, 2022]);
  r = CLS.deriveCaseYears([stmt, prior(2023, "12/31/2023")]);
  assert.strictEqual(r.cy, 2024, "statements for the year after the return: unchanged");
  r = CLS.deriveCaseYears([{ kind: "cfc-financial-statements", statementYear: 2025 }, prior(2023, "03/31/2024")]);
  assert.strictEqual(r.cy, 2025, "a fiscal year is left alone");
  r = CLS.deriveCaseYears([stmt]);
  assert.strictEqual(r.cy, 2024, "no prior return: the newest statement year, as before");
});

t("two complete figures are never one number", () => {
  assert.strictEqual(ENG.numericCell("6,124,500 5,483,000 4,971,200"), null);
  assert.strictEqual(ENG.numericCell("(1,234) 5,678"), null);
  assert.strictEqual(ENG.numericCell("1 234 567"), 1234567, "space-grouped thousands still read");
  assert.strictEqual(ENG.numericCell("12 345,67"), 12345.67);
  assert.strictEqual(ENG.numericCell("6,124,500"), 6124500);
});

t("dist carries the same pieces", () => {
  for (const s of ["/*EN9BANNERKEY*/", "/*EN9GRIDBANNER*/", "/*EN9YEARCOLNUM*/", "/*EN9GRIDSECT*/", "/*EN9SHORTTERM*/", "/*EN9TAXOCL*/",
                   "/*EN9TAXAFTER*/", "/*EN9AFTERPRIOR*/", "/*EN9GRIDPERIOD-BEGIN*/", "/*EN9TWOFIG*/", "/*EN9TWOFIGCELL*/",
                   "/*EN9CASHOWN*/", "/*EN9NONUS*/", "/*EN9GRIDYEAR*/", "/*EN9TBSEED*/"]) {
    assert.ok(dist.includes(s), s);
  }
  assert.ok(/var EN9RULEVER=(1[3-9]);/.test(dist));
  assert.ok(layer.includes("var EN9OCRFIG=") && /EN9OCRFIG\.test\(r\.text\.split/.test(layer), "the OCR text layer never joins two figures");
});

t("dist: the glue guard and grid period behave like src", () => {
  const FIG = /function EN9twoFig\(e\)\{return \/\\s\/\.test\(e\)&&e\.split\(\/\\s\+\/\)\.filter\(function\(z\)\{return (\/.+?\/)\.test\(z\)\}\)/.exec(dist);
  assert.ok(FIG, "the dist guard is present");
  const re = new Function("return " + FIG[1])();
  assert.ok(re.test("6,124,500") && re.test("5125.00") && !re.test("1") && !re.test("234"));
  const a = dist.indexOf("/*EN9GRIDPERIOD-BEGIN*/"), b = dist.indexOf("/*EN9GRIDPERIOD-END*/");
  const gp = new Function("oJ", dist.slice(a, b) + ";return EN9gridPeriodEnd;")(ENG.detectGridYearHeader);
  assert.strictEqual(gp(BS), "12/31/2024");
});

/* ---- The work paper year controls the whole run ----
   A Dutch set of accounts (2Hats Consulting, 2024) heads its pages "Balance
   sheet as of 2024" and "Results until end of 2024", with the period on the
   cover as "01/01/2024 - 31/12/2024". None of it was read, so the accounts
   reported no year, the work paper had none, and the prior-year return beside
   them showed "Mismatch" against a year that did not exist. */
const mkDoc = (pages) => {
  const rows = [];
  pages.forEach((lines, i) => lines.forEach((text, j) => rows.push({ page: i + 1, y: 800 - j * 14, cells: [{ text, x: 40, w: 200 }] })));
  return { rows, pageCount: pages.length, pageWidths: pages.map(() => 595) };
};

t("a Dutch set of accounts states its year and period", () => {
  const doc = mkDoc([
    ["2Hats Consulting B.V.", "CoC: 74933787", "Financial report", "Assets and liabilities | Profit and loss", "01/01/2024 - 31/12/2024"],
    ["Balance sheet as of 2024     2Hats Consulting B.V.", "Assets", "Liquid assets", "Liabilities"],
    ["Results until end of 2024     2Hats Consulting B.V.", "Net turnover", "Personnel costs"],
  ]);
  const pages = [{ page: 1, kind: "unknown", score: 0 }, { page: 2, kind: "fs-balance-sheet", score: 3 }, { page: 3, kind: "fs-pnl", score: 3 }];
  assert.strictEqual(CLS.detectStatementYear(doc, pages), 2024);
  assert.deepStrictEqual(CLS.detectStatementPeriod(doc, pages, 2024), { start: "01/01/2024", end: "12/31/2024" });
  assert.deepStrictEqual(CLS.detectStatementPeriod(doc, pages, 2023).start, null, "a range for another year is not this year's");
  const alone = [{ page: 1, kind: "unknown", score: 0 }];
  assert.strictEqual(CLS.detectStatementPeriod(doc, alone, null).start, null, "a lone unknown page is not a statement cover");
});

t("a numeric period range is ordered by its own dates, never guessed", () => {
  assert.deepStrictEqual(CLS.numericRange([1, 1, 2024, 31, 12, 2024]), { start: "01/01/2024", end: "12/31/2024" });
  assert.deepStrictEqual(CLS.numericRange([4, 1, 2023, 3, 31, 2024]), { start: "04/01/2023", end: "03/31/2024" });
  assert.strictEqual(CLS.numericRange([1, 1, 2024, 1, 12, 2024]), null, "no part over 12: cannot tell day from month");
  assert.strictEqual(CLS.numericRange([31, 12, 2024, 1, 1, 2024]), null, "an end before its start");
  assert.strictEqual(CLS.numericRange([31, 2, 2024, 31, 12, 2024]), null, "no 31 February");
});

t("with no statement year, the prior-year return still names the work paper year", () => {
  const prior = { kind: "prior-year-us-return", statementYear: 2023, statementPeriodEnd: "12/31/2023" };
  const r = CLS.deriveCaseYears([{ kind: "cfc-financial-statements", statementYear: null }, prior]);
  assert.deepStrictEqual([r.cy, r.py, r.afterPrior, r.dissent.length], [2024, 2023, 2023, 0]);
  assert.deepStrictEqual(CLS.deriveCaseYears([{ kind: "cfc-financial-statements", statementYear: null }]).cy, null, "nothing to go on: no year");
});

t("dist reads the same year, period and prior-only year", () => {
  for (const s of ["/*EN9YEARANCH*/", "/*EN9NUMRANGE*/", "/*EN9PRIORONLY*/", "/*EN9YEARCLEAR*/", "/*EN9NOYEARPRIOR*/"]) assert.ok(dist.includes(s), s);
  const i = dist.indexOf("function EN9numericRange(p){"), j = dist.indexOf(":null}", i) + 6;
  const nr = new Function(dist.slice(i, j) + ";return EN9numericRange;")();
  for (const p of [[1, 1, 2024, 31, 12, 2024], [4, 1, 2023, 3, 31, 2024], [1, 1, 2024, 1, 12, 2024], [31, 12, 2024, 1, 1, 2024], [31, 2, 2024, 31, 12, 2024]]) {
    assert.deepStrictEqual(nr(p), CLS.numericRange(p), p.join("/"));
  }
  const z = /function Z1\(t\)\{.*?dissent:i\.slice\(1\)\}\}/.exec(dist);
  const Z1 = new Function(z[0] + ";return Z1;")();
  const prior = { kind: "prior-year-us-return", statementYear: 2023, statementPeriodEnd: "12/31/2023" };
  assert.deepStrictEqual(Z1([{ kind: "cfc-financial-statements", statementYear: null }, prior]), CLS.deriveCaseYears([{ kind: "cfc-financial-statements", statementYear: null }, prior]));
});

t("changing the work paper year clears what was mapped for the old year", () => {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, "src/prototype/wp/store.ts")], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", external: ["react", "react-dom"] });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  const S = mod.exports;
  S.actions.addEntity();
  const id = S.getSnapshot().activeEntityId;
  S.actions.setField(id, "profile", "cyEnd", "12/31/23");
  const ent = S.getSnapshot().entities.find((e) => e.id === id);
  S.loadState({ ...S.getSnapshot(), entities: S.getSnapshot().entities.map((e) => e.id === id ? { ...e, processedAt: "x", lines: { "IS:7": { amount: 258728 } }, contributions: { "IS:7": [{ label: "Services", value: 258728 }] }, unmatched: [{ label: "x" }] } : e) });
  S.actions.setField(id, "profile", "cyEnd", "12/31/24");
  const after = S.getSnapshot().entities.find((e) => e.id === id);
  assert.deepStrictEqual(after.lines, {}, "no 2023 figure survives on a 2024 work paper");
  assert.deepStrictEqual(after.contributions, {});
  assert.deepStrictEqual(after.unmatched, []);
  assert.strictEqual(after.yearStale, true);
  assert.ok(ent.profile && after.profile.cyEnd === "12/31/24");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
