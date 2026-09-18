/* Statement structure: banners, structural subtotals, re-feeding.
 *
 * The shipped implementation lives in dist behind the EN9STRUCT sentinels.
 * This runs it and the src port over the same rows and demands identical
 * answers -- equivalence, not merely that the new code works.
 *
 * The fixture is the shape that produced the bugs: a page holding the tail of
 * a P&L and the head of a balance sheet, with the client's own subtotals
 * printed, a running page footer, and "Interest" appearing under two
 * different banners.
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
const SRC = load("src/prototype/wp/sections.ts");
const ENG = load("src/prototype/wp/engine.ts");

/* ---- the shipped implementation, lifted out of dist ---- */

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const SHIPPED = (() => {
  const b = dist.indexOf("/*EN9STRUCT-BEGIN*/"), e = dist.indexOf("/*EN9STRUCT-END*/");
  assert.ok(b > 0 && e > b, "EN9STRUCT sentinels present in dist");
  let block = dist.slice(b + "/*EN9STRUCT-BEGIN*/".length, e);
  // The region also carries the tie-out and Schedule E helpers, which close
  // over app internals this test has no business constructing. Only the
  // section/structure half is under test; cut the rest off at its sentinel.
  const tieEnd = block.indexOf("/*EN9TIE-END*/");
  assert.ok(tieEnd > 0, "EN9TIE-END marks where the structure helpers begin");
  block = block.slice(tieEnd + "/*EN9TIE-END*/".length);
  const sandbox = {};
  new Function("exports", "is", block +
    ";exports.indentOf=EN9indentOf;exports.amtOf=EN9amtOf;exports.kidsSum=EN9kidsSum;" +
    "exports.same=EN9same;exports.structRows=EN9structRows;exports.dropFurniture=EN9dropFurniture;" +
    "exports.bsSide=EN9bsSide;exports.sectionOk=EN9sectionOk;exports.sectionRoute=EN9sectionRoute;" +
    "exports.tagSections=EN9tagSections;exports.SECTB=EN9SECTB;" +
    "exports.dropMovementSchedules=EN9dropMovement;")(sandbox, ENG.BS_LINES);
  return sandbox;
})();

/** [label, amount|null, x0] -> a pipeline row. */
const R = (label, amt, x0, page = 1) => ({
  row: { label, values: amt === null ? [] : [amt], page },
  docId: "d1", docName: "Accounts.pdf", feed: "is", kind: "pdf", x0,
});

/* 29 since the bank-accounts, cost-of-sales and other-expenses groups were
   added: a QuickBooks sub-account is named after the bank or the supplier, so
   only its heading says what it is, and "8150 Exchange gain or loss" is a LOSS
   only because of the heading it is printed under. */
t("the two banner lexicons are the same 29 patterns", () => {
  const BANNERS = load("src/prototype/wp/sectionBanners.ts").SECTION_BANNERS;
  assert.strictEqual(BANNERS.length, 29);
  assert.strictEqual(SHIPPED.SECTB.length, BANNERS.length);
  for (let i = 0; i < BANNERS.length; i++) {
    assert.strictEqual(String(BANNERS[i][0]), String(SHIPPED.SECTB[i][0]), "pattern " + i);
    assert.strictEqual(BANNERS[i][1], SHIPPED.SECTB[i][1], "section " + i);
  }
});

/* ---- banners ---- */

t("a banner tags every row beneath it, and stops at the next banner", () => {
  const rows = [
    R("Operating expenses", null, 40),
    R("Interest", 1200, 60),
    R("Current assets", null, 40),
    R("Interest", 800, 60),
  ];
  const tagged = SRC.tagSections(rows);
  assert.deepStrictEqual(tagged.map((m) => m.section), ["costs", "costs", "assets", "assets"]);
  assert.deepStrictEqual(tagged.map((m) => m.section), SHIPPED.tagSections(rows).map((m) => m.section));
});

