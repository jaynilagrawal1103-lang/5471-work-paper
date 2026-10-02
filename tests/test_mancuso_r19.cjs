/* Catherine F. Mancuso / Blue Water Grill Ltd (round 19).
 *
 *   - "Savings Account 16,135" printed under Current liabilities is a
 *     liability: the cash group opens only on the assets side.
 *   - "Long-term assets" is a fixed-asset heading, and a nested group's total
 *     hands the section back to it.
 *   - A proven group's heading places the accounts no rule knows (inventory),
 *     and a staff-cost group is one group on line 11.
 *   - Catalogue v15: bank accounts named after the bank, staff loans and
 *     "due from", equipment rental, donations, business tax.
 *   - The year's dividend is the dividends account's movement; Schedule R
 *     splits it by holder when every holder is a U.S. shareholder.
 *   - Schedule Q unit figures, the Schedule H donations add-back, the
 *     high-tax-exception flag, the shared-row account count.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const pending = [];
const t = (name, fn) => { try { const r = fn(); if (r && r.then) { pending.push(r.then(() => { console.log("ok:", name); pass++; }, (e) => { console.log("FAILED:", name, "-", e.message); fail++; })); return; } console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const root = path.join(__dirname, "..");
const load = (entry) => {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", external: ["react", "react-dom"], define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' } });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
};
const ENG = load("src/prototype/wp/engine.ts");
const S = load("src/prototype/wp/store.ts");
const SECT = load("src/prototype/wp/sections.ts");
const BAN = load("src/prototype/wp/sectionBanners.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const block = (b, e) => { const i = dist.indexOf(b), j = dist.indexOf(e); assert.ok(i > 0 && j > i, b); return dist.slice(i + b.length, j); };

/* ---- the shipped structure helpers, as test_sections lifts them ---- */
const SHIPPED = (() => {
  let b = block("/*EN9STRUCT-BEGIN*/", "/*EN9STRUCT-END*/");
  b = b.slice(b.indexOf("/*EN9TIE-END*/") + "/*EN9TIE-END*/".length);
  const sb = {};
  new Function("exports", "is", b + ";exports.structRows=EN9structRows;exports.tagSections=EN9tagSections;exports.sectionOk=EN9sectionOk;exports.sectionRoute=EN9sectionRoute;exports.SECTB=EN9SECTB;")(sb, ENG.BS_LINES);
  return sb;
})();
const DGROUP = new Function("EN9TOTALW", "EN9SECTB", "EN9bk",
  "function EN9indentOf(t){return t&&typeof t.x0==\"number\"?Math.round(t.x0*10)/10:0}\nfunction EN9amtOf(t){var e=t&&t.row&&t.row.values;return e&&e.length?e[e.length-1]:null}\n"
  + block("/*EN9GROUPS-BEGIN*/", "/*EN9GROUPS-END*/") + ";return EN9tagGroups;");

/* The real statements' geometry: every printed line, headings included. */
const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "bwg_rows.json"), "utf8"));
const rowsOf = (raw, feed, docId) => {
  const out = [];
  for (const r of raw) {
    const cells = r.cells.filter((c) => c.x0 < 500 || /\d/.test(c.text));
    const lab = cells.find((c) => c.x0 < 150);
    if (!lab || /^(TOTAL|Blue Water Grill Ltd|Profit and Loss|Balance Sheet|January|As of|Accrual|\d+\/\d+)$/.test(lab.text.trim())) continue;
    const vals = cells.filter((c) => c !== lab).map((c) => ENG.numericCell(c.text.replace(/^BZ\$/, ""))).filter((v) => v !== null);
    const label = lab.text.trim();
    out.push({ row: { label, values: vals, page: r.page, isBanner: !vals.length && BAN.isBannerLabel(label) }, feed, kind: "pdf", x0: lab.x0, docId, docName: docId });
  }
  return out;
};
const pipe = (impl, groups) => {
  const pl = rowsOf(RAW.pl, "is", "pl"), bs = rowsOf(RAW.bs, "bs", "bs");
  const run = (rows) => groups(impl.tagSections(impl.structRows(rows)));
  return { pl: run(pl), bs: run(bs) };
};
const SRC = pipe(SECT, (r) => SECT.tagStatementGroups(r));
const SHP = pipe(SHIPPED, (r) => { const g = DGROUP(new Function("return " + /EN9TOTALW=(\/.*?\/i)/.exec(dist)[1])(), SHIPPED.SECTB, (x) => String(x || "").trim().replace(/\s*:\s*$/, "")); return g(r.map((m) => Object.assign(m, { EN9skip: m.EN9skip || m.skipReason }))); });
const find = (rows, label) => { const m = rows.find((x) => x.row.label === label); assert.ok(m, label); return m; };

