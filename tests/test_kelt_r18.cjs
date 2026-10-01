/* Jacob Kelt / SHORI CORPORATION, gaps 5-16 (round 18).
 *
 *   - A plain "Exchange gain or loss" is Schedule C line 8a (only a caption
 *     saying "realised" is 8b), and a saved catalogue is moved.
 *   - The statement's own sub-groups ("Credit Cards", "7300 Advertising
 *     expense") share one template row; zero balances take none.
 *   - The prior return's PTEP / (b)-(d) columns open Schedule J.
 *   - A whole-dollar rounding gap on Schedule F is named, with its fix.
 *   - One exchange rate: the retained-earnings residual is an equity
 *     movement, never "translation".
 *   - Filer categories are ticked "X"; Schedule Q names the books.
 */
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
const ENG = load("src/prototype/wp/engine.ts");
const S = load("src/prototype/wp/store.ts");
const SECT = load("src/prototype/wp/sections.ts");
const CF = load("src/prototype/wp/carryForward.ts");
const SRCH = require("./fixtures/harness_src.cjs");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const src = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
const block = (b, e) => { const i = dist.indexOf(b), j = dist.indexOf(e); assert.ok(i > 0 && j > i, b); return dist.slice(i + b.length, j); };
const clone = (x) => JSON.parse(JSON.stringify(x));

t("exchange gain or loss is line 8a; a realised one is 8b", () => {
  const R = ENG.DEFAULT_RULES;
  assert.strictEqual(ENG.matchRuleScoped("8150 Exchange gain or loss", R, "IS"), "IS:19");
  assert.strictEqual(ENG.matchRuleScoped("Unrealized exchange loss", R, "IS"), "IS:19");
  assert.strictEqual(ENG.matchRuleScoped("Realized exchange gain", R, "IS"), "IS:20");
  assert.ok(S.RULE_CATALOGUE_VERSION >= 14);
  const v13 = clone(R).map((r) => r.t === "IS:19" && r.kw.includes("exchange gain")
    ? { t: "IS:19", kw: r.kw.filter((k) => k !== "exchange gain" && k !== "exchange loss") }
    : r.t === "IS:20" ? { t: "IS:20", kw: [...r.kw, "exchange gain", "exchange loss"] } : r);
  assert.strictEqual(ENG.matchRuleScoped("8150 Exchange gain or loss", v13, "IS"), "IS:20", "fixture is v13");
  const up = S.upgradeRules(v13, 13);
  assert.strictEqual(ENG.matchRuleScoped("8150 Exchange gain or loss", up, "IS"), "IS:19");
  assert.strictEqual(ENG.matchRuleScoped("Realized exchange gain", up, "IS"), "IS:20");
  assert.ok(/var EN9RULEVER=1[4-9];/.test(dist) && dist.includes('13:[{kw:["exchange gain","exchange loss"],from:"IS:20",to:"IS:19"}]'));
});

/* The real SHORI row geometry, through both trees' grouping pass. */
const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "shori_rows.json"), "utf8"));
const rowsOf = (raw) => SRCH.toRows(raw, { feedOf: () => "is", sectionOf: () => null, docName: "d" });
const DGROUP = new Function("EN9TOTALW", "EN9SECTB", "EN9bk",
  "function EN9indentOf(t){return t&&typeof t.x0==\"number\"?Math.round(t.x0*10)/10:0}\nfunction EN9amtOf(t){var e=t&&t.row&&t.row.values;return e&&e.length?e[e.length-1]:null}\n"
  + block("/*EN9GROUPS-BEGIN*/", "/*EN9GROUPS-END*/") + ";return EN9tagGroups;");

