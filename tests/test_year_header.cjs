/* What a printed column header says the column's year is.
 *
 * A statement does not always head its figure columns with a bare year. The
 * HMC pack prints "NOTES | 2025 | 2024" over the profit and loss and
 * "NOTES | 31 MAR 2025 | 31 MAR 2024" over the balance sheet. Reading only a
 * bare year built no ruler for the second page at all: every row then carried
 * numbers with no year identity, the router refused all of them, and the whole
 * balance sheet went to Review unbooked — and a row whose comparative column
 * printed a dash collapsed to one value and was booked as CURRENT year.
 *
 * The shipped bundle has read these headers since the year-detection
 * hardening; this pins the same reading in the source tree, and pins the two
 * trees to each other.
 *
 *   node tests/test_year_header.cjs
 */
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");
const DIST = require("./fixtures/harness.cjs");

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const ENG = SRC.ENG;
let M = null;

/* The shipped bundle runs inside jsdom, so the arrays it returns belong to
   another realm and deepStrictEqual would fail on the prototype alone. */
const plain = (x) => JSON.parse(JSON.stringify(x));

/* ---- 1. what counts as a year ---- */

const YEARS = [
  ["2025", 2025], ["31 MAR 2025", 2025], ["31 Mar 2025", 2025],
  ["Year ended 30 June 2024", 2024], ["As at 31 December 2024", 2024],
  ["FY24", 2024], ["FY'24", 2024], ["FY2024", 2024], ["2024 NZD", 2024],
  ["2024 '000", 2024],
];

t("a header that names one year is read as that year", () => {
  for (const [text, want] of YEARS) assert.strictEqual(ENG.headerYear(text), want, text);
});

const NOT_YEARS = [
  "1,995.00",            // money that happens to start like a year
  "(2024)",              // a bracketed figure, not a heading
  "2024 Budget",         // a year AND something else
  "Note 2024/25",        // two years
  "20245",               // part of a longer number
  "Total",               // no year at all
  "1885",                // outside the plausible range
  "Movements for the period under review 2024",   // prose
];

t("anything that is not purely a year is refused", () => {
  for (const text of NOT_YEARS) assert.strictEqual(ENG.headerYear(text), null, text);
});

t("the shipped bundle reads the same headers", () => {
  for (const [text, want] of YEARS) assert.strictEqual(M.EN9_HY(text), want, `dist: ${text}`);
  for (const text of NOT_YEARS) assert.strictEqual(M.EN9_HY(text), null, `dist: ${text}`);
});

/* ---- 2. the ruler the header builds ---- */

const cell = (text, x0) => ({ text, x0, x1: x0 + 40 });
const page = (cells) => ({ rows: [{ page: 9, y: 700, cells }] });

const HMC_BS = page([cell("NOTES", 300), cell("31 MAR 2025", 420), cell("31 MAR 2024", 500)]);
const HMC_PL = page([cell("NOTES", 300), cell("2025", 420), cell("2024", 500)]);

t("a dated header rules its page, exactly as a bare-year header does", () => {
  for (const [name, doc] of [["dated", HMC_BS], ["bare", HMC_PL]]) {
    const r = ENG.detectRulers(doc);
    assert.strictEqual(r.length, 1, `${name}: no ruler`);
    assert.deepStrictEqual(r[0].cols.map((c) => c.year), [2025, 2024], name);
    assert.deepStrictEqual(plain(M.EN9detectRulers(doc)).map((x) => x.cols.map((c) => c.year)), [[2025, 2024]], `dist: ${name}`);
  }
});

t("one dated header on its own does not rule a page", () => {
  // A single dated caption is as likely to be the statement's own title.
  assert.deepStrictEqual(ENG.detectRulers(page([cell("As at 31 December 2024", 300)])), []);
});

t("a row of figures is never mistaken for a ruler", () => {
  assert.deepStrictEqual(ENG.detectRulers(page([cell("Bank and Cash", 50), cell("41,165", 420), cell("110,171", 500)])), []);
});

t('"Current Year / Prior Year" waits for the engagement to say which years', () => {
  const doc = page([cell("Current Year", 420), cell("Prior Year", 500)]);
  const raw = ENG.detectRulers(doc);
  assert.deepStrictEqual(raw[0].cols.map((c) => c.year), [-1, -2], "placeholders expected");
  assert.deepStrictEqual(ENG.resolveWordRulers(raw, { cy: 2025, py: 2024 })[0].cols.map((c) => c.year), [2025, 2024]);
  assert.deepStrictEqual(ENG.resolveWordRulers(raw, { cy: null, py: null }), [], "never guessed");
});

/* ---- 3. a statement that runs over a page break ---- */

t("a continuation page inherits the header above it, up to three pages", () => {
  const rulers = [{ page: 6, y: 700, cols: [] }];
  const from = ENG.inheritRulers(rulers, new Set([6, 7, 8, 9, 20]));
  assert.strictEqual(from.get(7), 6);
  assert.strictEqual(from.get(9), 6);
  assert.strictEqual(from.get(20), undefined, "twelve pages later is a different statement");
  assert.strictEqual(from.get(6), undefined, "a ruled page inherits nothing");
});

(async () => {
  M = (await DIST.boot(), DIST.M);
  for (const [name, fn] of tests) {
    try { fn(); console.log("ok:", name); pass++; }
    catch (e) { console.log("FAILED:", name, "-", e.message); fail++; }
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