t("a savings account printed under current liabilities is a liability, in both trees", () => {
  for (const [who, R] of [["src", SRC], ["dist", SHP]]) {
    for (const l of ["Savings Account", "Income Tax Witholding", "Social Security"]) {
      assert.notStrictEqual(find(R.bs, l).section, "cash", `${who}: ${l}`);
    }
    assert.strictEqual(find(R.bs, "1002 · Belize Bank Checking").section === "liabilities", false, who);
  }
});

t("long-term assets is a fixed-asset heading, and the nested group's total hands it back", () => {
  for (const [who, R] of [["src", SRC], ["dist", SHP]]) {
    assert.strictEqual(find(R.bs, "1501 · Bar Equipment").section, "fixedAssets", who);
    assert.strictEqual(find(R.bs, "Furniture and Equipment").section, "fixedAssets", `${who}: after "Total Fixed Assets"`);
    assert.strictEqual(find(R.bs, "Golf Cart C").section, "fixedAssets", who);
    assert.strictEqual(SECT.sectionRoute("fixedAssets", "Golf Cart C"), "BS:28");
  }
});

t("the group chain carries the outer heading, in both trees", () => {
  const beerS = find(SRC.bs, "1303 · Beer"), fuelS = find(SRC.bs, "Fuel");
  assert.deepStrictEqual(beerS.groups, ["1301 · Bar Stock", "Inventory and Supplies"]);
  assert.deepStrictEqual(fuelS.groups, ["Inventory and Supplies"]);
  assert.deepStrictEqual(find(SHP.bs, "1303 · Beer").EN9gchain, beerS.groups);
  assert.deepStrictEqual(find(SHP.bs, "Fuel").EN9gchain, fuelS.groups);
  assert.deepStrictEqual(find(SRC.pl, "Payroll").groups, ["Staff costs"]);
  assert.deepStrictEqual(find(SHP.pl, "Payroll").EN9gchain, ["Staff costs"]);
  // Headings map where the accounts do not.
  assert.strictEqual(ENG.matchRuleScoped("Inventory and Supplies", ENG.DEFAULT_RULES, "BS"), "BS:14");
  assert.strictEqual(ENG.matchRuleScoped("1303 · Beer", ENG.DEFAULT_RULES, "BS"), null);
  assert.strictEqual(ENG.matchRuleScoped("Staff costs", ENG.DEFAULT_RULES, "IS"), "IS:26");
  assert.strictEqual(ENG.matchRuleScoped("Payroll", ENG.DEFAULT_RULES, "IS"), "IS:OD", "the payroll rule itself is unchanged");
});

t("catalogue v15 rules, and a v14 catalogue receives them", () => {
  const R = ENG.DEFAULT_RULES;
  const m = (l, sh) => ENG.matchRuleScoped(l, R, sh);
  assert.strictEqual(m("1002 · Belize Bank Checking", "BS"), "BS:10");
  assert.strictEqual(m("Atlantic Bank Checking", "BS"), "BS:10");
  assert.strictEqual(m("1403 · Staff Loans", "BS"), "BS:OCA");
  assert.strictEqual(m("Due From SunBreeze", "BS"), "BS:OCA");
  assert.strictEqual(m("Due from shareholder", "BS"), "BS:19");
  assert.strictEqual(m("Equipment rental", "IS"), "IS:27");
  assert.strictEqual(m("Donations", "IS"), "IS:OD");
  assert.strictEqual(m("Business tax", "IS"), "IS:32");
  assert.strictEqual(m("Business Tax Payable", "BS"), "BS:OCL", "the balance-sheet payable is unaffected");
  assert.strictEqual(m("Furniture and Equipment", "BS"), "BS:28");
  assert.strictEqual(m("Rental income", "IS"), "IS:16", "income from renting out is not rent paid");
  assert.ok(S.RULE_CATALOGUE_VERSION >= 15);
  assert.ok(/var EN9RULEVER=(1[5-9]|[2-9]\d);/.test(dist));
  const v14 = R.filter((r) => !r.kw.some((k) => ["checking", "staff loan", "due from shareholder", "equipment rental", "donation", "business tax", "furniture and equipment"].includes(k)));
  const up = S.upgradeRules(v14, 14);
  assert.strictEqual(ENG.matchRuleScoped("Atlantic Bank Checking", up, "BS"), "BS:10");
  assert.strictEqual(ENG.matchRuleScoped("Equipment rental", up, "IS"), "IS:27");
  assert.ok(dist.includes('14:["checking","staff loan","due from shareholder","equipment rental","donation","business tax","furniture and equipment"]'));
});

