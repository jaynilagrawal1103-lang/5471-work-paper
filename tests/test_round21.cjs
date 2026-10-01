/* Round 21 — Premium Care Plastic Surgery (Colombian PUC statements) and the
 * audit fixes. Each check pins a general rule, not a client: the captions and
 * shapes are the documents', the amounts are invented unless noted.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const ENG = load("src/prototype/wp/engine.ts");
const SEC = load("src/prototype/wp/sections.ts");
const BAN = load("src/prototype/wp/sectionBanners.ts");
const STORE_SRC = fs.readFileSync(path.join(__dirname, "..", "src", "prototype", "wp", "store.ts"), "utf8");
const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");

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

const row = (label, value, page = 1, x0 = 40) => ({ row: { label, values: value === null ? [] : [value], page }, x0 });

/* ---------- a row the printed total leaves out ---------- */

const RECEIVABLES = () => [
  row("CLIENTES", 0),
  row("DEUDORES DEL SISTEMA", 0),
  row("DEUDORES", 826),
  row("ANTIC. A TRABAJADORES", 25),
  row("ANTIC. IMPTOS Y CONTRIB.", 609),
  row("OTROS", 0),
  row("TOTAL DEUDORES", 634),
];
const NET_PPE = () => [
  row("Equipment", 100),
  row("Vehicles", 50),
  row("Less accumulated depreciation", 75),
  row("Total fixed assets", 75),
];

t("the one row the printed total leaves out is excluded and named (src)", () => {
  const out = SEC.outsidePrintedTotal(RECEIVABLES());
  const deud = out.find((m) => m.row.label === "DEUDORES");
  assert.ok(/not part of the printed total/.test(deud.skipReason || ""), deud.skipReason);
  assert.strictEqual(deud.outsideTotal, "TOTAL DEUDORES");
  assert.ok(!out.find((m) => m.row.label === "ANTIC. IMPTOS Y CONTRIB.").skipReason);
});

t("a contra row printed positive is a sign question, never an excluded row (src)", () => {
  // 100 + 50 + 75 = 225; total 75 = 225 − 2×75: the depreciation subtracts.
  const out = SEC.outsidePrintedTotal(NET_PPE());
  assert.ok(out.every((m) => !m.outsideTotal), "nothing excluded");
});

t("a group that ties, or a nil total, is left alone (src)", () => {
  const ties = [row("A", 10), row("B", 20), row("C", 30), row("Total", 60)];
  assert.ok(SEC.outsidePrintedTotal(ties).every((m) => !m.outsideTotal));
  const nil = [row("A", 10), row("B", 20), row("C", 30), row("Total", 0)];
  assert.ok(SEC.outsidePrintedTotal(nil).every((m) => !m.outsideTotal));
});

t("dist EN9outsideTotal agrees with src on both shapes", () => {
  const helpers = ["EN9amtOf", "EN9same"].map(distFn).join("\n");
  const tw = /var EN9TOTALW=(\/[^\n]*?\/i);/.exec(DIST);
  assert.ok(tw, "dist EN9TOTALW");
  const fn = new Function(`var EN9TOTALW=${tw[1]};${helpers}\n${distFn("EN9outsideTotal")}\nreturn EN9outsideTotal;`)();
  const toDist = (rows) => rows.map((m) => ({ ...m, row: { ...m.row } }));
  const a = fn(toDist(RECEIVABLES()));
  assert.strictEqual(a.find((m) => m.row.label === "DEUDORES").EN9outsideTotal, "TOTAL DEUDORES");
  assert.ok(fn(toDist(NET_PPE())).every((m) => !m.EN9outsideTotal));
  assert.ok(DIST.includes("/*EN9OUTTOTAL-CALL*/") && DIST.includes("/*EN9OUTTOTALRV*/") && DIST.includes("outside-total-"));
  assert.ok(STORE_SRC.includes("outsidePrintedTotal(pdfBs)") && STORE_SRC.includes("outside-total-"));
});

/* ---------- contra-asset lines are negative ---------- */

t("Schedule F contra lines (2b, 9b, 10b, 12d) are booked negative in both trees", () => {
  assert.ok(/CONTRA_ASSET_LINES = new Map<string, string>\(\[\["BS:12", "2b"\], \["BS:29", "9b"\], \["BS:31", "10b"\], \["BS:37", "12d"\]\]\)/.test(STORE_SRC));
  assert.ok(STORE_SRC.includes("contra-asset-${target}"));
  assert.ok(DIST.includes('var EN9CONTRAL={"BS:12":"2b","BS:29":"9b","BS:31":"10b","BS:37":"12d"}'));
  assert.ok(DIST.includes("/*EN9CONTRAASSET*/") && DIST.includes("contra-asset-${J}"));
});