t("rows above the first banner carry no section -- absence of evidence", () => {
  const rows = [R("Sales", 500000, 40), R("Operating expenses", null, 40), R("Rent", 12000, 60)];
  assert.deepStrictEqual(SRC.tagSections(rows).map((m) => m.section), [null, "costs", "costs"]);
});

t("a row that already carries a section is never re-tagged", () => {
  const rows = [R("Operating expenses", null, 40), { ...R("Rent", 12000, 60), section: "income" }];
  assert.strictEqual(SRC.tagSections(rows)[1].section, "income");
});

t('"Total current assets 412,500" is a data row, not a banner', () => {
  const BANNERS = load("src/prototype/wp/sectionBanners.ts");
  assert.ok(BANNERS.isBannerLabel("Current assets"));
  assert.ok(!BANNERS.isBannerLabel("Total current assets 412,500"));
  assert.ok(!BANNERS.isBannerLabel("Interest on current assets"));
});

t("the lexicon covers the languages the analysts actually sent", () => {
  const { isBannerLabel } = load("src/prototype/wp/sectionBanners.ts");
  for (const n of ["Eigen vermogen", "Capitaux propres", "Passif", "Activos", "Patrimonio neto",
                   "Vaste activa", "Winst en verliesrekening", "Provisions"]) {
    assert.ok(isBannerLabel(n), n);
  }
});

/* ---- the veto ---- */

t("a balance-sheet banner refuses an income line, and the reverse", () => {
  for (const [section, target, want] of [
    ["assets", "IS:7", false],
    ["assets", "BS:11", true],
    ["assets", "BS:46", false],          // payables are the other side
    ["liabilities", "BS:46", true],
    ["liabilities", "BS:11", false],
    ["costs", "IS:26", true],
    ["costs", "BS:46", false],
    ["income", "IS:7", true],
  ]) {
    assert.strictEqual(SRC.sectionOk(section, target), want, section + " -> " + target);
    assert.strictEqual(SRC.sectionOk(section, target), SHIPPED.sectionOk(section, target), section + " -> " + target);
  }
});

t("pool ids resolve to the side they belong to", () => {
  assert.strictEqual(SRC.sectionOk("assets", "BS:OCA"), true);
  assert.strictEqual(SRC.sectionOk("liabilities", "BS:OCA"), false);
  assert.strictEqual(SRC.sectionOk("liabilities", "BS:OCL"), true);
  assert.strictEqual(SRC.sectionOk("liabilities", "BS:OL"), true);
});

t("no banner, or no target, vetoes nothing", () => {
  assert.strictEqual(SRC.sectionOk(null, "IS:7"), true);
  assert.strictEqual(SRC.sectionOk("assets", null), true);
});

/* ---- the fallback route ---- */

t("the assets side has NO catch-all -- a guessed asset line is unfindable", () => {
  assert.strictEqual(SRC.sectionRoute("assets", "Something nobody has ever seen"), null);
  assert.strictEqual(SRC.sectionRoute("assets", "Trade debtors"), "BS:11");
  assert.strictEqual(SRC.sectionRoute("assets", "Accumulated depreciation"), "BS:29");
  assert.strictEqual(SRC.sectionRoute("assets", "Prepaid insurance"), "BS:OCA");
  // Branch order matters and is deliberate: "VAT receivable" IS a receivable,
  // so the receivable branch above claims it before the tax branch.
  assert.strictEqual(SRC.sectionRoute("assets", "VAT receivable"), "BS:11");
});

t("the other three sides do have one, because each has a real other line", () => {
  assert.strictEqual(SRC.sectionRoute("liabilities", "Something unseen"), "BS:OCL");
  assert.strictEqual(SRC.sectionRoute("income", "Something unseen"), "IS:7");
  assert.strictEqual(SRC.sectionRoute("costs", "Something unseen"), "IS:OD");
});