t("the statement's own groups are found, section headings are not", () => {
  const bs = SECT.tagStatementGroups(SECT.structRows(rowsOf(RAW.bs)));
  const g = (l) => (bs.find((m) => m.row.label === l) || {}).group;
  assert.strictEqual(g("2011 Chase Credit card (6669)"), "Credit Cards");
  assert.strictEqual(g("2034 Amex Gold 1008"), "Credit Cards");
  assert.strictEqual(g("2150 Deferred Revenue"), "Other Current Liabilities");
  assert.strictEqual(g("1004 Mercury Checking (7946)"), undefined, "\"Bank Accounts\" is a section heading");
  const pl = SECT.tagStatementGroups(SECT.structRows(rowsOf(RAW.pl)));
  const p = (l) => (pl.find((m) => m.row.label === l) || {}).group;
  assert.strictEqual(p("7310 Google Ads"), "7300 Advertising expense");
  assert.strictEqual(p("7300 Advertising expense"), "7300 Advertising expense", "the parent's own balance is in its group");
  assert.strictEqual(p("6792 Virtual Assistants"), "6790 Other Professional Fees");
  assert.strictEqual(p("6510 Software subscriptions"), undefined, "\"Expenses\" is a section, not a group");
});

t("dist finds the same groups", () => {
  const ti = dist.indexOf("EN9TOTALW=") + 10;
  const TOT = new Function("return " + dist.slice(ti, dist.indexOf("/i", ti + 1) + 2))();
  const SB = SRCH.BANNERS().SECTION_BANNERS;
  const tag = DGROUP(TOT, SB, (x) => String(x || "").trim().replace(/\s*:\s*$/, ""));
  for (const raw of [RAW.bs, RAW.pl]) {
    const a = SECT.tagStatementGroups(SECT.structRows(rowsOf(raw))).map((m) => m.group || null);
    const rows = SECT.structRows(rowsOf(raw)).map((m) => ({ ...m, EN9skip: m.skipReason, row: { ...m.row, EN9banner: m.row.isBanner } }));
    const b = tag(rows).map((m) => m.EN9group || null);
    assert.deepStrictEqual(b, a);
  }
});

t("a group shares one pool row and takes the group's caption from its second account", () => {
  const pools = {};
  for (const [k, p] of Object.entries(ENG.POOLS)) pools[k] = { byLabel: new Map(), free: [...p.rows], shared: [] };
  const a = S.resolvePool(pools, "BS:OCL", "2011 Chase Credit card (6669)", "Credit Cards");
  assert.deepStrictEqual(a, { target: "BS:48", relabel: "2011 Chase Credit card (6669)" });
  const b = S.resolvePool(pools, "BS:OCL", "2014 Chase Credit Card (1256)", "Credit Cards");
  assert.deepStrictEqual(b, { target: "BS:48", relabel: "Credit Cards" });
  const c = S.resolvePool(pools, "BS:OCL", "2150 Deferred Revenue", "Other Current Liabilities");
  assert.deepStrictEqual(c, { target: "BS:49", relabel: "2150 Deferred Revenue" });
  assert.ok(src.includes("if (!isOverride && POOLS[target] && routed.every((r) => !r.value)) continue;"), "zero balances take no row");
  assert.ok(dist.includes("/*EN9POOLZERO*/") && dist.includes("c_(S,J,F.row.label,F.EN9group)") && dist.includes("/*EN9GROUPCALL*/EN9tagGroups(a);"));
});