t("a group whose first account reached the shared row is counted in full", () => {
  const pools = {};
  for (const [k, pool] of Object.entries(ENG.POOLS)) pools[k] = { byLabel: new Map(), free: [...pool.rows], shared: [] };
  for (let i = 0; i < 24; i++) S.resolvePool(pools, "IS:OD", `Expense ${i}`);
  S.resolvePool(pools, "IS:OD", "Staff Party");
  let r;
  for (const l of ["Butane", "Electricity", "Garbage", "Internet"]) r = S.resolvePool(pools, "IS:OD", l, "Utilities");
  assert.strictEqual(r.relabel, "Other (5 accounts — see Attached schedules)");
  assert.deepStrictEqual(S.sharedPoolCaptions(pools, "IS:OD"), ["Staff Party", "Butane", "Electricity", "Garbage", "Internet"]);
  assert.ok(dist.includes("/*EN9POOLCOUNT*/"));
});

/* ---- dividends ---- */
const c = (label, value, field = "eoy") => ({ label, value, field, docId: "d", docName: "d", via: "rule" });
const ent = (extra = {}) => Object.assign(S.makeEntity("BLUE WATER GRILL LTD", "Catherine F. Mancuso"), extra);
const BWG_EQ = { "BS:61": [c("Net Income", 238699.7), c("Dividends", -728941.18), c("Retained Earnings", 824781.28)] };
const dDist = new Function("EN9r2", dist.slice(dist.indexOf("function EN9eqDivLine(t){"), dist.indexOf("\n", dist.indexOf("function EN9eqDivLine(t){"))) + ";return EN9eqDivLine;")((x) => Math.round(x * 100) / 100);

t("the year's dividend is the account's movement when the books are unclosed", () => {
  const e = ent({ contributions: BWG_EQ, lines: { "BS:61": { boy: 448784, eoy: 334539.8 } } });
  const d = S.equityDividendLine(e);
  assert.strictEqual(d.amount, 352943.9);
  assert.strictEqual(d.opening, 375997.28);
  assert.strictEqual(d.closing, 728941.18);
  assert.deepStrictEqual(dDist(e), d);
  // The statements' own prior-year column wins when printed.
  const e2 = ent({ contributions: { "BS:61": [...BWG_EQ["BS:61"], c("Dividends", -376000, "boy")] }, lines: {} });
  assert.strictEqual(S.equityDividendLine(e2).amount, 352941.18);
  assert.deepStrictEqual(dDist(e2), S.equityDividendLine(e2));
  // No prior figure: the whole balance, as before.
  const e3 = ent({ contributions: BWG_EQ, lines: {} });
  assert.deepStrictEqual(S.equityDividendLine(e3), { amount: 728941.18, label: "Dividends", addsToEquity: false });
  assert.deepStrictEqual(dDist(e3), S.equityDividendLine(e3));
});

const holders = (names, us) => ({
  shareholders: names.map(([name, n], i) => ({ id: "h" + i, name, classOfShares: "COMMON", boy: n, eoy: n })),
  usShareholders: us.map(([name, n], i) => ({ id: "u" + i, name, classOfShares: "COMMON", boy: n, eoy: n })),
});
const dSplit = (() => {
  const b = block("/*EN9DISTSPLIT-BEGIN*/", "/*EN9DISTSPLIT-END*/");
  return new Function("EN9r2", "EN9samePerson", "EN9filerShare", b + ";return {split:EN9distSplit,share:EN9divShare};")(
    (x) => Math.round(x * 100) / 100,
    (a, b2) => { const p = (n) => String(n || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1); const x = p(a), y = p(b2); return x.length >= 2 && y.length >= 2 && x[0] === y[0] && x[x.length - 1] === y[y.length - 1]; },
    (e) => { const p = Number(e.ownership.ownEnd || e.ownership.ownStart || 0); return p > 0 && p < 100 ? p / 100 : 1; });
})();

t("a distribution splits by direct holding only when every holder is a U.S. shareholder", () => {
  const both = [["CATHERINE MANCUSO", 150], ["DONALD R MCBRIDE", 150]];
  const e = ent(holders(both, both));
  const parts = S.distributionSplit(e, 352941.18);
  assert.deepStrictEqual(parts.map((p) => [p.name, p.amount]), [["CATHERINE MANCUSO", 176470.59], ["DONALD R MCBRIDE", 176470.59]]);
  assert.deepStrictEqual(dSplit.split(e, 352941.18), parts);
  const odd = S.distributionSplit(e, 0.03);
  assert.strictEqual(odd.reduce((n, p) => n + p.amount, 0).toFixed(2), "0.03", "the last holder takes the rounding");
  const foreign = ent(holders([["JOYCE LANGAN", 40], ["A UK HOLDER", 60]], [["JOYCE LANGAN", 40]]));
  assert.strictEqual(S.distributionSplit(foreign, 70000), null);
  assert.strictEqual(dSplit.split(foreign, 70000), null);
  assert.strictEqual(S.distributionSplit(ent(holders([["ONE OWNER", 100]], [["ONE OWNER", 100]])), 5), null);
});

