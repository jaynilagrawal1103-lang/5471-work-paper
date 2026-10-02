/* Round 25 — the mapping and UI audit's recommendations (2026-10-02).
 *
 *   mapping safety   a preparer's assignment outranks a total keyword and the
 *                    banner veto; an AI answer kept from an earlier pass is
 *                    replayed as the model's, with its confidence
 *   lexicon v20      accent-insensitive matching; DE/FR/NL/IT/PT/FI/ES
 *                    statutory captions; multilingual section routes
 *   policy profile   the firm's (and an entity's) answer for figures the rules
 *                    could place either way — every switch, src = dist
 *   notes            a creditors line booked through its note when the note
 *                    adds up to it; the detailed P&L by policy
 *   opening rate     the approved prior year-end rate first
 *   UI               generation through sign-off, assign scope, undo
 *
 * Captions and amounts are the documents' kind, invented unless noted.
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
const POL = load("src/prototype/wp/policy.ts");
const NB = load("src/prototype/wp/noteBreakdown.ts");
const STORE = load("src/prototype/wp/store.ts");
const SRC = (f) => fs.readFileSync(path.join(ROOT, "src", "prototype", "wp", f), "utf8");
const STORE_SRC = SRC("store.ts");
const DIST = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8");
const LAYER = fs.readFileSync(path.join(ROOT, "layer-src", "enhance.js"), "utf8");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/** A sentinel-delimited block of the shipped page, evaluated, returning `name`. */
function distBlock(tag, name) {
  const b = DIST.indexOf(`/*${tag}-BEGIN*/`), e = DIST.indexOf(`/*${tag}-END*/`);
  assert.ok(b > 0 && e > b, `dist carries ${tag}`);
  return new Function(DIST.slice(b, e) + `;return ${name};`)();
}
const DPOL = distBlock("EN9POLICY", "EN9POL");
const DNB = distBlock("EN9NOTEBREAK", "EN9NB");
const DROUTE = distBlock("EN9ROUTE20", "EN9sectionRoute");

/* ---------- mapping safety ---------- */
t("a preparer's assignment outranks a total keyword (M1) and the banner veto (M3)", () => {
  assert.ok(STORE_SRC.includes('if (target === "SKIP" && overrides[norm(m.row.label)] !== undefined) target = null;'));
  assert.ok(STORE_SRC.includes("if (target && m.section && ov === undefined && !sectionOk(m.section, target)) target = null;"));
  assert.ok(DIST.includes('/*EN9OVSKIP*/J==="SKIP"&&b[$h(F.row.label)]!==void 0&&(J=null)'));
  assert.ok(DIST.includes("j===void 0/*EN9MANUALNOVETO*/"));
});
t("figures read as totals are listed in Review, not dropped silently", () => {
  assert.ok(STORE_SRC.includes("id: `skipped-totals-${docId}`"));
  assert.ok(DIST.includes('/*EN9SKIPRV*/') && DIST.includes('"skipped-totals-"+EN9skd'));
});
t("an AI answer kept from an earlier pass replays as the model's, with its confidence (M21)", () => {
  assert.ok(/via = ov\.by === "ai" \? "groq" : "manual";/.test(STORE_SRC));
  assert.ok(STORE_SRC.includes('mapOverrides[key] = { to: p.t, by: "ai", confidence:'));
  assert.ok(DIST.includes('/*EN9AIORIGIN*/j.by==="ai"?"groq":"manual"'));
  assert.ok(DIST.includes('B[EN9k]={to:v.t,by:"ai",confidence:'));
});

