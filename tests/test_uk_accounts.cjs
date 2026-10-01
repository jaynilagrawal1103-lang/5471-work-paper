/* Joyce Langan / Barnomadics Limited: a UK (Companies Act) set of accounts.

   What went wrong on the first run, and what each case below pins:
   - the balance-sheet header "Company No. SC240721  Notes  2024  2023" was not
     read as a year header, and the note references ("Tangible assets 4 …")
     were read as figures, so no balance-sheet line was booked;
   - the summary P&L and the "Detailed Profit and Loss Account" were both
     booked, and "Profit for the financial year after taxation" became revenue;
   - "Creditors: amounts falling due within one year" sat under the "Current
     assets" banner and "Capital and reserves" was not a banner, so every
     liability and equity line was vetoed;
   - the fixed-asset note is a movement schedule (classes across the page);
   - the equity statement's dividend was never read (no year header);
   - "Bank charges" and "Employer's NIC" read the English accounts as French.
   Source functions are tested directly; the shipped bundle is checked for the
   same pieces by their sentinels and, where they are pure, by running them. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const ENG = SRC.ENG, SECT = SRC.SECT;
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const CAP = (() => {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, "src/prototype/wp/captions.ts")], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
})();

const cell = (text, x0, x1) => ({ text, x0, x1: x1 ?? x0 + Math.max(10, text.length * 5) });
const row = (page, y, cells) => ({ page, y, cells });

/* Page 8 of the accounts, reduced to the lines that matter. */
const BS = {
  rows: [
    row(8, 700, [cell("Company No.", 50), cell("SC240721", 120), cell("Notes", 300, 330), cell("2024", 400, 430), cell("2023", 480, 510)]),
    row(8, 680, [cell("Tangible assets", 60), cell("4", 310, 316), cell("843,254", 390, 430), cell("632,129", 470, 510)]),
    row(8, 660, [cell("Cash at bank and in hand", 60), cell("84,130", 395, 430), cell("130,725", 470, 510)]),
  ],
};

t("a header carrying the company number and a Notes column still rules the years", () => {
  const rulers = ENG.detectRulers(BS);
  assert.strictEqual(rulers.length, 1);
  assert.deepStrictEqual(rulers[0].cols.map((c) => c.year), [2024, 2023]);
  assert.ok(rulers[0].notes, "the Notes column is remembered");
});

t("the note reference is not read as a figure", () => {
  const rows = ENG.extractPositionedRows(BS, ENG.detectRulers(BS), { pages: new Set([8]) });
  const ta = rows.find((r) => r.label === "Tangible assets");
  assert.deepStrictEqual(ta.values, [843254, 632129]);
  assert.deepStrictEqual(ta.years, [2024, 2023]);
});

t("a bare number is never mistaken for a registration number without its label", () => {
  const r = ENG.detectRulers({ rows: [row(1, 700, [cell("Balance", 50), cell("2024", 400), cell("1234567", 480)])] });
  assert.strictEqual(r.length, 0);
});

const mr = (label, values, page, extra) => ({ row: { label, values, page, x0: 60, ...(extra || {}) }, docId: "d", docName: "d", feed: "bs", kind: "pdf", x0: 60 });

t("creditors lines set the liabilities sections; Capital and reserves opens equity", () => {
  const tagged = SECT.tagSections([
    mr("Current assets", [], 8, { isBanner: true }),
    mr("Debtors", [378272, 287241], 8),
    mr("Creditors: Amount falling due within one year", [-204497, -120711], 8),
    mr("Creditors: Amounts falling due after more than one year", [-387173, -207533], 8),
    mr("Capital and reserves", [], 8, { isBanner: true }),
    mr("Profit and loss account", [696763, 708490], 8),
  ]);
  assert.deepStrictEqual(tagged.map((m) => m.section), ["assets", "assets", "liabilities", "termLiabilities", "equity", "equity"]);
});

t("\"Profit and loss account\" with figures is the reserve, not the P&L title", () => {
  const tagged = SECT.tagSections([mr("Capital and reserves", [], 8, { isBanner: true }), mr("Profit and loss account", [1, 2], 8)]);
  assert.strictEqual(tagged[1].section, "equity");
  const title = SECT.tagSections([mr("Profit and loss account", [], 6, { isBanner: true })]);
  assert.strictEqual(title[0].section, "income");
});

const pl = (label, values, page) => ({ row: { label, values, page, x0: 60 }, docId: "d", docName: "d", feed: "is", kind: "pdf", x0: 60 });
const FACE = [pl("Turnover", [857408, 852430], 6), pl("Cost of Sales", [-502806, -470361], 6), pl("Administrative expenses", [-275327, -242221], 6),
  pl("Other operating income", [29891, 25158], 6), pl("Taxation", [-23813, -30841], 6)];
const DETAIL = [pl("Turnover", [857408, 852430], 16), pl("Purchases", [125789, 120544], 16), pl("Cost of sales", [502806, 470361], 16),
  pl("Rent", [39003, 16500], 16), pl("Administrative expenses", [275327, 242221], 17), pl("Other operating income", [29891, 25158], 17)];