t("the fallback matches the shipped routing on every branch", () => {
  const labels = ["Trade debtors", "Accumulated depreciation", "VAT receivable", "Nothing familiar",
    "Share capital", "Retained earnings", "Deferred income", "Current account with parent",
    "Trade creditors", "Aandelenkapitaal", "Referral fee", "Sundry income", "Turnover",
    "Salaries", "WKR expense", "Depreciation", "Interest paid", "FX loss",
    "Vennootschapsbelasting", "Belasting", "Office costs"];
  for (const section of ["assets", "liabilities", "income", "costs"]) {
    for (const l of labels) {
      assert.strictEqual(SRC.sectionRoute(section, l), SHIPPED.sectionRoute(section, l), section + " / " + l);
    }
  }
});

/* ---- structural subtotals ---- */

t("a heading whose value is the sum of the rows beneath it is a summary", () => {
  const rows = [
    R("Operating expenses", 33000, 40),
    R("Rent", 12000, 60),
    R("Salaries", 20000, 60),
    R("Insurance", 1000, 60),
  ];
  const out = SRC.structRows(rows);
  assert.ok(out[0].skipReason, "the heading should be skipped");
  assert.match(out[0].skipReason, /summary of the 3 row\(s\)/);
  assert.ok(out.slice(1).every((m) => !m.skipReason), "its components must survive");
});

t("a trailing total printed flush with the rows it adds is skipped", () => {
  /* This used to be left as data, on the reasoning that a total level with
     its siblings is not provably their total. The arithmetic says otherwise:
     200,000 + 28,705 IS 228,705, and booking the total as well counted the
     group twice. Xero-style accounts set every group out this way -- on one
     2025 file it double-counted cost of sales, donations, shareholders'
     remuneration and the term loan. */
  const rows = [
    R("Cost of goods", null, 40),
    R("Purchases", 200000, 60),
    R("Freight", 28705, 60),
    R("Total cost of goods", 228705, 60),
  ];
  const out = SRC.structRows(rows);
  assert.match(out[3].skipReason, /total of the 2 row\(s\) printed flush above it/);
  assert.ok(out.slice(1, 3).every((m) => !m.skipReason), "its components must survive");
  assert.ok(out.slice(1, 3).every((m) => m.inTotal), "and are marked as counted by it");
});

t("a flush total is left as data when the arithmetic does not tie", () => {
  // Same shape, one dollar out. Without a proof there is no subtotal, and a
  // line the preparer cannot see is worse than one they can drop.
  const rows = [
    R("Cost of goods", null, 40),
    R("Purchases", 200000, 60),
    R("Freight", 28705, 60),
    R("Total cost of goods", 228704, 60),
  ];
  assert.ok(!SRC.structRows(rows)[3].skipReason, "no tie, so it stays data");
});

t("a flush total stops at the group total above it, even one left as data", () => {
  /* The statement's own rounding: 27 whole-dollar expense lines add to 642,791
     against a printed 642,794, so "Total Expenses" cannot be proved and stays
     data. The NEXT total must still stop there -- without this it walked
     straight past and summed 29 rows instead of its own one, and the
     shareholders' remuneration was booked twice. */
  const rows = [
    R("Expenses", null, 56.7),
    R("Rent", 12000, 63.8),
    R("Salaries", 20794, 63.8),
    R("Total Expenses", 32797, 63.8),          // three dollars out: not provable
    R("Wages - Heather Claycomb", 216300, 63.8),
    R("Total Shareholders Remuneration", 216300, 63.8),
  ];
  const out = SRC.structRows(rows);
  assert.ok(!out[3].skipReason, "the rounded total is left as data");
  assert.match(out[5].skipReason, /total of the 1 row\(s\) printed flush above it/);
  assert.ok(!out[1].skipReason && !out[2].skipReason, "the expenses are untouched");
  const theirs = SHIPPED.structRows(rows).map((m) => m.EN9skip || null);
  assert.deepStrictEqual(out.map((m) => m.skipReason || null), theirs, "both trees agree");
});