t("the prior return's PTEP and (b)-(d) columns are read by column, amounts by their right edge", () => {
  const row = (page, cells) => ({ page, y: 0, cells: cells.map(([text, x0, x1]) => ({ text, x0, x1 })) });
  const rows = [
    // Schedule J page 1: (a)-(d), and two figures glued in one cell.
    row(25, [["Important: Enter amounts", 40, 214], ["(a)", 320, 329], ["(b)", 399, 408], ["(c)", 478, 487], ["(d)", 557, 567], ["(e) Previously Taxed E&P", 604, 756]]),
    row(25, [["14", 44, 53], ["Balance at beginning of next year", 65, 279], ["-18582369. -16680312.", 292, 442]]),
    // Page 2: headings glued, a section number inside a heading, totals column (f).
    row(26, [["(iii) General section", 99, 180], ["(iv) Reclassified section 951A PTEP (v) Reclassified section 245A(d) PTEP", 210, 500], ["(vi) Section 965(a) PTEP", 511, 600], ["(vii) Section 965(b) PTEP", 647, 740]]),
    row(26, [["14", 44, 53], ["-2,416.", 558, 590]]),
    row(26, [["(e) Previously Taxed E&P", 248, 330], ["(f)", 666, 675]]),
    row(26, [["(viii) Section 951A PTEP", 104, 200], ["(ix) Section 245A(d) PTEP", 278, 380], ["(x) Section 951(a)(1)(A) PTEP", 442, 560]]),
    row(26, [["1a", 48, 53], ["9,321.", 154, 180], ["6,855.", 680, 706]]),
    row(26, [["14", 44, 53], ["9,321.", 154, 180], ["-3,302.", 673, 700]]),
  ];
  const num = (s) => { const m = /^\(?(-?[\d,]+(?:\.\d*)?)\)?$/.exec(String(s).trim()); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const DIST = new Function("Oa", block("/*EN9READPTEP-BEGIN*/", "/*EN9READPTEP-END*/") + ";return EN9readPtep;")(num);
  for (const [who, fn] of [["src", CF.readPriorPtep], ["dist", DIST]]) {
    const r = fn(rows);
    const v = Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.value]));
    assert.deepStrictEqual(v, { b: -16680312, vi: -2416, viii: 9321 }, who);
  }
  assert.ok(src.includes('viii: "AB"') && dist.includes("/*EN9PTEPWRITE*/") && dist.includes("/*EN9PTEPREAD*/"));
});

t("a whole-dollar rounding gap on Schedule F is named with its fix; a real imbalance is not called rounding", () => {
  const DIST = new Function("is", "Ce", block("/*EN9USDROUND-BEGIN*/", "/*EN9USDROUND-END*/") + ";return EN9usdRound;")(ENG.BS_LINES, { bs: "Balance Sheet" });
  const lines = { "BS:10": { eoy: 72882.56 }, "BS:46": { eoy: 61139.37 }, "BS:48": { eoy: 3120.32 }, "BS:49": { eoy: 6074.99 }, "BS:60": { eoy: 8573.4 }, "BS:61": { eoy: -6025.52 } };
  const a = S.usdRoundingGaps(lines, 1, 1);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].id, "usd-rounding-eoy");
  assert.ok(/out by 2 /.test(a[0].message) && /\+2/.test(a[0].message));
  const b = DIST({ lines, fx: { cyRate: "1", pyRate: "1" } });
  assert.deepStrictEqual(b.map((x) => [x.id, x.message]), a.map((x) => [x.id, x.message]));
  const broken = { ...lines, "BS:10": { eoy: 70000 } };
  assert.strictEqual(S.usdRoundingGaps(broken, 1, 1).length, 0);
});

t("one exchange rate: the retained-earnings residual is an equity movement, not translation", () => {
  assert.ok(src.includes('id: "re-equity-movement"') && src.includes('id === "re-equity-movement"'));
  assert.ok(/const residualCell = oneRate \? "F25" : "F24";/.test(src));
  assert.ok(dist.includes("/*EN9EQMOVE*/") && dist.includes("/*EN9EQMOVEWRITE*/") && dist.includes("EN9ok||EN9brk||EN9one||o({id:\"re-translation-adjustment\""));
});

t("filer categories are ticked X; Schedule Q names the books", () => {
  assert.ok(src.includes('if (ent.categories[cat]) basic[cell] = "X";') && dist.includes('(e[A]=/*EN9CATX*/"X")'));
  assert.ok(src.includes("const unitName = booksName || ent.profile.legalName;") && dist.includes("/*EN9SCHQBOOKS*/"));
});

t("the opening column of a shared line is split by the prior return's statement", () => {
  assert.ok(src.includes("const split = cf.statementCaptions?.[key as keyof NonNullable<CarryForward[\"statementCaptions\"]>]?.lines;"));
  assert.ok(dist.includes("/*EN9BOYSPLIT-BEGIN*/") && dist.includes("/*EN9STMTLINES*/"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