t("a detailed P&L that restates the face P&L is set aside", () => {
  const r = SECT.supplementaryDetailPages([...FACE, ...DETAIL], new Set([16, 17]));
  assert.strictEqual(r.dropped, DETAIL.length);
  assert.ok(r.rows.every((m) => m.row.page === 6));
});

t("detail pages whose figures do not agree with the face are kept", () => {
  const other = DETAIL.map((m) => ({ ...m, row: { ...m.row, values: m.row.values.map((v) => v + 7) } }));
  assert.strictEqual(SECT.supplementaryDetailPages([...FACE, ...other], new Set([16, 17])).dropped, 0);
  assert.strictEqual(SECT.supplementaryDetailPages([...FACE, ...DETAIL], new Set()).dropped, 0);
});

t("the detailed-P&L title is recognised, a plain P&L title is not", () => {
  assert.ok(SECT.DETAIL_PNL_TITLE.test("Detailed Profit and Loss Account"));
  assert.ok(SECT.DETAIL_PNL_TITLE.test("Detailed Trading and Profit and Loss Account"));
  assert.ok(!SECT.DETAIL_PNL_TITLE.test("Profit and Loss Account"));
});

t("a summary \"Cost of sales\" is the lead figure of its section; a closing total is not", () => {
  const withSec = (m, s) => ({ ...m, section: s });
  const summary = SECT.collapsedSections([withSec(FACE[0], "income"), withSec(FACE[1], "cogs"), withSec(pl("Gross profit", [1, 2], 6), "cogs")]);
  assert.strictEqual(summary[1].collapsed, "cogs");
  assert.strictEqual(summary[1].collapsedLead, true);
  const footer = SECT.collapsedSections([withSec(pl("Purchases", [5, 6], 3), "cogs"), withSec(pl("Cost of sales", [5, 6], 3), "cogs")]);
  assert.ok(!footer[1].collapsedLead, "a total after its components never books");
});

t("UK captions reach the right lines (sheet-scoped)", () => {
  const R = ENG.DEFAULT_RULES;
  const is = (l) => ENG.matchRuleScoped(l, R, "IS"), bs = (l) => ENG.matchRuleScoped(l, R, "BS"), any = (l) => ENG.matchRule(l, R);
  assert.strictEqual(any("Profit for the financial year after taxation"), "SKIP");
  assert.strictEqual(any("Total comprehensive income for the period"), "SKIP");
  assert.strictEqual(any("Net current assets"), "SKIP");
  assert.strictEqual(any("Total assets less current liabilities"), "SKIP");
  assert.strictEqual(is("Other interest receivable"), "IS:15");
  assert.strictEqual(is("Interest payable and similar charges"), "IS:29");
  assert.strictEqual(is("Other operating income"), "IS:OI");
  assert.strictEqual(is("Taxation"), "IS:62");
  assert.strictEqual(bs("Taxation"), "BS:OCL", "the balance-sheet creditor keeps its rule");
  assert.strictEqual(is("Distribution costs and selling expenses"), "IS:OD");
  assert.strictEqual(is("Administrative expenses"), "IS:OD");
  assert.strictEqual(bs("Stocks"), "BS:14");
  assert.strictEqual(bs("Deferred taxation"), "BS:OCL");
});

/* Note 4 as the page prints it: classes across, movements down. */
const NOTE = {
  rows: [
    row(14, 800, [cell("4", 40), cell("Tangible fixed assets", 60)]),
    row(14, 780, [cell("Land and", 200), cell("Plant and", 260), cell("Total", 460)]),
    row(14, 760, [cell("Cost or revaluation", 60)]),
    row(14, 740, [cell("At 1 December 2023", 60), cell("568,814", 200), cell("136,965", 260), cell("181,978", 320), cell("-", 390), cell("887,757", 460)]),
    row(14, 720, [cell("Additions", 60), cell("224,621", 200), cell("1,067", 260), cell("25,836", 390), cell("251,524", 460)]),
    row(14, 700, [cell("At 30 November 2024", 60), cell("793,435", 200), cell("138,032", 260), cell("181,978", 320), cell("25,836", 390), cell("1,139,281", 460)]),
    row(14, 680, [cell("Depreciation", 60)]),
    row(14, 660, [cell("At 1 December 2023", 60), cell("40,099", 200), cell("255,628", 460)]),
    row(14, 640, [cell("Charge for the year", 60), cell("40,399", 460)]),
    row(14, 620, [cell("At 30 November 2024", 60), cell("51,476", 200), cell("296,027", 460)]),
    row(14, 600, [cell("Net book values", 60)]),
    row(14, 580, [cell("At 30 November 2024", 60), cell("741,959", 200), cell("843,254", 460)]),
    row(14, 560, [cell("At 30 November 2023", 60), cell("528,715", 200), cell("632,129", 460)]),
  ],
};

t("the movement-schedule fixed-asset note yields cost and depreciation for both years", () => {
  const r = ENG.movementFixedAssetSplit(NOTE, new Set([14]));
  assert.deepStrictEqual(r, { cost: [1139281, 887757], accumDep: [296027, 255628], net: [843254, 632129] });
});