t("a flush total does not reach back past a group that already closed", () => {
  // Two groups in a row. The second total must add ITS members only, never
  // the first group's, or the tie is an accident.
  const rows = [
    R("Purchases", 200000, 60),
    R("Total purchases", 200000, 60),
    R("Rent", 12000, 60),
    R("Insurance", 3000, 60),
    R("Total overheads", 15000, 60),
  ];
  const out = SRC.structRows(rows);
  // The first one is caught by the earlier, more specific test: it closes a
  // group that opened by the same name. Either way it must not survive.
  assert.ok(out[1].skipReason, "the first total is dropped");
  // The second adds ITS two members and stops at the closed group above them.
  assert.match(out[4].skipReason, /total of the 2 row\(s\) printed flush above it/);
  assert.ok(!out[2].skipReason && !out[3].skipReason, "the overheads survive");
});

t("a total indented level with its siblings needs the total word at the outermost indent", () => {
  const rows = [
    R("Purchases", 200000, 60),
    R("Freight", 28705, 60),
    R("Total", 228705, 40),
  ];
  const out = SRC.structRows(rows);
  assert.match(out[2].skipReason, /total of the 2 row\(s\) above it/);
});

t("a grand total at the outermost indent is skipped on its word alone", () => {
  const rows = [R("Sales", 500000, 40), R("Other income", 12000, 40), R("Grand total", 999999, 40)];
  const out = SRC.structRows(rows);
  assert.strictEqual(out[2].skipReason, "a total at the outermost indent of the report");
  assert.ok(!out[0].skipReason && !out[1].skipReason);
});

t("a genuine line item whose caption starts with a total word is NOT dropped", () => {
  // "Total return on investments" is a real caption; it is at the outermost
  // indent, so only the arithmetic keeps it -- which is why the third test
  // requires the total WORD as well as the indent.
  const rows = [R("Rent", 12000, 60), R("Totalisator levy", 4000, 60)];
  assert.ok(SRC.structRows(rows).every((m) => !m.skipReason));
});

t("only the immediate children count, not grandchildren", () => {
  const rows = [
    R("Operating expenses", 33000, 40),
    R("Premises", 13000, 60),
    R("Rent", 12000, 80),
    R("Rates", 1000, 80),
    R("Salaries", 20000, 60),
  ];
  const out = SRC.structRows(rows);
  assert.match(out[0].skipReason, /summary of the 2 row\(s\)/, "13,000 + 20,000, not the leaves too");
  assert.match(out[1].skipReason, /summary of the 2 row\(s\)/);
});

t("the tolerance accepts a subtotal printed rounded, and rejects a real difference", () => {
  assert.ok(SRC.same(33000.01, 33000));
  assert.ok(SRC.same(2290116.5, 2290116));         // one part per million of 2.3m
  assert.ok(!SRC.same(33010, 33000));
  for (const [a, b] of [[33000.01, 33000], [2290116.5, 2290116], [33010, 33000], [0.02, 0], [0.03, 0]]) {
    assert.strictEqual(SRC.same(a, b), SHIPPED.same(a, b), a + " ~ " + b);
  }
});

t("structRows matches the shipped implementation on the whole fixture", () => {
  const rows = [
    R("Operating expenses", 33000, 40),
    R("Rent", 12000, 60),
    R("Salaries", 20000, 60),
    R("Insurance", 1000, 60),
    R("Grand total", 33000, 40),
    R("Page 1 of 9", null, 40, 1),
    R("Page 2 of 9", null, 40, 2),
  ];
  const mine = SRC.structRows(rows).map((m) => [m.row.label, m.skipReason || null]);
  const theirs = SHIPPED.structRows(rows).map((m) => [m.row.label, m.EN9skip || null]);
  assert.deepStrictEqual(mine, theirs);
});