/* ---------- Colombian PUC vocabulary ---------- */

t("PUC expense and income headings are section banners", () => {
  const sec = (s) => { const hit = BAN.SECTION_BANNERS.find(([re]) => re.test(s)); return hit && hit[1]; };
  assert.strictEqual(sec("GASTOS OPERACIONALES DE ADMINISTRACION"), "costs");
  assert.strictEqual(sec("GASTOS OPERACIONALES DE VENTA"), "costs");
  assert.strictEqual(sec("Menos: GASTOS NO OPERACIONALES"), "costs");
  assert.strictEqual(sec("Mas: ING. NO OPERACIONALES"), "otherIncome");
  assert.strictEqual(sec("Menos: COSTOS DE ACTIVIDADES"), "cogs");
});

t("PUC captions map: advances, payroll liabilities, income tax; sundry creditors stay payables", () => {
  const m = (s) => ENG.matchRule(s, ENG.DEFAULT_RULES);
  assert.strictEqual(m("ANTIC. A TRABAJADORES"), "BS:OCA");
  assert.strictEqual(m("CESANTIAS CONSOLIDADAS"), "BS:OCL");
  assert.strictEqual(m("ANTICIPO DE CLIENTES"), "BS:OCL");
  assert.strictEqual(m("ACREEDORES VARIOS"), "BS:46");
  assert.strictEqual(m("ACREEDORES DIVERSOS"), "BS:46");
  assert.strictEqual(m("VACACIONES CONSOLIDAS"), "BS:OCL");
  assert.strictEqual(m("ACREEDORES"), "BS:46");
  assert.strictEqual(m("PROVEEDORES"), "BS:46");
  assert.strictEqual(m("(-) IMPTO DE RENTA Y COMPL."), "IS:62");
  assert.strictEqual(m("RESULTADO BRUTO OPERAC."), "SKIP");
  assert.ok(!DIST.includes('"acreedores varios"'));
});

/* ---------- a hidden cents column and run-together figures ---------- */

t("two figures run together in one cell are never read as one number", () => {
  assert.strictEqual(ENG.numericCell({ text: "0 21,170,247.42", x0: 400, x1: 470 }), null);
  assert.ok(DIST.includes("/*EN9MULTITOK*/") && DIST.includes("/*EN9STRAYCOL*/"));
});