t("a movement schedule that does not tie to its net book value yields nothing", () => {
  const bad = { rows: NOTE.rows.map((r) => (r.y === 580 ? row(14, 580, [cell("At 30 November 2024", 60), cell("999,999", 460)]) : r)) };
  assert.strictEqual(ENG.movementFixedAssetSplit(bad, new Set([14])), null);
});

t("an intangible-assets movement schedule is not read as the tangible one", () => {
  const intang = { rows: NOTE.rows.map((r) => (r.y === 800 ? row(14, 800, [cell("5", 40), cell("Intangible assets", 60)]) : r)) };
  assert.strictEqual(ENG.movementFixedAssetSplit(intang, new Set([14])), null);
});

t("an English caption with an English homograph is English", () => {
  for (const l of ["Bank charges", "Employer's NIC", "Interest payable and similar charges", "Called up share capital", "Job costing"]) {
    assert.strictEqual(CAP.detectLanguage(l), "English", l);
  }
  for (const [l, want] of [["Intérêts et charges assimilées", "French"], ["Autres charges", "French"], ["Charges de personnel", "French"],
                           ["CAPITAL SUSCRITO Y PAGADO", "Spanish"], ["Loyer", "French"], ["Umsatzerlöse", "German"], ["Cuentas por cobrar", "Spanish"]]) {
    assert.strictEqual(CAP.detectLanguage(l), want, l);
  }
});

/* ---- the shipped bundle ---- */
const block = (name) => {
  const a = dist.indexOf(`/*${name}-BEGIN*/`), b = dist.indexOf(`/*${name}-END*/`);
  assert.ok(a > 0 && b > a, `${name} block present`);
  return dist.slice(a, b);
};
const Oa = ENG.numericCell;

t("dist: the detailed-P&L filter behaves like src", () => {
  const f = new Function(block("EN9DETAILPNL") + ";return {EN9supplementaryDetail,EN9DETAILTITLE};")();
  const toDist = (m) => ({ ...m, EN9skip: m.skipReason });
  const r = f.EN9supplementaryDetail([...FACE, ...DETAIL].map(toDist), new Set([16, 17]));
  assert.strictEqual(r.dropped, DETAIL.length);
  assert.ok(f.EN9DETAILTITLE.test("Detailed Profit and Loss Account"));
});

t("dist: the movement-schedule split behaves like src", () => {
  const f = new Function("Oa", block("EN9MOVEFA") + ";return EN9movementFA;")(Oa);
  assert.deepStrictEqual(f(NOTE, new Set([14])), ENG.movementFixedAssetSplit(NOTE, new Set([14])));
});

t("dist: the language hint guard behaves like src", () => {
  const hit = new Function(block("EN9HINTHIT") + ";return EN9hintHit;")();
  assert.strictEqual(hit("bank charges", "charges"), false);
  assert.strictEqual(hit("autres charges", "charges"), true);
  assert.strictEqual(hit("employer's nic", "loyer"), false);
  assert.strictEqual(hit("umsatzerlöse", "umsatz"), true);
});

t("dist: the columnar equity statement yields the current year's dividend", () => {
  const f = new Function("Oa", block("EN9COLEQ") + ";return EN9columnarEquity;")(Oa);
  const eq = { rows: [
    row(9, 700, [cell("At 1 December 2022", 60), cell("100", 300), cell("664,952", 400), cell("665,252", 480)]),
    row(9, 690, [cell("Dividends", 60), cell("(70,000)", 400), cell("(70,000)", 480)]),
    row(9, 680, [cell("At 30 November 2023 and 1", 60)]),
    row(9, 670, [cell("Profit for the period", 60), cell("58,273", 400), cell("58,273", 480)]),
    row(9, 660, [cell("Dividends", 60), cell("(65,000)", 400), cell("(65,000)", 480)]),
    row(9, 650, [cell("At 30 November 2024", 60), cell("100", 300), cell("696,763", 400), cell("697,063", 480)]),
  ] };
  assert.deepStrictEqual(f(eq, new Set([9])), { dividends: 65000, profit: 58273 });
});

t("dist: the other wiring is in place", () => {
  for (const s of ["/*EN9NOTESHDR-BEGIN*/", "/*EN9NOTECOL*/", "/*EN9UKBANNERS*/", "/*EN9SELFSEC-BEGIN*/", "/*EN9COLLLEAD*/",
                   "/*EN9DETAILPNL-CALL*/", "/*EN9COSLEAD*/", "/*EN9SIGNTALLY*/", "/*EN9BRACKETS-BEGIN*/", "/*EN9STMTOPEN*/",
                   "/*EN9COLEQ*/", "/*EN9OWNPARTI-BEGIN*/", "/*EN9NOCFCDAYS*/", "/*EN9FILERSHARE*/", "/*EN9SCHMLATE*/", "/*EN9KNOWNON*/"]) {
    assert.ok(dist.includes(s), s);
  }
  assert.ok(/var EN9RULEVER=(1[1-9]|[2-9]\d);/.test(dist), "catalogue at v11 or later");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