t("src and the shipped file agree on a total printed flush with its rows", () => {
  // The fixture above has no flush total, so it cannot tell the two trees
  // apart on the behaviour that changed. This one can.
  const rows = [
    R("Cost of Sales", null, 56.7),
    R("Purchases", null, 63.8),
    R("Contractor Labour Costs", 152418, 70.9),
    R("Total Purchases", 152418, 70.9),
    R("Donation Paid", 50000, 63.8),
    R("Total Donations paid", 50000, 63.8),
    R("Totalisator levy", 4000, 63.8),
  ];
  const mine = SRC.structRows(rows).map((m) => [m.row.label, m.skipReason || null]);
  const theirs = SHIPPED.structRows(rows).map((m) => [m.row.label, m.EN9skip || null]);
  assert.deepStrictEqual(mine, theirs, "the two trees must drop exactly the same rows");
  const dropped = mine.filter(([, why]) => why).map(([label]) => label);
  assert.deepStrictEqual(dropped, ["Total Purchases", "Total Donations paid"]);
});

/* ---- furniture ---- */

t("a value-less caption repeating across pages is furniture and is removed", () => {
  const rows = [
    R("Smith & Co Chartered Accountants", null, 40, 1),
    R("Smith & Co Chartered Accountants", null, 40, 2),
    R("Rent", 12000, 60, 1),
  ];
  const out = SRC.dropFurniture(rows);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].row.label, "Rent");
});

t("digits are normalised, so a numbered footer is one repeating caption", () => {
  const rows = [R("Page 1 of 9", null, 40, 1), R("Page 2 of 9", null, 40, 2)];
  assert.strictEqual(SRC.dropFurniture(rows).length, 0);
});

t("a caption appearing once is not furniture, however value-less", () => {
  const rows = [R("Current assets", null, 40, 1), R("Cash", 55574, 60, 1)];
  assert.strictEqual(SRC.dropFurniture(rows).length, 2);
});

/* ---- re-feeding ---- */

t("a balance-sheet banner on a P&L page moves its rows to the other pipeline", () => {
  const isRows = SRC.tagSections([
    R("Operating expenses", null, 40),
    R("Rent", 12000, 60),
    R("Current assets", null, 40),
    R("Cash at bank", 55574, 60),
  ]);
  const out = SRC.refeedBySection(isRows, []);
  assert.strictEqual(out.moved, 2, "the banner and the row beneath it");
  assert.deepStrictEqual(out.is.map((m) => m.row.label), ["Operating expenses", "Rent"]);
  assert.deepStrictEqual(out.bs.map((m) => m.row.label), ["Current assets", "Cash at bank"]);
  assert.ok(out.bs.every((m) => m.feed === "bs"), "the moved rows must carry the new feed");
});

t("nothing to move leaves both arrays untouched, by identity", () => {
  const isRows = SRC.tagSections([R("Operating expenses", null, 40), R("Rent", 12000, 60)]);
  const out = SRC.refeedBySection(isRows, []);
  assert.strictEqual(out.moved, 0);
  assert.strictEqual(out.is, isRows);
});

/* ---- the pipeline actually calls all of it ---- */

const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const engine = fs.readFileSync(path.join(root, "src", "prototype", "wp", "engine.ts"), "utf8");

t("banners survive row hygiene and are emitted by the positioned reader", () => {
  assert.ok(engine.includes("label.length <= 40 && isBannerLabel(label)"), "hygiene drops banners");
  assert.ok(engine.includes("if (!opts?.raw && label.length <= 40 && isBannerLabel(label))"),
    "the reader does not emit banners, or emits them on raw pages");
});

t("every positioned row carries its indent", () => {
  assert.ok(/const candidate: ExtractedRow = \{ label, values: kept\.map\(\(x\) => x\.v\), years, page: row\.page, x0 \}/.test(engine));
});

t("step 2 tags, re-feeds and detects structure, and logs both counts", () => {
  assert.ok(store.includes("re-routed between the P&L and balance-sheet pipelines by their statement section banners"));
  assert.ok(store.includes("structural subtotal/total row(s) dropped before mapping"));
  assert.ok(/pdfIs = structRows\(pdfIs\)/.test(store) && /pdfBs = structRows\(pdfBs\)/.test(store));
});