/* ---------- lexicon v20 ---------- */
const R = ENG.DEFAULT_RULES;
const m = (l, sh) => ENG.matchRuleScoped(l, R, sh || null);
t("matching ignores accents both ways", () => {
  assert.strictEqual(ENG.foldAccents("Impôts et taxes"), "Impots et taxes");
  assert.strictEqual(m("Impôts et taxes", "IS"), "IS:32");
  assert.strictEqual(m("IMPOTS ET TAXES", "IS"), "IS:32");
  assert.strictEqual(m("Depreciacion acumulada", "BS"), "BS:29");
  assert.strictEqual(m("Préstamo bancario", "BS"), m("Prestamo bancario", "BS"));
});
t("statutory captions in seven languages reach their lines", () => {
  const cases = [
    ["Umsatzerlöse", "IS", "IS:7"], ["Löhne und Gehälter", "IS", "IS:26"], ["Zinsaufwand", "IS", "IS:29"],
    ["Steuern vom Einkommen und vom Ertrag", "IS", "IS:62"], ["Forderungen aus Lieferungen und Leistungen", "BS", "BS:11"],
    ["Verbindlichkeiten aus Lieferungen und Leistungen", "BS", "BS:46"], ["Gezeichnetes Kapital", "BS", "BS:59"], ["Kapitalrücklage", "BS", "BS:60"],
    ["Salaires et traitements", "IS", "IS:26"], ["Charges d'intérêts", "IS", "IS:29"], ["Disponibilités", "BS", "BS:10"],
    ["Vennootschapsbelasting", "IS", "IS:62"], ["Liquide middelen", "BS", "BS:10"], ["Crediteuren", "BS", "BS:46"],
    ["Receitas financeiras", "IS", "IS:15"], ["Estoques", "BS", "BS:14"], ["Interessi passivi", "IS", "IS:29"],
    ["Crediti verso clienti", "BS", "BS:11"], ["Henkilöstökulut", "IS", "IS:26"], ["Osakepääoma", "BS", "BS:59"],
    ["Ingresos por intereses", "IS", "IS:15"], ["Préstamos a socios", "BS", "BS:19"], ["Préstamos de socios", "BS", "BS:52"],
    ["Investments in subsidiaries", "BS", "BS:21"], ["Additional paid-in capital", "BS", "BS:60"], ["Allowance for doubtful accounts", "BS", "BS:12"],
    ["Realised foreign exchange loss", "IS", "IS:20"], ["Royalties paid", "IS", "IS:28"],
  ];
  for (const [cap, sh, want] of cases) assert.strictEqual(m(cap, sh), want, cap);
});
t("longer phrases still win: a cost-of-sales caption is not turnover, VAT is not turnover", () => {
  assert.strictEqual(m("Kostprijs van de omzet", "IS"), "IS:11");
  assert.strictEqual(m("Omzetbelasting", "BS"), "BS:OCL");
  assert.strictEqual(m("Anticipos de clientes", "BS"), "BS:OCL");
  assert.strictEqual(m("Common stock", "BS"), "BS:59");
});
t("the development caption set maps at least 95% (it was 71.4% before v20)", () => {
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "captions_dev.json"), "utf8"));
  const refOf = {};
  for (const l of ENG.IS_LINES) if (!refOf[`IS:${l.row}`]) refOf[`IS:${l.row}`] = l.ref;
  for (const l of ENG.BS_LINES) if (!refOf[`BS:${l.row}`]) refOf[`BS:${l.row}`] = l.ref;
  Object.assign(refOf, { "IS:OD": "17", "IS:OI": "9", "BS:OCA": "5", "BS:OCL": "16", "BS:OL": "19", "BS:OI": "8", "BS:OA": "13", "BS:39": "13" });
  const OK = { "Payroll taxes": ["16", "17"], "Charges sociales": ["11", "16", "17"], "Sociale lasten": ["11", "16", "17"], "Amortisation": ["14", "17"] };
  /* As the store sees a caption: the rules, then the banner's veto and route
     (the set records the line each caption belongs on, hence its section). */
  const SEC_IS = { "1a": "income", "1b": "income", "2": "cogs", "4": "otherIncome", "5": "otherIncome", "6a": "otherIncome", "6b": "otherIncome", "7": "otherIncome", "8a": "otherIncome", "8b": "otherIncome", "9": "otherIncome", "11": "costs", "12a": "costs", "12b": "costs", "13": "costs", "14": "costs", "16": "costs", "17": "costs" };
  const SEC_BS = { "1": "assets", "2a": "assets", "2b": "assets", "4": "assets", "5": "assets", "6": "assets", "7": "assets", "8": "assets", "9a": "fixedAssets", "9b": "fixedAssets", "11": "fixedAssets", "12a": "fixedAssets", "12c": "fixedAssets", "13": "assets", "15": "liabilities", "16": "liabilities", "18": "liabilities", "19": "termLiabilities", "20b": "equity", "21": "equity", "22": "equity", "23": "equity" };
  let good = 0;
  for (const [, sheet, cap, exp] of T) {
    const sec = (sheet === "IS" ? SEC_IS : SEC_BS)[exp] || null;
    let got = m(cap, sheet);
    if (got && got !== "SKIP" && sec && !SEC.sectionOk(sec, got)) got = null;
    if (!got && sec) got = SEC.sectionRoute(sec, cap);
    const ref = got ? String(refOf[got] || got).replace(/\s+/g, "") : null;
    if ((OK[cap] || [exp]).includes(ref)) good++;
  }
  assert.ok(good / T.length >= 0.95, `${good}/${T.length}`);
});
t("section routes speak every language, src = dist", () => {
  const cases = [
    ["costs", "Löhne"], ["costs", "Zinsen"], ["costs", "Impuestos municipales"], ["costs", "Körperschaftsteuer"], ["costs", "Miete Büro"],
    ["income", "Intereses ganados"], ["income", "Dividendos"], ["income", "Diferencia en cambio"], ["otherIncome", "Kursgewinne"],
    ["assets", "Clientes nacionales"], ["assets", "Mercaderías"], ["assets", "Provisión incobrables"], ["assets", "Caja chica"],
    ["liabilities", "Préstamo socio"], ["liabilities", "Loan"], ["liabilities", "Proveedores nacionales"], ["liabilities", "Sueldos por pagar"],
    ["equity", "Kapitalrücklage"], ["equity", "Capital social"], ["fixedAssets", "Terrenos"], ["fixedAssets", "Abschreibungen"],
    ["costs", "Payroll Expenses"], ["costs", "Tax preparation fees"],
  ];
  for (const [sec, cap] of cases) assert.strictEqual(DROUTE(sec, cap), SEC.sectionRoute(sec, cap), `${sec} · ${cap}`);
  assert.strictEqual(SEC.sectionRoute("costs", "Impuestos municipales"), "IS:32", "a tax that is not on income is line 16");
  assert.strictEqual(SEC.sectionRoute("costs", "Tax preparation fees"), "IS:OD");
  assert.strictEqual(SEC.sectionRoute("costs", "Payroll Expenses"), "IS:OD", "payroll as a cost stays where v4 put it");
  assert.strictEqual(SEC.sectionRoute("income", "Intereses ganados"), "IS:15", "interest inside revenue is not gross receipts");
  assert.strictEqual(SEC.sectionRoute("liabilities", "Loan"), "BS:OL", "a loan the caption does not tie to a shareholder is a borrowing");
  assert.strictEqual(SEC.sectionRoute("liabilities", "Préstamo socio"), "BS:52");
});
t("the catalogue is v20 in both trees and a v19 project receives the new groups", () => {
  assert.strictEqual(STORE.RULE_CATALOGUE_VERSION, 20);
  assert.ok(/var EN9RULEVER=20;/.test(DIST));
  const v19 = R.filter((r) => !r.kw.includes("umsatzerlöse") && !r.kw.includes("caja"));
  const up = STORE.upgradeRules(v19.map((r) => ({ t: r.t, kw: [...r.kw] })), 19);
  assert.strictEqual(ENG.matchRuleScoped("Umsatzerlöse", up, "IS"), "IS:7");
  assert.strictEqual(ENG.matchRuleScoped("Caja", up, "BS"), "BS:10");
});
t("a one-word hit in the original loses to a phrase in its English translation", () => {
  assert.ok(STORE_SRC.includes("directM.len <= 9") && STORE_SRC.includes("viaEn.len >= directM.len + 4"));
  assert.deepStrictEqual(ENG.matchRuleStrength("Intereses", R, null), { t: "IS:29", len: 9 });
  assert.ok(DIST.includes("/*EN9TRPREC*/") && DIST.includes("EN9ve.len>=EN9dl+4"));
});

