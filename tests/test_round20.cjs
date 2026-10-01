/* Round 20 — Tanya (Boating Made Easy), Santmyer (Chilean Form 22) and Sean
 * (Collaborate and Eight B.V.) feedback. Each check pins a general rule, not a
 * client: the geometry and captions are the documents' shapes, the amounts
 * are invented.
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
const CLS = load("src/prototype/wp/classify.ts");
const DP = load("src/prototype/wp/detectProfile.ts");
const SEC = load("src/prototype/wp/sections.ts");
const STORE_SRC = fs.readFileSync(path.join(__dirname, "..", "src", "prototype", "wp", "store.ts"), "utf8");
const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const C = (text, x0, x1) => ({ text, x0, x1 });
const R = (y, ...cells) => ({ page: 1, y, cells });

/* ---------- Form 22 read by box code ---------- */

const F22 = { pageCount: 1, rows: [
  R(812, C("SERVICIO DE IMPUESTOS", 25, 120), C("AÑO TRIBUTARIO 2025", 242, 330)),
  R(794, C("INTERNOS FORM. 22", 35, 120)),
  R(551, C("Región", 53, 72), C("Capital Efectivo", 330, 372)),
  R(549, C("53", 31, 39), C("5", 290, 293), C("102", 306, 318), C("777.777.777", 532, 570)),
  R(521, C("Total del Activo", 53, 94), C("Total del Pasivo", 330, 373)),
  R(519, C("122", 29, 41), C("900.000.000", 255, 293), C("123", 306, 318), C("300.000.000", 532, 570)),
  R(431, C("Activo Inmovilizado", 53, 110), C("Saldo cuenta corriente bancaria", 330, 420)),
  R(429, C("647", 29, 41), C("500.000.000", 255, 293), C("784", 306, 318), C("50.000.000", 540, 570)),
  // The distribution box's caption is two lines up: the code alone places it.
  R(254, C("Remesas, retiros o dividendos repartidos en el ejercicio", 330, 500)),
  R(251, C("Corrección monetaria capital propio tributario inicial", 53, 200)),
  R(249, C("1177", 27, 43), C("33.041.946 1182", 263, 320), C("100.000.000", 537, 570)),
  R(221, C("Ingresos del giro percibidos o devengados", 53, 170), C("Remuneraciones", 330, 380)),
  R(219, C("1657", 27, 43), C("1.000.000.000", 255, 293), C("1662", 306, 320), C("400.000.000", 537, 570)),
  R(191, C("RAI/Remanente ejercicio siguiente (saldo positivo)", 53, 200), C("Resultado financiero", 330, 400)),
  R(189, C("1210", 27, 43), C("917.011.570", 260, 293), C("1672", 306, 320), C("600.000.000", 537, 570)),
]};

t("every box is read by its code, including one whose caption is two lines up", () => {
  const got = new Map(ENG.boxedFormCodes(F22).map((b) => [b.code, b.value]));
  assert.strictEqual(got.get("122"), "900.000.000");
  assert.strictEqual(got.get("784"), "50.000.000");
  assert.strictEqual(got.get("1182"), "100.000.000");
  assert.strictEqual(got.get("1657"), "1.000.000.000");
  assert.strictEqual(got.get("53"), "5");
});

t("the Chilean Form 22 is recognised and its table books income by code", () => {
  const spec = ENG.boxedFormSpec("SERVICIO DE IMPUESTOS INTERNOS FORM. 22");
  assert.ok(spec && spec.id === "cl-f22");
  const want = { "1400": "IS:7", "1657": "IS:7", "1660": "IS:OI", "1588": "IS:OI", "1409": "IS:11", "1661": "IS:11",
    "1411": "IS:26", "1662": "IS:26", "1140": "IS:27", "1419": "IS:29", "1664": "IS:29", "1663": "IS:30",
    "1412": "IS:OD", "1424": "IS:OD", "1671": "IS:OD", "1113": "IS:62" };
  assert.deepStrictEqual(spec.book, want);
  assert.deepStrictEqual(spec.distributions, ["1182", "1699"]);
  assert.deepStrictEqual(spec.result, [{ add: ["1672"], sub: [] }, { add: ["1410", "1426"], sub: ["1430"] }]);
  // Tax registers are not in the table: they are listed, never booked.
  for (const reg of ["1210", "1426", "645", "1500"]) assert.ok(!(reg in spec.book), reg);
});

