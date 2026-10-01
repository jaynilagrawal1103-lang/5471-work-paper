/* William Martinez (DFRNT Entertainment, QuickBooks) and Romy Cuadras
   (Athletic Prime SARL, Swiss accounts) — the partially fixed feedback.

   - QuickBooks: the "Bank Accounts" group ran on past its own total, so the
     receivables, inventory and prepayments printed after it were booked as
     cash.
   - Swiss: "Bénéfice de l'exercice" inside equity was skipped as the P&L's
     bottom line, so retained earnings missed the year's loss; "Petit matériel
     et foumitures" and "Frais de comptabilitée" (OCR/typo forms) were never
     translated; a model booked a P&L caption to inventories; the tax charge
     printed as its effect on profit was booked with the wrong sign.
   - Schedule C must reach the result the statements state.
   - The filer is a U.S. shareholder even when no Schedule B Part I says so.
   - The principal business activity can be read from the code alone.
   - Filer categories are checked against this year's ownership answers. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const root = path.join(__dirname, "..");
const load = (entry) => {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", external: ["react", "react-dom"] });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
};
const SECT = load("src/prototype/wp/sections.ts");
const TERMS = load("src/prototype/wp/terms.ts");
const CF = load("src/prototype/wp/carryForward.ts");
const S = load("src/prototype/wp/store.ts");
const ENG = load("src/prototype/wp/engine.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

const QB = [
  ["ASSETS"], ["Current Assets"], ["Bank Accounts"], ["Petty Cash", 0], ["WAIO Bank", 285588.12], ["Total Bank Accounts", 285588.12],
  ["Accounts Receivable"], ["Accounts Receivable (A/R)", 422111.77], ["Total Accounts Receivable", 422111.77],
  ["Other Current Assets"], ["Inventory Asset", 0], ["Prepaid expenses", 23346.15], ["Total Other Current Assets", 23346.15],
  ["Fixed Assets"], ["IT Equipment", 88184.25], ["Total Fixed Assets", 73593.72], ["Security deposit", 5000],
].map(([label, v]) => ({ row: { label, values: v === undefined ? [] : [v] }, docId: "d", docName: "d", feed: "bs", kind: "pdf" }));

t("QuickBooks: the bank group closes at its own total", () => {
  const tagged = SECT.tagSections(QB);
  const sec = (l) => tagged.find((m) => m.row.label === l).section;
  assert.strictEqual(sec("WAIO Bank"), "cash");
  assert.strictEqual(sec("Accounts Receivable (A/R)"), "assets");
  assert.strictEqual(sec("Prepaid expenses"), "assets");
  assert.strictEqual(sec("Inventory Asset"), "assets");
  assert.strictEqual(sec("Security deposit"), "assets", "a fixed-assets group closes at its total too");
  assert.ok(SECT.sectionOk("assets", "BS:11") && SECT.sectionOk("assets", "BS:OCA"));
});

t("the year's result inside equity is retained earnings, in French too", () => {
  for (const l of ["Bénéfice de l'exercice", "Bénéfice de lexercice", "Perte de l'exercice", "Jahresgewinn", "Utile dell'esercizio", "Net Income"]) {
    assert.strictEqual(SECT.equityOverride(l, "bs", "equity"), "BS:61", l);
  }
  assert.strictEqual(SECT.equityOverride("Bénéfice de l'exercice", "is", "income"), null, "on the P&L it stays the skipped bottom line");
  assert.strictEqual(SECT.equityOverride("Bénéfice reporté", "bs", "equity"), null);
});

t("French captions with typos and OCR misreads translate", () => {
  assert.strictEqual(TERMS.translateCaption("Frais de comptabilitée"), "accounting fees");
  assert.strictEqual(TERMS.translateCaption("Petit materiel et foumitures de training"), "small material and training supplies");
  assert.strictEqual(ENG.matchRuleScoped("small material and training supplies", ENG.DEFAULT_RULES, "IS"), "IS:OD");
  assert.strictEqual(TERMS.translateCaption("Frais bancaires"), "bank charges", "unchanged");
  assert.strictEqual(TERMS.translateCaption("Employee"), null);
});

t("a caption keeps to the statement it was printed on", () => {
  const is = "No mapping rule matches this caption on an income-statement page — assign it";
  const bs = "No mapping rule matches this caption on a balance-sheet page — assign it";
  assert.ok(S.statementSideVeto(is, "BS:14"));
  assert.strictEqual(S.statementSideVeto(is, "IS:OD"), null);
  assert.ok(S.statementSideVeto(bs, "IS:7"));
  assert.strictEqual(S.statementSideVeto(bs, "BS:OCA"), null);
  assert.strictEqual(S.statementSideVeto("No mapping rule matches this caption — assign it", "BS:14"), null);
});

const ent = (lines, contributions, unmatched = [], extra = {}) => ({
  id: "e", name: "e", files: [], processedAt: "x", lines, contributions, unmatched, profile: { cyEnd: "12/31/24", activity: "Training" },
  ownership: {}, categories: { "5a": true }, fx: {}, fxMeta: {}, docClasses: {}, detected: {}, reviewItems: [], ...extra,
});

t("Schedule C is checked against the stated result for the year", () => {
  const lines = { "IS:7": { amount: 1000 }, "IS:34": { amount: 300 }, "BS:61": { eoy: 500 } };
  const ni = (v) => ({ "BS:61": [{ label: "Net Income", value: v, field: "eoy", docId: "d", docName: "d", via: "rule" }] });
  assert.strictEqual(S.pnlTieOut(ent(lines, ni(700))), null, "ties");
  const gap = S.pnlTieOut(ent(lines, ni(900), [{ label: "Other income", values: [200], years: [2024], reason: "No mapping rule matches this caption on an income-statement page" }]));
  assert.deepStrictEqual([gap.booked, gap.stated, gap.diff, gap.candidates], [700, 900, 200, ["Other income"]]);
  const v = S.validateEntity(ent(lines, ni(900)));
  assert.ok(v.some((r) => r.id === "pnl-net-income-tie"));
  assert.strictEqual(S.pnlTieOut(ent(lines, {})), null, "nothing stated, nothing checked");
});

t("an activity code alone gives the principal business activity", () => {
  assert.strictEqual(CF.naicsDescription("512110"), "Motion picture and video industries");
  assert.strictEqual(CF.naicsDescription("713940"), "Other amusement and recreation industries");
  assert.strictEqual(CF.naicsDescription("541990"), "Professional, scientific, and technical services");
  assert.strictEqual(CF.naicsDescription(""), null);
  const v = S.validateEntity(ent({ "IS:7": { amount: 1 } }, {}, [], { profile: { cyEnd: "12/31/24", activity: "" } }));
  assert.ok(v.some((r) => r.id === "basic-activity-missing"));
});

t("filer categories are checked against this year's ownership", () => {
  const ids = (o, c) => S.validateEntity(ent({ "IS:7": { amount: 1 } }, {}, [], { ownership: o, categories: c })).map((r) => r.id);
  let v = ids({ cfc: "Yes", ownStart: "50", ownEnd: "50" }, { "2": true, "3": true });
  assert.ok(v.includes("category-5-expected") && v.includes("category-3-carried") && !v.includes("category-4-expected"));
  v = ids({ cfc: "Yes", ownStart: "100", ownEnd: "100" }, { "4": true, "5a": true });
  assert.ok(!v.includes("category-5-expected") && !v.includes("category-4-expected"));
  v = ids({ cfc: "Yes", ownStart: "0.6", ownEnd: "1" }, { "5a": true });
  assert.ok(v.includes("category-4-expected"), "fractions read as percentages");
});

t("QuickBooks P&L: other income in brackets, currency-coded totals, its own bottom line", () => {
  const rows = [["Other Income(Loss)"], ["Other operating income (expenses)", 2763.4], ["Total Other Income(Loss)", 2763.4], ["Expenses"], ["Bank charges", 9094.42]]
    .map(([label, v]) => ({ row: { label, values: v === undefined ? [] : [v] }, docId: "d", docName: "d", feed: "is", kind: "pdf" }));
  const tagged = SECT.tagSections(rows);
  assert.strictEqual(tagged[1].section, "otherIncome");
  assert.strictEqual(tagged[4].section, "costs");
  assert.strictEqual(ENG.numericCell("AED -47,183.90"), -47183.9);
  assert.strictEqual(ENG.numericCell("AED2,424,658.93"), 2424658.93);
  for (const x of ["USD 5", "VAT 5", "AED 12", "Note 12"]) assert.strictEqual(ENG.numericCell(x), null, x);
  const lines = { "IS:7": { amount: 1000 }, "IS:34": { amount: 300 } };
  const bsNi = { "BS:61": [{ label: "Net Income", value: 900, field: "eoy", docId: "d", docName: "d", via: "rule" }] };
  const e = ent(lines, bsNi, [], { statedResults: [{ label: "NET EARNINGS", value: 700, docName: "p", feed: "is" }] });
  assert.strictEqual(S.pnlTieOut(e), null, "Schedule C equals the P&L's own bottom line");
  assert.deepStrictEqual(S.resultsDisagree(e), { pnl: 700, bs: 900, pnlLabel: "NET EARNINGS", bsLabel: "Net Income", diff: 200 });
  assert.ok(S.validateEntity(e).some((r) => r.id === "pnl-bs-result-differ"));
});

t("dist carries the same pieces and they agree with src", () => {
  for (const s of ["/*EN9PROFITFR*/", "/*EN9TOTCLOSE*/", "/*EN9ARBANNER*/", "/*EN9DOUBLEE*/", "/*EN9SIDEVETO1*/", "/*EN9SIDEVETO2*/",
                   "/*EN9TAXBYRESULT*/", "/*EN9TIEOUT*/", "/*EN9USFILER*/", "/*EN9ACTIVITY*/", "/*EN9ACTBYCODE*/", "/*EN9CATCHECK*/",
                   "/*EN9CFC50*/", "/*EN9DERIVED10*/", "/*EN9PNLTIE-BEGIN*/", "/*EN9NAICS-BEGIN*/",
                   "/*EN9ACTGLUED*/", "/*EN9CURCELL*/", "/*EN9STATEDPRE*/", "/*EN9SRSAVE*/"]) assert.ok(dist.includes(s), s);
  const grab = (name) => { const i = dist.indexOf(`function ${name}(`); const j = dist.indexOf("\n", i); return dist.slice(i, j); };
  const pr = /var EN9PROFIT=(\/.*?\/i);/.exec(dist);
  const deg = dist.slice(dist.indexOf("/*EN9DEGLUE-BEGIN*/"), dist.indexOf("/*EN9DEGLUE-END*/"));
  const profit = new Function(`${deg};var EN9PROFIT=${pr[1]};${grab("EN9isProfitLine")};return EN9isProfitLine;`)();
  for (const l of ["Bénéfice de l'exercice", "Perte de l'exercice", "Jahresgewinn", "Net Income", "Retained earnings", "GANANCIA O (PERDIDA) NETA DEL PERIODO"]) {
    assert.strictEqual(profit(l), SECT.isProfitLine(l), l);
  }
  const veto = new Function(`${grab("EN9sideVeto")};return EN9sideVeto;`)();
  for (const [r, tg] of [["on an income-statement page", "BS:14"], ["on a balance-sheet page", "IS:7"], ["on an income-statement page", "IS:OD"]]) {
    assert.strictEqual(!!veto(r, tg), !!S.statementSideVeto(r, tg));
  }
  const a = dist.indexOf("/*EN9NAICS-BEGIN*/"), b = dist.indexOf("/*EN9NAICS-END*/");
  const naics = new Function(dist.slice(a, b) + ";return EN9naics;")();
  for (const c of ["512110", "713940", "541990", "999999", ""]) assert.strictEqual(naics(c), CF.naicsDescription(c), c);
  const ci = dist.indexOf("function EN9curCell(e,dt){"), cj = dist.indexOf("var Oa=", ci);
  const cur = new Function("Ii", dist.slice(ci, cj) + ";return EN9curCell;")(ENG.numeric);
  for (const x of ["AED -47,183.90", "AED2,424,658.93", "USD 5", "EUR (1,234.50)"]) {
    const want = ENG.numericCell(x);
    assert.strictEqual(cur(x) ?? null, x === "USD 5" ? null : want, x);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