/* ---------- policy profile ---------- */
const row = (label, extra) => ({ label, feed: "is", section: null, ...(extra || {}) });
t("an empty policy moves nothing", () => {
  for (const tg of ["IS:26", "IS:19", "IS:27", "IS:18", "BS:46", "BS:11", "BS:52", "BS:28", "BS:59", "IS:8"]) {
    assert.strictEqual(POL.policyTarget(tg, row("x"), {}), null, tg);
    assert.strictEqual(POL.policyNetReturns(tg, {}), null);
  }
  assert.ok(POL.isEmptyPolicy({}) && POL.isEmptyPolicy({ staffCosts: "compensation" }));
});
t("the entity's switch overrides the firm's; unset follows the firm", () => {
  assert.deepStrictEqual(POL.effectivePolicy({ fxLine: "realized", staffCosts: "other-deductions" }, { staffCosts: "compensation", fxLine: undefined }),
    { fxLine: "realized", staffCosts: "compensation" });
});
t("every switch, src = dist", () => {
  const P = {
    staffCosts: "owners-only", fxLine: "realized", cogsAsPrinted: true, shortTermCredit: "non-current", payables: "all-other-current-liabilities",
    sundryCreditors: "other-liabilities", advances: "receivables", shareholderLoans: "other-liabilities", equipmentRental: "other-deductions",
    capitalGains: "other-income", fixedAssets: "net-other-assets", netTradeBalances: true, shareCapital: "paid-in",
  };
  const cases = [
    ["IS:26", row("Wages")], ["IS:26", row("Wages - Heather Claycomb")], ["IS:26", row("Directors' salaries")], ["IS:26", row("Salaries", { ownerNames: ["Ann Bo Smith"] })],
    ["IS:26", row("Salary Smith", { ownerNames: ["Ann Bo Smith"] })], ["IS:19", row("Exchange loss")], ["IS:OD", row("4100 Freight and delivery - COS", { section: "cogs" })],
    ["BS:OCL", row("2016 Credit Card - 4340", { feed: "bs" })], ["BS:46", row("ACREEDORES VARIOS", { feed: "bs" })], ["BS:46", row("Trade creditors", { feed: "bs" })],
    ["BS:16", row("ANTIC. A TRABAJADORES", { feed: "bs" })], ["BS:52", row("Shareholder loan", { feed: "bs" })], ["IS:27", row("Equipment rental")],
    ["IS:27", row("Office rent")], ["IS:18", row("Loss on sale of fixed assets")], ["BS:28", row("Tangible assets", { feed: "bs" })],
    ["BS:29", row("Accumulated depreciation", { feed: "bs" })], ["BS:11", row("Debtors", { feed: "bs" })], ["BS:59", row("Share capital", { feed: "bs" })],
  ];
  for (const [tg, r] of cases) assert.deepStrictEqual(DPOL.policyTarget(tg, r, P), POL.policyTarget(tg, r, P), `${tg} · ${r.label}`);
  assert.deepStrictEqual(DPOL.policyNetReturns("IS:8", { salesReturns: "net-in-1a" }), POL.policyNetReturns("IS:8", { salesReturns: "net-in-1a" }));
  assert.strictEqual(DPOL.describePolicy(P), POL.describePolicy(P));
});
t("what each switch does", () => {
  const go = (tg, r, p) => (POL.policyTarget(tg, r, p) || { target: tg }).target;
  assert.strictEqual(go("IS:26", row("Wages"), { staffCosts: "other-deductions" }), "IS:OD");
  assert.strictEqual(go("IS:26", row("Wages - Heather Claycomb"), { staffCosts: "owners-only" }), "IS:26", "a named person's pay is the owner's");
  assert.strictEqual(go("IS:26", row("Wages"), { staffCosts: "owners-only" }), "IS:OD");
  assert.strictEqual(go("IS:19", row("FX loss"), { fxLine: "realized" }), "IS:20");
  assert.strictEqual(go("IS:OD", row("Freight", { section: "cogs" }), { cogsAsPrinted: true }), "IS:12");
  assert.strictEqual(go("IS:OD", row("Freight", { section: "costs" }), { cogsAsPrinted: true }), "IS:OD", "only what the statement files under cost of sales");
  assert.strictEqual(go("BS:OCL", row("Amex Gold 1008", { feed: "bs" }), { shortTermCredit: "non-current" }), "BS:OL");
  assert.strictEqual(go("BS:OCL", row("Accrued wages", { feed: "bs" }), { shortTermCredit: "non-current" }), "BS:OCL");
  assert.strictEqual(go("BS:46", row("Acreedores varios", { feed: "bs" }), { sundryCreditors: "other-liabilities" }), "BS:OL");
  assert.strictEqual(go("BS:OCL", row("Taxes payable", { feed: "bs" }), { payables: "all-accounts-payable" }), "BS:46");
  assert.strictEqual(go("BS:16", row("Antic. imptos y contrib.", { feed: "bs" }), { advances: "receivables" }), "BS:11");
  assert.strictEqual(go("BS:52", row("Due to shareholder", { feed: "bs" }), { shareholderLoans: "other-liabilities" }), "BS:OL");
  assert.strictEqual(go("IS:27", row("Equipment rental"), { equipmentRental: "other-deductions" }), "IS:OD");
  assert.strictEqual(go("IS:27", row("Rent"), { equipmentRental: "other-deductions" }), "IS:27");
  assert.strictEqual(go("IS:18", row("Loss on sale"), { capitalGains: "other-income" }), "IS:OI");
  assert.strictEqual(go("BS:28", row("Plant", { feed: "bs" }), { fixedAssets: "net-other-assets" }), "BS:39");
  assert.deepStrictEqual(POL.policyTarget("BS:46", row("Creditors", { feed: "bs" }), { netTradeBalances: true }),
    { target: "BS:OCA", rule: "trade creditors netted into other current assets", group: "Trade debtors less trade creditors", sign: -1 });
  assert.strictEqual(go("BS:59", row("Share capital", { feed: "bs" }), { shareCapital: "paid-in" }), "BS:60");
  assert.deepStrictEqual(POL.policyNetReturns("IS:8", { salesReturns: "net-in-1a" }).target, "IS:7");
});
t("the store applies the policy after the rules, never to an assignment, and says so", () => {
  assert.ok(STORE_SRC.includes("if (target && ov === undefined) {\n            const mv = policyTarget("));
  assert.ok(STORE_SRC.includes("...(polRule ? { policy: polRule } : {}),"));
  assert.ok(STORE_SRC.includes("Moved by the mapping policy: ${c.policy}."));
  assert.ok(STORE_SRC.includes('w({ sheet: SHEET.is, ref: "F65", value: "=F64"'));
  for (const s of ["/*EN9POLDECL*/", "/*EN9POLMAP*/", "/*EN9POLRET*/", "/*EN9POLNOTE*/", "/*EN9POLOCI*/", "/*EN9POLACT*/", "/*EN9POLDETAIL*/"]) assert.ok(DIST.includes(s), s);
  assert.ok(typeof STORE.actions.setMappingPolicy === "function" && typeof STORE.actions.setEntityMappingPolicy === "function");
});
t("line 23a reaches the workbook as a formula, not as the text \"=F64\"", () => {
  // The shipped cell writer only turns whitelisted references into formulas.
  const i = DIST.indexOf("/*EN9CELLREF*/"), fn = DIST.lastIndexOf("function a8(", i);
  const body = DIST.slice(fn, DIST.indexOf("var A8=", i));
  const a8 = new Function("iF", body + ";return a8;")((x) => x);
  assert.strictEqual(a8("F65", "=F64", "7"), '<c r="F65" s="7"><f>F64</f></c>');
  const XP = load("src/prototype/wp/xlsxPatch.ts");
  assert.ok(XP.setCell('<worksheet><sheetData><row r="65"></row></sheetData></worksheet>', "F65", "=F64").includes("<f>F64</f>"));
});
t("the firm and entity policy are set from the store actions", () => {
  STORE.actions.setMappingPolicy({ fxLine: "realized" });
  assert.deepStrictEqual(STORE.getSnapshot().mappingPolicy, { fxLine: "realized" });
  STORE.actions.setMappingPolicy({ fxLine: undefined });
  assert.deepStrictEqual(STORE.getSnapshot().mappingPolicy, {});
  const id = STORE.getSnapshot().entities[0].id;
  STORE.actions.setEntityMappingPolicy(id, { staffCosts: "other-deductions" });
  assert.deepStrictEqual(STORE.getSnapshot().entities[0].mappingPolicy, { staffCosts: "other-deductions" });
});