t("tax-register captions are recognised (never booked by AI or agent)", () => {
  for (const c of ["RAI/Remanente ejercicio siguiente (saldo positivo)", "REX/INR/ Remanente ejercicio anterior",
    "STUT/ Remanente ejercicio siguiente", "CPT positivo final", "Pérdidas tributarias de ejercicios anteriores",
    "Renta líquida imponible afecta a IDPC", "PPM y remanente del IEAM", "REGISTRO SAC (ART. 14 LETRA A) LIR)"]) {
    assert.ok(ENG.isTaxRegisterCaption(c), c);
  }
  for (const c of ["Remuneraciones", "Arriendos", "Trade receivables", "Rain insurance", "Sacks and packaging"]) {
    assert.ok(!ENG.isTaxRegisterCaption(c), c);
  }
  assert.ok(STORE_SRC.includes("isTaxRegisterCaption(row.label"), "the AI and agent passes are not guarded");
});

t("src and dist read the same boxes", () => {
  const numeric = (() => {
    const i = DIST.search(/function Ii\([^)]*\)\{/);
    let d = 0, k = DIST.indexOf("{", i);
    for (;; k++) { if (DIST[k] === "{") d++; else if (DIST[k] === "}") d--; if (!d) break; }
    return DIST.slice(i, k + 1);
  })();
  const cells = /var Oa=\(?t[^)]*\)?=>\{[\s\S]*?\},\$w=t=>[\s\S]*?===null,/.exec(DIST)[0].replace(/,$/, ";");
  const stack = /\/\*EN9STACK-BEGIN\*\/[\s\S]*?\/\*EN9STACK-END\*\//.exec(DIST)[0];
  const box = /function EN9boxCodes[\s\S]*?\nvar EN9BOXFORMS/.exec(DIST)[0].replace(/\nvar EN9BOXFORMS$/, "");
  const shipped = new Function(`${numeric}\n${cells}\n${stack}\n${box}\nreturn EN9boxCodes;`)();
  assert.deepStrictEqual(shipped(F22).map((b) => [b.code, b.value]), ENG.boxedFormCodes(F22).map((b) => [b.code, b.value]));
});

t("the result check, balance-sheet totals, distributions and tax-basis flag are wired in both trees", () => {
  for (const s of ["form-result-mismatch", "form-bs-totals-", "form-distributions-", "Not GAAP book income: confirm or adjust."]) {
    assert.ok(STORE_SRC.includes(s), `src: ${s}`);
    assert.ok(DIST.includes(s), `dist: ${s}`);
  }
  assert.ok(DIST.includes("/*EN9FORMBS*/") && DIST.includes("/*EN9FORMTGT*/") && DIST.includes("/*EN9FRSAVE*/"));
});

/* ---------- entity profile: caption rows and Chilean address boxes ---------- */

t("a caption row never yields a caption as a value; Region and Comuna are read", () => {
  const rows = [
    ["06 Calle; N°; Of; Depto.", "09 Teléfono", "18 Comuna"], ["AVENIDA 1", "2000000", "VALPARAISO"],
    ["Región", "Capital Efectivo"], ["53", "5", "102", "2.455.002.379"],
  ];
  const r = DP.detectProfile(rows);
  const got = Object.fromEntries(r.profile.map((f) => [f.key, f.value]));
  assert.strictEqual(got.addr2, "VALPARAISO");
  assert.strictEqual(got.addr3, "Región Valparaíso");
  assert.ok(!r.unmatched.some((u) => u.value === "Capital Efectivo"), "a caption was offered to the AI as a value");
});

/* ---------- Dutch-style accounts in English ---------- */

