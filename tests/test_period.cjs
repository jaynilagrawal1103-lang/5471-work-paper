/* The period the statements themselves print.
 *
 * `detectStatementYear` answers "which year", which is all the column routing
 * needs; Basic Information needs the DAY. Before this reader the day and month
 * could only come from a prior-year 5471, so a 30 June entity with no prior
 * return was silently dated 12/31 — wrong FX tables, wrong Schedule E and J
 * dates, wrong period filed, and nothing on the face of the work paper to show
 * it. Both trees are checked, and they must agree.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const SRC = load("src/prototype/wp/classify.ts");

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const region = (a, b) => {
  const i = dist.indexOf(a), j = dist.indexOf(b);
  assert.ok(i > 0 && j > i, a + " present in dist");
  return dist.slice(i + a.length, j);
};
const SHIPPED = (() => {
  const sandbox = {};
  new Function("exports",
    // the shipped reader calls the page-text helper by its minified name
    'function V1(doc,page,take){var rows=doc.rows.filter(function(r){return r.page===page});' +
    'var slice=take==="head"?rows.slice(0,14):take==="foot"?rows.slice(-3):rows;' +
    'return slice.map(function(r){return r.cells.map(function(c){return c.text}).join(" ")}).join("\\n").toLowerCase()}' +
    region("/*EN9PERIOD-BEGIN*/", "/*EN9PERIOD-END*/") +
    ";exports.parseLongDate=EN9parseLongDate;exports.detectStatementPeriodEnd=EN9stmtPeriodEnd;" +
    "exports.periodMinusOneYear=EN9periodMinus1;")(sandbox);
  return sandbox;
})();

const TREES = [["src", SRC], ["dist", SHIPPED]];

/* one page of text, as the classifier sees it */
const doc = (lines, page = 1) => ({
  pageCount: 1,
  rows: lines.map((text) => ({ page, cells: [{ text }] })),
});
const fsPage = (page = 1) => [{ page, kind: "fs-balance-sheet", score: 1 }];

/* ---- the date parser ---- */

const DATES = [
  ["for the year ended 30 June 2024", "06/30/2024", "day-month-year, the Commonwealth order"],
  ["for the year ended 30th June 2024", "06/30/2024", "ordinal suffix"],
  ["for the year ended the 30th of June 2024", "06/30/2024", "written out"],
  ["for the year ended June 30, 2024", "06/30/2024", "month-day-year, the US order"],
  ["as at 31 March 2025", "03/31/2025", "as at"],
  ["as of December 31, 2023", "12/31/2023", "as of"],
  ["for the year ended 31 June 2024", null, "31 June is not a date — refused, not rounded"],
  ["for the year ended 30 June 1824", null, "outside the plausible range"],
  ["balance sheet", null, "no date at all"],
];

for (const [tree, M] of TREES) {
  for (const [text, want, why] of DATES) {
    t(`${tree}: ${why}`, () => assert.strictEqual(M.parseLongDate(text), want));
  }
  t(`${tree}: a year before is one year back`, () => {
    assert.strictEqual(M.periodMinusOneYear("06/30/2024"), "06/30/2023");
  });
}

/* ---- the page reader ---- */

for (const [tree, M] of TREES) {
  t(`${tree}: the period end is read from the statement heading`, () => {
    const d = doc(["Rise Digital Marketing Pty Ltd", "Balance Sheet", "For the year ended 30 June 2024"]);
    assert.strictEqual(M.detectStatementPeriodEnd(d, fsPage(), 2024), "06/30/2024");
  });

  t(`${tree}: the comparative date does not win`, () => {
    // Every set of accounts prints last year beside this year. A first-match
    // reader takes the comparative and dates the work paper a year early.
    const d = doc(["Balance Sheet", "As at 30 June 2024", "As at 30 June 2023"]);
    assert.strictEqual(M.detectStatementPeriodEnd(d, fsPage(), 2024), "06/30/2024");
  });

  t(`${tree}: a date from another year alone is the comparative, not this period`, () => {
    const d = doc(["Balance Sheet", "As at 30 June 2023"]);
    assert.strictEqual(M.detectStatementPeriodEnd(d, fsPage(), 2024), null);
  });

  t(`${tree}: pages that are not statements are ignored`, () => {
    const d = doc(["Engagement letter", "For the year ended 30 June 2024"]);
    const cover = [{ page: 1, kind: "tandc", score: 1 }];
    assert.strictEqual(M.detectStatementPeriodEnd(d, cover, 2024), null);
  });

  t(`${tree}: nothing stated reads as nothing, never as 31 December`, () => {
    const d = doc(["Balance Sheet", "Trade debtors 40,000"]);
    assert.strictEqual(M.detectStatementPeriodEnd(d, fsPage(), 2024), null);
  });

  t(`${tree}: Xero's "for the 12 months ended" heading is read`, () => {
    const d = doc(["Profit and Loss", "Rise Digital Marketing", "For the 12 months ended 31 December 2024"]);
    assert.strictEqual(M.detectStatementPeriodEnd(d, fsPage(), 2024), "12/31/2024");
  });

  t(`${tree}: a from-to range is not read — its first date is the period START`, () => {
    const d = doc(["Profit and Loss", "For the period 1 July 2023 to 30 June 2024"]);
    assert.strictEqual(M.detectStatementPeriodEnd(d, fsPage(), 2024), null);
  });

  t(`${tree}: a calendar year end is read as itself`, () => {
    const d = doc(["Income Statement", "For the year ended 31 December 2023"]);
    assert.strictEqual(M.detectStatementPeriodEnd(d, fsPage(), 2023), "12/31/2023");
  });
}

t("both trees read an Australian set of accounts the same way", () => {
  const d = doc(["Rise Digital Marketing", "Statement of Financial Position", "As at 30 June 2024", "This year 2024 Last year 2023"]);
  assert.strictEqual(SHIPPED.detectStatementPeriodEnd(d, fsPage(), 2024), SRC.detectStatementPeriodEnd(d, fsPage(), 2024));
  assert.strictEqual(SRC.detectStatementPeriodEnd(d, fsPage(), 2024), "06/30/2024");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