/* ---------- notes and detail ---------- */
const NOTE = [
  { label: "6 Creditors: amounts falling due within one year", values: [], page: 9 },
  { label: "Obligations under finance leases and hire purchase contracts", values: [4835, 6335], years: [2024, 2023], page: 9 },
  { label: "Taxes and social security", values: [2908, 3532], years: [2024, 2023], page: 9 },
  { label: "Other creditors", values: [2550, 4042], years: [2024, 2023], page: 9 },
  { label: "Loans from directors", values: [7362], years: [2024], page: 9 },
  { label: "Accruals", values: [200, 200], years: [2024, 2023], page: 9 },
  { label: "", values: [17855, 14109], years: [2024, 2023], page: 9 },
];
t("a creditors line is booked through its note when the note adds up to it (src = dist)", () => {
  const face = [{ label: "Debtors", values: [15231, 14472], years: [2024, 2023] }, { label: "Creditors: amounts falling due within one year", values: [17855, 14109], years: [2024, 2023] }];
  const out = NB.liabilityNoteBreakdown(NOTE, face);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].faceIndex, 1);
  assert.deepStrictEqual(out[0].components.map((c) => c.label), NOTE.slice(1, 6).map((c) => c.label));
  assert.deepStrictEqual(DNB.liabilityNoteBreakdown(NOTE, face), out);
  // The components map to their own lines.
  assert.strictEqual(m("Other creditors", "BS"), "BS:46");
  assert.strictEqual(m("Loans from directors", "BS"), "BS:52");
});
t("a numbered note title the reader did not keep as a row: the page names the caption and both years add up", () => {
  const rows = NOTE.slice(1, 6).map((r) => ({ label: r.label, values: r.values, page: 9 }));   // no heading, no year tags
  const face = [{ label: "Creditors: amounts falling due within one year", values: [6, -17855, -14109], years: [null, 2024, 2023] }];
  const out = NB.liabilityNoteBreakdown(rows, face, { 9: "6 Creditors: amounts falling due within one year 2024 2023 £ £ Obligations under finance leases" });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].components.length, 5);
  assert.deepStrictEqual(DNB.liabilityNoteBreakdown(rows, face, { 9: "6 Creditors: amounts falling due within one year" }).length, 1);
  assert.strictEqual(NB.liabilityNoteBreakdown(rows, face, { 9: "Debtors" }).length, 0, "the page must name the caption");
  assert.ok(STORE_SRC.includes("hostYears.slice(0, (c.values || []).length)"), "components take the face row's years");
  assert.ok(STORE_SRC.includes('if (target === "BS:OL" && m.section === "liabilities" && /\\b(finance\\s+leases?|hire\\s+purchase|leasing)\\b/i'), "a lease due within one year is current");
  assert.ok(DIST.includes("/*EN9LEASECUR*/"));
});
t("a note that does not add up, or a debtors note, leaves the face row alone", () => {
  const bad = NOTE.map((r) => (r.label === "Accruals" ? { ...r, values: [999, 200] } : r));
  assert.strictEqual(NB.liabilityNoteBreakdown(bad, [{ label: "Creditors: amounts falling due within one year", values: [17855, 14109], years: [2024, 2023] }]).length, 0);
  const deb = [{ label: "5 Debtors", values: [], page: 8 }, { label: "Trade debtors", values: [100, 9181], years: [2024, 2023], page: 8 }, { label: "Other debtors", values: [15131, 5291], years: [2024, 2023], page: 8 }];
  assert.strictEqual(NB.liabilityNoteBreakdown(deb, [{ label: "Debtors", values: [15231, 14472], years: [2024, 2023] }]).length, 0);
});
t("note components sit on the face caption's side: within one year is current", () => {
  const face = [{ label: "Creditors: amounts falling due within one year", values: [17855, 14109], years: [2024, 2023] }];
  const out = NB.liabilityNoteBreakdown(NOTE, face);
  assert.strictEqual(out[0].section, "liabilities");
  assert.strictEqual(DNB.liabilityNoteBreakdown(NOTE, face)[0].section, "liabilities");
  const long = NOTE.map((r, i) => (i === 0 ? { ...r, label: "7 Creditors: amounts falling due after more than one year" } : r));
  assert.strictEqual(NB.liabilityNoteBreakdown(long, [{ label: "Creditors: amounts falling due after more than one year", values: [17855, 14109], years: [2024, 2023] }])[0].section, "termLiabilities");
  // Under the current side the taxes and the accruals reach line 16, the lease too.
  assert.strictEqual(SEC.sectionRoute("liabilities", "Taxes and social security"), "BS:OCL");
  assert.strictEqual(SEC.sectionRoute("liabilities", "Accruals"), "BS:OCL");
  assert.ok(STORE_SRC.includes("...host, section: sp.section, row:"), "src parts carry the side");
  assert.ok(DIST.includes("{...host,section:sp.section,row:"), "dist parts carry the side");
});
t("a single tax balance whose note is a movement is never split (HMC)", () => {
  const rows = [
    { label: "Income Tax Payable", values: [], page: 12 },
    { label: "Opening Balance", values: [25000], years: [2024], page: 12 },
    { label: "Prior Period Tax (Paid)/Refunded", values: [5000], years: [2024], page: 12 },
    { label: "Resident Withholding Tax", values: [4467], years: [2024], page: 12 },
    { label: "Tax Payable at 28%", values: [5235], years: [2024], page: 12 },
  ];
  assert.strictEqual(NB.liabilityNoteBreakdown(rows, [{ label: "Income Tax Payable", values: [39702], years: [2024] }]).length, 0);
  assert.strictEqual(DNB.liabilityNoteBreakdown(rows, [{ label: "Income Tax Payable", values: [39702], years: [2024] }]).length, 0);
  // Not even under a plural caption: a run with an opening balance is a reconciliation.
  const r2 = rows.map((r, i) => (i === 0 ? { ...r, label: "Other payables" } : r));
  assert.strictEqual(NB.liabilityNoteBreakdown(r2, [{ label: "Other payables", values: [39702], years: [2024] }]).length, 0);
});
t("the detailed P&L is booked instead of the face when the policy asks for it", () => {
  const mk = (page, label, values, extra) => ({ row: { label, values, years: [2024, 2023], page, ...(extra || {}) }, feed: "is", docId: "d", docName: "d.pdf", kind: "pdf" });
  const rows = [
    mk(5, "Turnover", [64048, 77107]), mk(5, "Cost of sales", [11932, 6858]), mk(5, "Administrative expenses", [47090, 55367]), mk(5, "Tax on profit on ordinary activities", [2035, 4976]),
    mk(10, "Turnover", [], { isBanner: true }), mk(10, "Sales", [64048, 77107]),
    mk(10, "Cost of sales", [], { isBanner: true }), mk(10, "Purchases", [894, 328]), mk(10, "Other direct costs", [11038, 6530]),
    mk(10, "Administrative expenses", [], { isBanner: true }), mk(10, "Directors' salaries", [12450, 19300]), mk(10, "Rent", [8773, 6129]), mk(10, "Depreciation", [5684, 4529]), mk(10, "Sundry", [20183, 25409]),
  ];
  const face = SEC.supplementaryDetailPages(rows, new Set([10]));
  assert.ok(face.rows.every((r) => r.row.page !== 10), "default: the face is booked");
  const det = SEC.supplementaryDetailPages(rows, new Set([10]), true);
  const kept = det.rows.filter((r) => !r.skipReason && !r.row.isBanner).map((r) => r.row.label);
  assert.ok(kept.includes("Directors' salaries") && kept.includes("Rent") && kept.includes("Tax on profit on ordinary activities"), kept.join("|"));
  assert.ok(!kept.includes("Turnover") && !kept.includes("Administrative expenses"));
});