const mkDoc = (pages) => ({ pageCount: pages.length, rows: pages.flatMap((lines, p) =>
  lines.map((l, i) => ({ page: p + 1, y: 800 - i * 14, cells: l.split(" | ").map((x, j) => ({ text: x, x0: 50 + j * 200, x1: 150 + j * 200 })) }))) });

t("the face statements are found and the notes are kept out of them", () => {
  const doc = mkDoc([
    ["Company B.V. - Rotterdam", "2.1 Balance sheet as of december 31, 2024", "ASSETS", "Cash | 7,911 | 33,708", "Equipment | 402 | 494", "Total assets | 8,313 | 34,202"],
    ["Company B.V. - Rotterdam", "2.2 Profit and Ioss account 2024", "Net turnover | 10,400 | 71,487", "Wages and salaries | 65,868 | 107,280", "Housing costs | 1,288 | 753", "Result after taxation | -75,458 | -73,259"],
    ["Company B.V. - Rotterdam", "2.4 Notes to the balance sheet", "ASSETS", "Acquisition value | 509 | 509", "Accumulated depreciations | -107 | -15", "Book value | 402 | 494"],
    ["Company B.V. - Rotterdam", "CURRENT LIABILITIES", "Current account shareholder | 63,905 | 62,342", "Interest 4% a year | 2,468 | 1,526", "Movement | -905 | 60,816"],
  ]);
  const kinds = CLS.classifyPages(doc).map((p) => p.kind);
  assert.strictEqual(kinds[0], "fs-balance-sheet");
  assert.strictEqual(kinds[1], "fs-pnl", "an OCR 'Ioss' hid the P&L title");
  assert.strictEqual(kinds[2], "fs-notes", "a notes page naming the balance sheet was read as one");
  assert.strictEqual(kinds[3], "fs-notes", "an untitled notes page became a second balance sheet");
});

t("note references are never amounts, and are not part of the caption", () => {
  assert.strictEqual(ENG.numericCell("[12]"), null);
  assert.strictEqual(ENG.numericCell("[4]"), null);
  assert.strictEqual(ENG.numericCell("(12)"), -12, "parentheses still mark a negative");
  assert.ok(DIST.includes("/*EN9NOTEREF*/") && DIST.includes("/*EN9NOTEREFLAB*/"));
});

t("an OCR dot in a comma-grouped whole-number page is a thousands separator", () => {
  assert.strictEqual(ENG.commaSlipPage("net turnover 10,400 71,487 wages 65,868 107,280 interest -5.691 -2,894"), true);
  assert.strictEqual(ENG.commaSlipPage("cash 1,234.56 2,345.67 3,456.78 rate 1.105"), false, "a page with decimals is left alone");
  assert.strictEqual(ENG.commaSlipPage("rate 1.105"), false);
});

t("totals and results are never accounts; the Dutch captions reach their lines", () => {
  const want = [
    ["Result before taxation", "SKIP"], ["Result after taxation", "SKIP"], ["Operating result", "SKIP"],
    ["Gross operating result", "SKIP"], ["Total financial income and expenditure", "SKIP"],
    ["Wages and salaries", "IS:26"], ["Housing costs", "IS:27"], ["Interest and similar expenditure", "IS:29"],
    ["Bank fees", "IS:OD"], ["Currency differences", "IS:19"], ["Payment differences", "IS:19"],
    ["Debts to participants and companies", "BS:52"], ["Debts to credit institutions", "BS:OCL"],
    ["Accrued liabilities", "BS:OCL"], ["Taxation", "IS:62"],
  ];
  const wrong = want.filter(([c, w]) => ENG.matchRule(c, ENG.DEFAULT_RULES) !== w)
    .map(([c, w]) => `${c}: ${ENG.matchRule(c, ENG.DEFAULT_RULES)} (want ${w})`);
  assert.deepStrictEqual(wrong, []);
  assert.ok(SEC.isProfitLine("Result after taxation") && !SEC.isProfitLine("Result before taxation"));
});