t("a prior return's run-together columns are still read figure by figure", () => {
  // "-18582369. -16680312." is Schedule J line 14 columns (a) and (b) in one
  // cell; refusing the cell as one number must not lose both figures.
  const CF = fs.readFileSync(path.join(__dirname, "..", "src", "prototype", "wp", "carryForward.ts"), "utf8");
  assert.ok(/function cellNums\(/.test(CF) && /let nums = cellNums\(r\.cells\.slice\(i \+ 1\)\);/.test(CF));
  assert.ok(/figureCells\(r\.cells\.slice\(i \+ 1\)\)/.test(CF));
  assert.ok(DIST.includes("/*EN9CFNUMS-BEGIN*/") && DIST.includes("let r=/*EN9CFNUMS*/EN9cfNums(s.cells.slice(n+1))"));
  assert.ok(DIST.includes("EN9cfCells(r.cells.slice(n+1)).forEach"));
});

t("a company name is never an address, and a figure is never an activity", () => {
  const S = load("src/prototype/wp/store.ts");
  const ent = { name: "Entity 1", profile: {}, docClasses: {} };
  assert.ok(S.isCompanyNameNotAddress("PREMIUM CARE PLASTIC SURGERY SAS", ent));
  assert.ok(S.isCompanyNameNotAddress("Blue Water Grill Ltd.", ent));
  assert.ok(!S.isCompanyNameNotAddress("Bocagrande, Carrera 3 No 4-21 of 302, Ed Cibeles", ent));
  assert.ok(!S.isCompanyNameNotAddress("Cartagena 30205 Colombia", ent));
  assert.ok(S.isCompanyNameNotAddress("Acme Trading", { name: "Entity 1", profile: { legalName: "Acme Trading" }, docClasses: {} }));
  assert.ok(DIST.includes("/*EN9ADDRNOTNAME*/") && DIST.includes("/*EN9ADDRNOTNAME-BEGIN*/"));
  const DP = load("src/prototype/wp/detectProfile.ts");
  assert.ok(fs.readFileSync(path.join(__dirname, "..", "src", "prototype", "wp", "detectProfile.ts"), "utf8").includes("WORD_FIELDS.has(m.key)"));
  assert.ok(DIST.includes("/*EN9WORDFLD*/"));
  assert.ok(DP);
});

t("an unnamed entity with no prior return takes the legal name its statements print", () => {
  assert.ok(STORE_SRC.includes("legal-name-from-statements-${entityId}") && STORE_SRC.includes("LEGAL_FORM.test(docCompanies[0].nm.trim())"));
  assert.ok(DIST.includes("/*EN9LEGALFROMSTMT*/") && DIST.includes('"legal-name-from-statements-"+t'));
});

/* ---------- the opening balance read from the balance sheet ---------- */

t("no prior return: opening E&P and retained earnings come from the earnings brought forward", () => {
  assert.ok(STORE_SRC.includes('id: "book-opening-ep"') && STORE_SRC.includes("replaceFormula: true"));
  assert.ok(DIST.includes("/*EN9BOOKOPEN-BEGIN*/") && DIST.includes('reviewId:"book-opening-ep",replaceFormula:!0'));
  assert.ok(DIST.includes("/*EN9FMLFORCE*/"), "generation lets that one write replace the template formula");
});

/* ---------- tie-out diagnostics ---------- */

t("a P&L that does not tie names the booked row that explains it", () => {
  const S = load("src/prototype/wp/store.ts");
  const ent = { contributions: { "IS:26": [{ label: "Wages", value: 500, field: "amount" }], "IS:OD": [{ label: "Rent", value: 120, field: "amount" }] } };
  const twice = S.tieSuspects(ent, -500);
  assert.ok(twice.length === 1 && /Wages/.test(twice[0]) && /booked twice/.test(twice[0]), twice.join(" | "));
  const sign = S.tieSuspects(ent, 240);
  assert.ok(sign.length === 1 && /Rent/.test(sign[0]) && /wrong sign/.test(sign[0]), sign.join(" | "));
  assert.deepStrictEqual(S.tieSuspects(ent, 7), []);
  assert.ok(DIST.includes("/*EN9TIESUSP-BEGIN*/") && DIST.includes("Booked row(s) that alone explain the difference"));
});

t("Schedule F out of balance names the line that alone explains it (src and dist)", () => {
  const S = load("src/prototype/wp/store.ts");
  const lines = { "BS:10": { boy: 100 }, "BS:46": { boy: 40 }, "BS:61": { boy: 30 } };
  const b = S.bsBalance(lines, "boy");
  assert.strictEqual(b.diff, 30);
  assert.ok(/Retained earnings|line 22/.test(S.bsSuspectText(lines, "boy", b.diff)), S.bsSuspectText(lines, "boy", b.diff));
  assert.ok(STORE_SRC.includes('id: "EN9-tie-bs-boy"') && STORE_SRC.includes('id: "EN9-tie-bs-eoy"'));
  assert.ok(DIST.includes("/*EN9BSSUSP-BEGIN*/") && DIST.includes('EN9bsSuspectText(t,"boy",s.diff)'));
});

/* ---------- the AI model list ---------- */

t("the retired Groq models are gone from both trees and a saved one is migrated", () => {
  assert.ok(!/llama-3\.|qwen\/qwen3/.test(STORE_SRC), "src still offers a retired model");
  assert.ok(/export const GROQ_MODELS = \[\s*"openai\/gpt-oss-120b",\s*"openai\/gpt-oss-20b",\s*\]/.test(STORE_SRC));
  assert.ok(STORE_SRC.includes("if (!GROQ_MODELS.includes(groq.model)) groq.model = GROQ_MODELS[0];"));
  assert.ok(DIST.includes('y8=["openai/gpt-oss-120b","openai/gpt-oss-20b"]'));
});

/* ---------- the scorecard ---------- */

t("the scorecard script exists and pairs rows by caption", () => {
  const sc = fs.readFileSync(path.join(__dirname, "..", "scripts", "scorecard.mjs"), "utf8");
  assert.ok(/function alignRows/.test(sc) && /--cols/.test(sc));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