/* ---------- opening rate ---------- */
t("the approved prior year-end rate converts the filed USD (the sheet divides by it)", () => {
  assert.strictEqual(STORE.openingRateFor("AED", 3.673, null).rate, 3.673);
  assert.strictEqual(STORE.openingRateFor("AED", null, null).rate, 3.6725);
  assert.ok(DIST.includes("/*EN9OPENRATE20*/"));
});

/* ---------- UI ---------- */
t("every generate button goes through Review & sign-off (U2)", () => {
  for (const s of ["/*EN9GENGATE1*/", "/*EN9GENGATE2*/", "/*EN9GENGATE3*/", "/*EN9WPNAV*/"]) assert.ok(DIST.includes(s), s);
  assert.ok(!/children:"Generate this entity"/.test(DIST) && !/children:"Generate workbook"/.test(DIST));
  assert.ok(SRC("CoreViews.tsx").includes('onClick={() => onNavigate("signoff")}>Review &amp; generate</button>'));
  assert.ok(SRC("PreviewView.tsx").includes('onClick={() => onNavigate("signoff")}'));
});
t("assigning a caption learns a rule for every client only when asked (U9)", () => {
  assert.ok(STORE_SRC.includes("if (!opts?.remember) {"));
  assert.ok(DIST.includes("/*EN9ASSIGNSCOPE*/if(!(EN9ao&&EN9ao.remember))"));
  assert.ok(LAYER.includes("remember for every client"));
});
t("destructive actions confirm in the page and can be undone (U11, U14)", () => {
  const id = STORE.getSnapshot().entities[0].id;
  STORE.actions.takeSnapshot("test");
  STORE.actions.setField(id, "profile", "legalName", "CHANGED");
  assert.strictEqual(STORE.getSnapshot().entities[0].profile.legalName, "CHANGED");
  assert.strictEqual(STORE.actions.undoSnapshot(), "test");
  assert.notStrictEqual(STORE.getSnapshot().entities[0].profile.legalName, "CHANGED");
  assert.ok(DIST.includes("/*EN9UNDO*/takeSnapshot("));
  assert.ok(LAYER.includes("window.confirm=function(msg)") && LAYER.includes("function en9UndoBar("));
});
t("Restore takes back every write its sign-off made (U5)", () => {
  const st0 = STORE.getSnapshot();
  const sheetIs = (STORE.SHEET && STORE.SHEET.is) || "Income Statement";
  const e0 = st0.entities[0];
  const item = { id: "t-u5", level: "warn", category: "mapping", message: "check line 1a", target: `${sheetIs}!F7` };
  STORE.loadState({ ...st0, entities: [{ ...e0, lines: { "IS:7": { amount: 100 } }, reviewItems: [item], extraWrites: [] }, ...st0.entities.slice(1)] });
  const id = e0.id;
  STORE.actions.resubmitReviewItem(id, "t-u5", "150");
  assert.strictEqual(STORE.getSnapshot().entities[0].lines["IS:7"].amount, 150);
  STORE.actions.restoreReviewItem(id, "t-u5");
  assert.strictEqual(STORE.getSnapshot().entities[0].lines["IS:7"].amount, 100, "the staged line is reverted");
  // a sign-off that CREATES its writes: they go on Restore
  const tr = { id: "re-translation-adjustment", level: "warn", category: "fx", message: "residual" };
  STORE.loadState({ ...STORE.getSnapshot(), entities: [{ ...STORE.getSnapshot().entities[0], reviewItems: [tr], extraWrites: [] }] });
  STORE.actions.resubmitReviewItem(id, "re-translation-adjustment", "42");
  assert.strictEqual(STORE.getSnapshot().entities[0].extraWrites.length, 1);
  STORE.actions.restoreReviewItem(id, "re-translation-adjustment");
  assert.strictEqual(STORE.getSnapshot().entities[0].extraWrites.length, 0, "the created write is removed");
  assert.ok(DIST.includes("/*EN9RESTOREALL*/") && DIST.includes("/*EN9RESTOREW*/"));
});
t("the layer carries every v20 UI piece", () => {
  for (const s of ["function enhanceReviewActions(", "function enhanceBilingual(", "function enhanceA11y(", "function en9WhyLine(", "function enhancePolicyCards(", "en9IsIssueList(lg)"]) assert.ok(LAYER.includes(s), s);
  assert.ok(!LAYER.includes("$&"), "no replacement pattern that inject-layer could expand");
  assert.ok(DIST.includes("function enhanceA11y("), "the layer is injected");
});

/* The in-page confirmation is for a confirm() raised by a click only: code
   that confirms later (a run started by another script) keeps the native
   dialog — a stale click once made every re-process answer "no". */
(async () => {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM("<!doctype html><body><main><div class='view-stack'><button id='del'>Delete</button></div></main></body>", { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.confirm = () => true;                       // the native dialog says yes
  w.__WPGET = () => ({ entities: [], activeEntityId: null });
  w.requestAnimationFrame = (f) => setTimeout(f, 0);
  w.eval(LAYER);
  let viaClick = null;
  w.document.getElementById("del").addEventListener("click", () => { viaClick = w.confirm("Remove it?"); });
  w.document.getElementById("del").click();
  await new Promise((r) => setTimeout(r, 5));
  const later = w.confirm("Re-process?");
  t("a click's confirm() is asked in the page; a later confirm() keeps the native dialog", () => {
    assert.strictEqual(viaClick, false, "the click's handler waits for the in-page answer");
    assert.ok(w.document.querySelector(".en9-dlg"), "the in-page dialog is shown");
    assert.strictEqual(later, true, "code that confirms outside a click gets the native answer");
  });
  w.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);   // the layer's timers would keep jsdom alive
})();