t("a covering letter's salutation is not the company's name", () => {
  const doc = mkDoc([
    ["To the directors of | ", "Company Eight B.V.", "Dear Mr. Smith,", "We hereby send you the annual report."],
    ["Company Eight B.V. - Rotterdam", "Balance sheet as of december 31, 2024", "Cash | 7,911 | 33,708", "Total assets | 8,313 | 34,202"],
  ]);
  doc.rows[0].cells = [{ text: "To the directors of Company Eight B.V.", x0: 50, x1: 300 }];
  const cls = CLS.classifyParsedDoc("f", "a.pdf", { kind: "pdf", pdf: doc }, 2024);
  assert.ok(!/^to the directors/i.test(String(cls.entityName || "")), String(cls.entityName));
});

/* ---------- Tanya: cost-of-sales keywords under Expenses ---------- */

t("a cost-of-goods keyword printed under Expenses is an other deduction (both trees)", () => {
  assert.ok(/m\.section === "costs" && target && \/\^IS:1\[0-2\]\$\/\.test\(target\)/.test(STORE_SRC));
  assert.ok(DIST.includes("/*EN9COGSGUARD*/"));
});

/* ---------- generation blockers and one rate ---------- */

t("the unblock reason is never an obstacle: any text, or none, acknowledges (both trees)", () => {
  assert.ok(!/PLACEHOLDER_NOTE|RECONCILE_BLOCKS/.test(STORE_SRC), "a reason filter is back in src");
  assert.ok(!/Type a reason first/.test(STORE_SRC), "an empty reason is still refused in src");
  assert.ok(STORE_SRC.includes('note = "Acknowledged \u2014 no reason given"'));
  assert.ok(DIST.includes("/*EN9ACKANY*/") && !DIST.includes("EN9PLACEHOLDER.test") && !DIST.includes("Type a reason first"));
  assert.ok(DIST.includes('note.placeholder="Reason (optional)"') && !/if\(!text\)\{ note\.focus\(\)/.test(DIST), "the popup still insists on text");
  assert.ok(DIST.includes("schf-total-assets-tie") && DIST.includes("fx-opening-rate-stale"));
  assert.ok(/id: "pnl-net-income-tie", level: "block"/.test(STORE_SRC));
});


/* ---------- Mancuso follow-up: delivery costs and taxes in place of income tax ---------- */

t("outbound delivery under cost of sales goes to line 17; freight on purchases stays (both trees)", () => {
  const out = /OUTBOUND_DELIVERY = (\/.*\/i);/.exec(STORE_SRC)[1], inb = /INBOUND_FREIGHT = (\/.*\/i);/.exec(STORE_SRC)[1];
  const O = new RegExp(out.slice(1, -2), "i"), I = new RegExp(inb.slice(1, -2), "i");
  const moves = (c) => O.test(c) && !I.test(c);
  assert.ok(moves("Freight and delivery - COS") && moves("Shipping and delivery expense"));
  assert.ok(!moves("Freight in") && !moves("Freight on purchases") && !moves("Duty/customs") && !moves("Dry Goods"));
  assert.ok(DIST.includes("/*EN9DELIVERY*/") && DIST.includes("delivery-to-deductions-"));
});

t("a tax charged in place of income tax reaches line 21a by country or currency (both trees)", () => {
  assert.ok(/country: \/\^belize\$\/i, currency: "BZD", caption: \/\\bbusiness\\s\+tax\\b\/i/.test(STORE_SRC));
  assert.ok(STORE_SRC.includes("inLieuIncomeTax(entityId, profile, review, rv, log);"));
  assert.ok(DIST.includes("/*EN9INLIEUCALL*/") && DIST.includes("in-lieu-tax-"));
});

t("a dollar sign carrying its country's letters names the currency", () => {
  assert.strictEqual(DP.sniffCurrency([["Total Income", "BZ$4,058,232.50"]]).value, "BZD");
  assert.strictEqual(DP.sniffCurrency([["Total", "$4,058.50"]]), null, "a bare $ is no currency");
  assert.ok(DIST.includes("/*EN9DOLLARPFX*/"));
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