t("Schedule R, M, J, Q and H from one Mancuso-shaped entity", async () => {
  const both = [["CATHERINE MANCUSO", 150], ["DONALD R MCBRIDE", 150]];
  const e = ent(Object.assign(holders(both, both), {
    contributions: Object.assign({}, BWG_EQ, { "IS:38": [c("Donations", 1419.16, "amount")] }),
    lines: { "BS:61": { boy: 448784, eoy: 334539.8 }, "IS:7": { amount: 4058232.5 }, "IS:11": { amount: 1958153.64 }, "IS:26": { amount: 899920.74 }, "IS:27": { amount: 129154.12 }, "IS:38": { amount: 761285.23 }, "IS:62": { amount: 71019.07 } },
  }));
  e.profile.clientName = "CATHERINE F. MANCUSO"; e.profile.cyEnd = "12/31/24"; e.profile.currency = "BZD";
  e.fx = { avgRate: "2", cyRate: "2", pyRate: "2" }; e.ownership.ownEnd = "100";
  const items = [];
  const real = global.fetch; global.fetch = async () => { throw new Error("offline"); };
  let out;
  try {
    out = await S.materializeCaseWrites(e, { caseYears: { cy: 2024, py: 2023 }, equity: null, ato: {}, cf: null, cfSource: "", ledger: null, questionnaire: null, salary: null, rv: (i) => items.push(i) });
  } finally { global.fetch = real; }
  const W = (sh, ref) => (out.list.find((w) => w.sheet === sh && w.ref === ref) || {}).value;
  assert.strictEqual(W("Schedule R", "G10"), 176471.95);
  assert.strictEqual(W("Schedule R", "G11"), 176471.95);
  assert.match(String(W("Schedule R", "B11")), /DONALD R MCBRIDE/);
  assert.strictEqual(W("Schedule J", "F33"), -352943.9);
  assert.strictEqual(W("Schedule M", "E32"), Math.round(352943.9 * 0.5 / 2), "the filer's direct half, not the attributed 100%");
  // Schedule Q is taken from the lines when the workbook is built, so a remap
  // made after processing reaches it.
  assert.strictEqual(W("Schedule Q", "H57"), undefined);
  const q = S.buildWrites(e)["Schedule Q"];
  assert.deepStrictEqual([q.H57, q.J57, q.X57], [2100078.86, 1790360.09, 71019.07]);
  const moved = Object.assign({}, e, { lines: Object.assign({}, e.lines, { "IS:62": { amount: 0 }, "IS:32": { amount: 71019.07 } }) });
  const q2 = S.buildWrites(moved)["Schedule Q"];
  assert.deepStrictEqual([q2.J57, q2.X57], [1861379.16, 0], "line 16 is a deduction, not an income tax");
  assert.strictEqual(W("Sch - H", "E21"), undefined, "the add-back is offered, not written");
  assert.strictEqual(items.find((i) => i.id === "schh-nondeductible").suggestedValue, 1419.16);
  const ids = items.map((i) => i.id);
  for (const id of ["dividend-from-equity-line", "sch-r-split", "hte-candidate", "schh-nondeductible", "schq-figures"]) assert.ok(ids.includes(id), id);
  assert.match(items.find((i) => i.id === "dividend-from-equity-line").message, /opened the year at 375,997\.28/);
  assert.match(items.find((i) => i.id === "hte-candidate").message, /22\.93%/);
});

t("dist carries every piece of this round", () => {
  for (const s of ["/*EN9CASHSIDE*/", "/*EN9CLOSEBACK*/", "/*EN9GCHAIN*/", "/*EN9GROUPHEAD-BEGIN*/", "/*EN9CAPQ-BEGIN*/", "/*EN9REMAPANS*/",
                   "/*EN9BOYALIGN-BEGIN*/", "/*EN9DIVMOVE*/", "/*EN9DIVMOVEMSG*/", "/*EN9SCHRSPLIT*/", "/*EN9SPLITEDIT*/", "/*EN9SCHQFIG-BEGIN*/",
                   "/*EN9SCHHND-BEGIN*/", "/*EN9HTE-BEGIN*/", "/*EN9SCHQLATE*/", "/*EN9SCHHNDWRITE*/", "/*EN9HEADAFTER*/", "/*EN9RULEV15A*/", "/*EN9RULEV15B*/", "/*EN9RULEV15C*/", "/*EN9RULEV15D*/"]) {
    assert.ok(dist.includes(s), s);
  }
  assert.ok(dist.includes('id:"business-tax-question-"+nk,level:"block"'));
  assert.ok(dist.includes('group-compensation-'));
  // The workbook still receives no formula but the one constant =B11.
  assert.ok(!dist.includes("/*EN9SCHQFML*/"));
});

Promise.all(pending).then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