t("step 3 skips structure, applies the veto AFTER a target is chosen, then the fallback", () => {
  const loop = store.slice(store.indexOf("for (const m of mapRows) {"));
  assert.ok(loop.includes("if (m.skipReason || m.row.isBanner) continue;"), "structure is booked");
  const veto = loop.indexOf("if (target && m.section && !sectionOk(m.section, target)) target = null;");
  const fallback = loop.search(/if \(!target && m\.section\) \{\s*target = sectionRoute\(m\.section, m\.row\.label\)/);
  assert.ok(veto > 0 && fallback > veto, "the fallback must run after the veto, not before");
});

t("the section travels onto the unmatched row", () => {
  assert.ok(store.includes("docId: m.docId, docName: m.docName, section: m.section,"));
});



/* ---- movement schedules ---- */

const MOVEMENT_PAGE = [
  R("Shareholder Current Accounts", null, 56.7, 11),
  R("Opening Balance", 1384, 63.8, 11),
  R("Funds Introduced", 26000, 63.8, 11),
  R("Drawings", 15548, 63.8, 11),
  R("FBT Contribution", 12382, 63.8, 11),
  R("Closing Balance", -1312, 63.8, 11),
];
const BALANCE_PAGE = [
  R("Current Liabilities", null, 56.7, 9),
  R("Trade & Other Payables", 40897, 63.8, 9),
  R("Income Tax Payable", 4508, 63.8, 9),
  R("Total Current Liabilities", 45405, 63.8, 9),
  R("Net Assets", 95781, 56.7, 9),
];

t("a page that reconciles one account's movements is not booked", () => {
  const out = SRC.dropMovementSchedules(MOVEMENT_PAGE);
  assert.ok(out.every((m) => m.skipReason), "every row on the page is dropped");
  assert.match(out[1].skipReason, /reconciles one account's movements/);
});

t("a real balance-sheet page is left alone", () => {
  // No opening/closing balance rows, and it states what a balance sheet
  // exists to state.
  assert.ok(SRC.dropMovementSchedules(BALANCE_PAGE).every((m) => !m.skipReason));
});

t("only the movement page is dropped when both are in one list", () => {
  const out = SRC.dropMovementSchedules([...BALANCE_PAGE, ...MOVEMENT_PAGE]);
  assert.ok(out.slice(0, BALANCE_PAGE.length).every((m) => !m.skipReason), "page 9 survives");
  assert.ok(out.slice(BALANCE_PAGE.length).every((m) => m.skipReason), "page 11 does not");
});

t("a page that DOES state a balance-sheet total is left alone", () => {
  // The guard: a page stating positions is a balance sheet whatever else it
  // carries, so the detector must keep its hands off it.
  const mixed = [...MOVEMENT_PAGE.map((m) => ({ ...m })), R("Total Assets", 179864, 56.7, 11)];
  assert.ok(SRC.dropMovementSchedules(mixed).every((m) => !m.skipReason));
});

t("the shipped file drops the same movement page", () => {
  const both = [...BALANCE_PAGE, ...MOVEMENT_PAGE];
  const mine = SRC.dropMovementSchedules(both).map((m) => [m.row.label, !!m.skipReason]);
  const theirs = SHIPPED.dropMovementSchedules(both).map((m) => [m.row.label, !!m.EN9skip]);
  assert.deepStrictEqual(mine, theirs);
});

/* ---- the running header ---- */

t("the running header is dropped BEFORE the banners are read", () => {
  /* The defect this ordering fixes: a multi-page P&L repeats its own title at
     the top of every continuation page, and that title is itself a banner, so
     tagging first reset the section to income at each page break and every
     unmatched expense below it was booked as revenue. */
  const rows = [
    R("Statement of Financial Performance", null, 56.7, 6),
    R("Expenses", null, 56.7, 6),
    R("Subscriptions", 40686, 63.8, 6),
    R("Statement of Financial Performance", null, 56.7, 7),
    R("Team Building", 3016, 63.8, 7),
  ];
  const wrong = SRC.tagSections(rows).map((m) => m.section);
  assert.strictEqual(wrong[wrong.length - 1], "income", "tagging first is what went wrong");
  for (const [label, tag, furn] of [["src", SRC.tagSections, SRC.dropFurniture],
                                    ["dist", SHIPPED.tagSections, SHIPPED.dropFurniture]]) {
    const out = tag(furn(rows));
    assert.strictEqual(out.length, 3, label + ": both copies of the title are gone");
    assert.strictEqual(out[out.length - 1].section, "costs",
      label + ": page 7 stays in the section page 6 left off in");
  }
});

t("the pipeline runs the furniture drop before tagging, and the movement drop after", () => {
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  const furn = store.indexOf("pdfIs = dropFurniture(pdfIs)");
  const tag = store.indexOf("pdfIs = tagSections(pdfIs)");
  const mov = store.indexOf("pdfBs = dropMovementSchedules(pdfBs)");
  assert.ok(furn > 0 && tag > furn, "furniture is dropped first");
  assert.ok(mov > tag, "movement pages are dropped once the rows carry their page");
  assert.ok(dist.includes("/*EN9FURNFIRST-BEGIN*/"), "the shipped file does it too");
  assert.ok(dist.includes("/*EN9MOVSCHED-CALL-BEGIN*/"), "and calls the movement drop");
  assert.ok(dist.indexOf("/*EN9FURNFIRST-BEGIN*/") < dist.indexOf("EN9pi=EN9tagSections(EN9pi)"),
    "in that order in the shipped file as well");
});

/* ---- "Other income" is its own section ---- */

t("a caption under Other Income cannot reach a deduction line", () => {
  // "Motor Vehicle Contribution" is a receipt. The keyword scan sees "motor
  // vehicle" and offers the motor-vehicle EXPENSE line; the banner must veto
  // it, or the figure leaves income AND enters deductions.
  assert.strictEqual(SRC.sectionOk("otherIncome", "IS:OD"), false);
  assert.strictEqual(SRC.sectionOk("otherIncome", "IS:45"), false);
  assert.strictEqual(SRC.sectionOk("otherIncome", "IS:26"), false);
  // nor is it turnover: the statement already said it is not
  assert.strictEqual(SRC.sectionOk("otherIncome", "IS:7"), false);
  // but every income line the form offers stays open
  for (const t2 of ["IS:14", "IS:15", "IS:16", "IS:17", "IS:18", "IS:22", "IS:OI"]) {
    assert.strictEqual(SRC.sectionOk("otherIncome", t2), true, t2);
  }
  assert.strictEqual(SRC.sectionOk("otherIncome", "BS:11"), false, "never the balance sheet");
});

t("an unrecognised caption under Other Income lands on other income", () => {
  assert.strictEqual(SRC.sectionRoute("otherIncome", "Motor Vehicle Contribution"), "IS:OI");
  assert.strictEqual(SRC.sectionRoute("otherIncome", "Something nobody has seen"), "IS:OI");
  // and the ones the form names go to their own line
  assert.strictEqual(SRC.sectionRoute("otherIncome", "Interest Received"), "IS:15");
  assert.strictEqual(SRC.sectionRoute("otherIncome", "Dividends received"), "IS:14");
  assert.strictEqual(SRC.sectionRoute("otherIncome", "Rent received"), "IS:16");
  assert.strictEqual(SRC.sectionRoute("otherIncome", "Loss on Sale of Fixed Assets"), "IS:18");
});

t("the Other Income banner is recognised, and plain Income still is not it", () => {
  const rows = [
    R("Other Income", null, 56.7),
    R("Motor Vehicle Contribution", 10767, 63.8),
    R("Expenses", null, 56.7),
    R("Motor Vehicle Expenses", 2914, 63.8),
  ];
  assert.deepStrictEqual(SRC.tagSections(rows).map((m) => m.section),
    ["otherIncome", "otherIncome", "costs", "costs"]);
  assert.deepStrictEqual(SRC.tagSections(rows).map((m) => m.section),
    SHIPPED.tagSections(rows).map((m) => m.section), "both trees agree");
});

t("src and the shipped file agree on the Other Income veto and route", () => {
  for (const t2 of ["IS:7", "IS:OD", "IS:15", "IS:18", "IS:OI", "BS:11", "IS:26"]) {
    assert.strictEqual(SRC.sectionOk("otherIncome", t2), SHIPPED.sectionOk("otherIncome", t2), t2);
  }
  for (const l of ["Motor Vehicle Contribution", "Interest Received", "Dividends received",
                   "Rent received", "Royalties", "Loss on Sale of Fixed Assets", "Nothing familiar"]) {
    assert.strictEqual(SRC.sectionRoute("otherIncome", l), SHIPPED.sectionRoute("otherIncome", l), l);
  }
});

/* ---- "Non-current / term liabilities" is its own section ---- */

t("a liability under a term-liabilities banner cannot reach line 16", () => {
  // Schedule F splits current liabilities (line 16) from the rest (line 19).
  // Without this the Vodafone term loan landed on 16 with the GST and the
  // income tax payable, and the work paper disagreed with the hand-prepared
  // one on the line although the totals matched.
  assert.strictEqual(SRC.sectionOk("termLiabilities", "BS:OCL"), false);
  assert.strictEqual(SRC.sectionOk("termLiabilities", "BS:50"), false);
  assert.strictEqual(SRC.sectionOk("termLiabilities", "BS:46"), false, "nor accounts payable");
  for (const t2 of ["BS:OL", "BS:52", "BS:54", "BS:55", "BS:56"]) {
    assert.strictEqual(SRC.sectionOk("termLiabilities", t2), true, t2);
  }
  assert.strictEqual(SRC.sectionOk("termLiabilities", "IS:26"), false, "never the P&L");
});

t("an unrecognised term liability lands on Schedule F line 19", () => {
  assert.strictEqual(SRC.sectionRoute("termLiabilities", "Vodafone - New Phones"), "BS:OL");
  assert.strictEqual(SRC.sectionRoute("termLiabilities", "Bank loan"), "BS:OL");
  // ...but a shareholder's long-term loan is still line 18
  assert.strictEqual(SRC.sectionRoute("termLiabilities", "Shareholder current account"), "BS:52");
  assert.strictEqual(SRC.sectionRoute("termLiabilities", "Loan from director"), "BS:52");
});

t("the banner is read, and plain Current Liabilities still is not it", () => {
  const rows = [
    R("Current Liabilities", null, 56.7),
    R("GST Payable", 26379, 63.8),
    R("Non-Current Liabilities", null, 56.7),
    R("Term Liabilities", null, 63.8),
    R("Vodafone - New Phones", 3598, 70.9),
  ];
  assert.deepStrictEqual(SRC.tagSections(rows).map((m) => m.section),
    ["liabilities", "liabilities", "termLiabilities", "termLiabilities", "termLiabilities"]);
  assert.deepStrictEqual(SRC.tagSections(rows).map((m) => m.section),
    SHIPPED.tagSections(rows).map((m) => m.section), "both trees agree");
});

t("src and the shipped file agree on the term-liability veto and route", () => {
  for (const t2 of ["BS:OCL", "BS:OL", "BS:52", "BS:46", "BS:50", "IS:26"]) {
    assert.strictEqual(SRC.sectionOk("termLiabilities", t2), SHIPPED.sectionOk("termLiabilities", t2), t2);
  }
  for (const l of ["Vodafone - New Phones", "Bank loan", "Shareholder current account", "Loan from director"]) {
    assert.strictEqual(SRC.sectionRoute("termLiabilities", l), SHIPPED.sectionRoute("termLiabilities", l), l);
  }
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
