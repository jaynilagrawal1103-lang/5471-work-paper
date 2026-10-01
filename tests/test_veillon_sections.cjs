/* Veillon / Pacific Malibu Properties Inc. (Panama, Spanish statements).
 *
 * The balance sheet's last banner (equity) ran on through the cash-flow
 * statement, the notes and a scanned identity card, so cash movements, a
 * note's column year, a note Total and ID-card digits were all booked to
 * retained earnings, and the Spanish P&L carried no section at all.
 *
 *   1. a section resets at every new page and at a cash-flow / notes title,
 *      unless the page repeats the previous page's statement title;
 *   2. Estado de Resultados / Ingresos / Costo de Ventas / Gastos are P&L
 *      headings;
 *   3. cash-flow pages, identity cards and signature pages are not booked,
 *      and a column-header year is not an amount;
 *   4. a note Total is not booked on top of its components.
 *
 * Every behavioural check runs the src port and the shipped dist copy over
 * the same rows and demands the same answer. */
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
const SRC = load("src/prototype/wp/sections.ts");
const ENG = load("src/prototype/wp/engine.ts");
const CLS = load("src/prototype/wp/classify.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const SHIPPED = (() => {
  const b = dist.indexOf("/*EN9STRUCT-BEGIN*/"), e = dist.indexOf("/*EN9STRUCT-END*/");
  let block = dist.slice(b + "/*EN9STRUCT-BEGIN*/".length, e);
  block = block.slice(block.indexOf("/*EN9TIE-END*/") + "/*EN9TIE-END*/".length);
  const x = {};
  new Function("exports", "is", block + ";exports.tagSections=EN9tagSections;exports.dropFurniture=EN9dropFurniture;exports.sameIndent=EN9sameIndentSubtotals;exports.structRows=EN9structRows;exports.dropMovement=EN9dropMovement;")(x, ENG.BS_LINES);
  return x;
})();
const BOTH = [["src", SRC.tagSections, SRC.dropFurniture, SRC.sameIndentSubtotals], ["dist", SHIPPED.tagSections, SHIPPED.dropFurniture, SHIPPED.sameIndent]];
const R = (label, amt, page, x0 = 60) => ({ row: { label, values: amt === null ? [] : [].concat(amt), page, x0 }, docId: "d1", docName: "EF.pdf", feed: "bs", kind: "pdf", x0 });

t("a section does not run into the next page", () => {
  const rows = [R("Patrimonio", null, 3), R("Perdidas del Periodo", -621, 3), R("Efectivo Utilizado en Actividades de Operacion", -621, 6), R("Tasa Unica", 300, 8)];
  for (const [who, tag] of BOTH) {
    const s = tag(rows).map((m) => m.section);
    assert.deepStrictEqual(s, ["equity", "equity", null, null], who);
  }
});

t("a cash-flow or notes title ends the section on the same page", () => {
  const rows = [R("Patrimonio", null, 3), R("Perdidas del Periodo", -621, 3), R("Estado de Flujo de Efectivo", null, 3), R("Cuentas por Pagar Accionistas", 175621, 3),
                R("Gastos", null, 4), R("Tasa Unica", 300, 4), R("Notas a los Estados Financieros", null, 4), R("Total", 621, 4)];
  for (const [who, tag] of BOTH) assert.deepStrictEqual(tag(rows).map((m) => m.section), ["equity", "equity", null, null, "costs", "costs", null, null], who);
});

t("a page that repeats the statement title continues its section", () => {
  const rows = [R("Statement of Financial Performance", null, 6), R("Expenses", null, 6), R("Subscriptions", 40686, 6),
                R("Statement of Financial Performance", null, 7), R("Team Building", 3016, 7),
                R("PACIFIC MALIBU PROPERTIES INC.", null, 7), R("PACIFIC MALIBU PROPERTIES INC.", null, 8), R("Tasa Unica", 300, 8)];
  for (const [who, tag, furn] of BOTH) {
    const out = tag(furn(rows));
    assert.strictEqual(out.find((m) => m.row.label === "Team Building").section, "costs", who + ": the repeated title proves page 7 continues");
    assert.strictEqual(out.find((m) => m.row.label === "Tasa Unica").section, null, who + ": a repeated letterhead proves nothing");
  }
});

t("Spanish P&L headings open the P&L sections", () => {
  const rows = [R("Estado de Resultados", null, 4), R("Ingresos", null, 4), R("Ventas", 1000, 4), R("Costo de Ventas", null, 4), R("Compras", 400, 4), R("Gastos", null, 4), R("Anualidad de Agente Residente", 321, 4)];
  for (const [who, tag] of BOTH) assert.deepStrictEqual(tag(rows).map((m) => m.section), ["income", "income", "income", "cogs", "cogs", "costs", "costs"], who);
  assert.strictEqual(SRC.sectionRoute("costs", "anualidad de agente residente"), "IS:OD");
  const plural = [R("Activos no Corrientes", null, 3), R("Apartamento 3H Biltmore en Nueva Gorgona", 175000, 3)];
  for (const [who, tag] of BOTH) assert.strictEqual(tag(plural)[1].section, "fixedAssets", who + ": plural 'no corrientes'");
});

t("a column-header year is not an amount", () => {
  const rows = [R("Descripción", 2024, 8), R("Anualidad de Agente Residente", 321, 8), R("Descripcion", [2024, 2023], 8), R("Bank charges", 2024, 8)];
  for (const [who, , furn] of BOTH) assert.deepStrictEqual(furn(rows).map((m) => m.row.label), ["Anualidad de Agente Residente", "Bank charges"], who);
});

t("a note Total is not booked on top of its components", () => {
  const rows = [R("Anualidad de Agente Residente", 321, 8), R("Tasa Unica", 300, 8), R("Total", 621, 8)];
  for (const [who, , , same] of BOTH) {
    const out = same(rows);
    assert.ok(/subtotal of the 2 row/.test(out[2].skipReason || out[2].EN9skip || ""), who + ": the Total is structure");
    assert.ok(!out[0].skipReason && !out[0].EN9skip, who + ": the components stay");
  }
  const plain = [R("Rent", 500, 2), R("Office", 500, 2)];
  for (const [who, , , same] of BOTH) assert.ok(!same(plain)[1].skipReason && !same(plain)[1].EN9skip, who + ": two equal single-column expenses are not a total");
});

/* ---- page identification ---- */
const doc = (pages) => ({ pageCount: pages.length, rows: pages.flatMap((lines, i) => lines.map((l) => ({ page: i + 1, y: 0, cells: [].concat(l).map((text, k) => ({ text: String(text), x0: 60 + k * 400, x1: 100 + k * 400 })) }))) });
const EF = doc([
  ["PACIFIC MALIBU PROPERTIES INC.", "RUC 155712345-2-2022", "Estado de Situacion Financiera", ["Apartamento 3H", "175,000"], ["Cuentas por Pagar Accionistas", "175,621"], ["Perdidas del Periodo", "(621)"]],
  ["PACIFIC MALIBU PROPERTIES INC.", "RUC 155712345-2-2022", "Estado de Resultados", "Gastos", ["Anualidad de Agente Residente", "321"], ["Tasa Unica", "300"]],
  ["PACIFIC MALIBU PROPERTIES INC.", "RUC 155712345-2-2022", "Estado de Flujo de Efectivo", ["Perdidas del Periodo", "(621)"], ["Efectivo Utilizado en Actividades de Operacion", "(621)"]],
  ["PACIFIC MALIBU PROPERTIES INC.", "RUC 155712345-2-2022", "Notas a los Estados Financieros", ["Descripcion", "2024"], ["Tasa Unica", "300"], ["Total", "621"]],
  ["REPUBLICA DE PANAMA", "TRIBUNAL ELECTORAL", ["CARNEDEIDENT", "5"], ["FECHA DE NACIMIENTO: 18-OCT-1979", "8"], ["FECHA DE EXPIRACION:", "39"]],
  ["Firma del representante legal", "Firma del contador"],
]);

t("cash flow, notes, identity card and signature pages are identified and not booked", () => {
  const kinds = CLS.classifyPages(EF).map((p) => p.kind);
  assert.deepStrictEqual(kinds, ["fs-balance-sheet", "fs-pnl", "fs-cashflow", "fs-notes", "non-financial", "unknown"]);
  /* A signature page straight after a statement used to inherit it. */
  const signed = doc([["RUC 155712345-2-2022", "Estado de Situacion Financiera", ["Apartamento 3H", "175,000"], ["Cuentas por Pagar Accionistas", "175,621"], ["Total", "175,000"]],
                      ["Firma del representante legal", ["Panama, 29 de mayo de", "2025"]]]);
  assert.deepStrictEqual(CLS.classifyPages(signed).map((p) => p.kind), ["fs-balance-sheet", "non-financial"]);
  const cls = { kind: "cfc-financial-statements", pages: CLS.classifyPages(EF) };
  for (const k of ["fs-cashflow", "fs-notes", "non-financial"]) {
    const feeds = [...CLS.feedsForPage(cls, k)];
    assert.ok(!feeds.includes("generic-is") && !feeds.includes("generic-bs"), k + " is never booked");
  }
  const tb = { kind: "trial-balance", pages: [] };
  assert.deepStrictEqual([...CLS.feedsForPage(tb, "non-financial")], ["none"]);
  assert.deepStrictEqual([...CLS.feedsForPage(tb, "fs-cashflow")], ["profile"]);
});

t("a statement page whose first rows mention a result is still not a cash-flow page", () => {
  const bs = doc([["Estado de Situacion Financiera", "Notas 2024 2023", ["Efectivo", "100"], ["Flujo de efectivo neto", "5"]]]);
  assert.strictEqual(CLS.nonStatementKind(bs, 1), null);
});

/* ---- what the real scan taught (PaddleOCR on the Pacific Malibu pack) ---- */
const BAN = load("src/prototype/wp/sectionBanners.ts");
const DEG = (() => {
  const b = dist.indexOf("/*EN9DEGLUE-BEGIN*/"), e = dist.indexOf("/*EN9DEGLUE-END*/");
  return new Function(dist.slice(b, e) + ";return EN9deglue;")();
})();

t("OCR words run together are split back for matching, src and dist alike", () => {
  const cases = [["ACTIVOSCORRIENTES", "ACTIVOS CORRIENTES"], ["TOTAL DEACTIVOS", "TOTAL DE ACTIVOS"], ["PASIVOSNO CORRIENTES", "PASIVOS NO CORRIENTES"],
    ["PASIVOSMASPATRIMONIO", "PASIVOS MAS PATRIMONIO"], ["GANANCIAO (PERDIDA)ANTES DEIMPUESTOS", "GANANCIA O (PERDIDA) ANTES DE IMPUESTOS"],
    ["Gastos GeneralesyAdministrativos", "Gastos Generales y Administrativos"],
    ["Noventa", "Noventa"], ["Delicias", "Delicias"], ["CARNEDEIDENT", "CARNEDEIDENT"], ["Accounts payable", "Accounts payable"], ["Retained earnings", "Retained earnings"]];
  for (const [raw, want] of cases) {
    assert.strictEqual(BAN.deglue(raw), want, "src " + raw);
    assert.strictEqual(DEG(raw), want, "dist " + raw);
  }
  assert.strictEqual(ENG.matchRule("TOTAL DEACTIVOS", ENG.DEFAULT_RULES), "SKIP", "a glued total is still a total");
  const rows = [R("ACTIVOS NO CORRIENTES", null, 3), R("Apartamento 3H", 175000, 3), R("PASIVOSNO CORRIENTES", null, 3), R("Cuentas por Pagar Accionistas", 175621, 3)];
  for (const [who, tag] of BOTH) assert.deepStrictEqual(tag(rows).map((m) => m.section), ["fixedAssets", "fixedAssets", "termLiabilities", "termLiabilities"], who);
});

t("a Spanish P&L's running results are structure, never expenses", () => {
  for (const l of ["GANANCIAO(PERDIDA)BRUTA", "GANANCIA O (PERDIDA) OPERATIVA", "GANANCIAO (PERDIDA)ANTES DEIMPUESTOS", "GANANCIA O (PERDIDA) NETA DEL PERIODO", "Utilidad bruta", "Resultado operativo"]) {
    assert.ok(SRC.isResultSubtotal(l), l);
  }
  for (const l of ["Gastos Generales y Administrativos", "Pérdidas netas en venta de activos", "Anualidad de Agente Residente"]) assert.ok(!SRC.isResultSubtotal(l), l);
  assert.ok(SRC.isProfitLine("GANANCIA O (PERDIDA) NETA DEL PERIODO"));
});

t("a note reference under a Spanish 'Notas' column is not an amount", () => {
  const d = { pageCount: 1, rows: [
    { page: 1, y: 700, cells: [{ text: "Estado de Resultados", x0: 70, x1: 160 }] },
    { page: 1, y: 660, cells: [{ text: "Notas", x0: 378, x1: 400 }, { text: "2024", x0: 454, x1: 476 }] },
    { page: 1, y: 600, cells: [{ text: "Gastos Generales y Administrativos", x0: 70, x1: 260 }, { text: "4", x0: 392, x1: 397 }, { text: "(621)", x0: 483, x1: 510 }] },
  ] };
  /* The header row itself ("Notas 2024") is dropped later as a column
     heading (dropFurniture); here only the data row matters. */
  const rows = ENG.extractPositionedRows(d, ENG.detectRulers(d), { pages: new Set([1]) }).filter((r) => r.values.length && r.label !== "Notas");
  assert.deepStrictEqual(rows.map((r) => [r.label, r.values]), [["Gastos Generales y Administrativos", [-621]]]);
});

t("a contents page is a cover, not a balance sheet", () => {
  const idx = doc([["PACIFIC MALIBU PROPERTIES, INC.", "Estados Financieros", ["Indice", "Pages"], ["Balance General", "1"], ["Estado de Resultados", "2"], ["Estado de Flujo de Efectivo", "4"]]]);
  assert.strictEqual(CLS.nonStatementKind(idx, 1), "fs-cover");
  assert.strictEqual(CLS.classifyPages(idx)[0].kind, "fs-cover");
});

t("a Spanish statement of changes in equity is a movement page, not balances", () => {
  const rows = [R("Balance al 1 de enero de 2024", [0, 0], 5), R("Perddida Neta", [-621, -621], 5), R("Balance al 31 de diciembre de 2024", [-621, -621], 5)];
  for (const [who, fn] of [["src", SRC.dropMovementSchedules], ["dist", SHIPPED.dropMovement]]) {
    const out = fn(rows);
    assert.ok(out.every((m) => /reconciles one account/.test(m.skipReason || m.EN9skip || "")), who);
  }
  const bs = [R("Balance al 31 de diciembre de 2024", 5, 3), R("Total de activos", 175000, 3)];
  for (const [who, fn] of [["src", SRC.dropMovementSchedules], ["dist", SHIPPED.dropMovement]]) assert.ok(!fn(bs)[1].skipReason && !fn(bs)[1].EN9skip, who + ": one dated line alone is not a movement page");
});

t("country of incorporation is read from item 1c's own column", () => {
  const cf = fs.readFileSync(path.join(root, "src/prototype/wp/carryForward.ts"), "utf8");
  assert.ok(cf.includes("const cap = faceGeo[ri]?.cells.find((c) => /country under whose laws/i.test(c.text));"));
  assert.ok(dist.includes("/*EN9COUNTRYCOL*/"));
  assert.ok(dist.includes("5471 item 1c (country under whose laws incorporated)"));
});

t("2Hats: short-term liabilities and cash groups open their sections; a credit under a positive total keeps its sign", () => {
  const rows = [R("Equity", 2609.32, 3, 63), R("08400 General reserves", -1890.68, 3, 94), R("Short-term liabilities", 27032.1, 3, 63), R("16000 Creditors", 259.24, 3, 94),
                R("Liquid assets", 28447.17, 2, 73), R("Checking accounts", 23947.17, 2, 83), R("11000 NL77INGB0009457686", 23947.17, 2, 94), R("Saving accounts", 4500, 2, 83), R("12000 NL77INGB0009457686", 4500, 2, 94)];
  for (const [who, tag] of BOTH) {
    const sec = Object.fromEntries(tag(rows).map((m) => [m.row.label + "@" + m.row.page, m.section]));
    assert.strictEqual(sec["16000 Creditors@3"], "liabilities", who);
    assert.strictEqual(sec["11000 NL77INGB0009457686@2"], "cash", who);
    assert.strictEqual(sec["12000 NL77INGB0009457686@2"], "cash", who);
  }
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(store.includes("parentTotalSign(mapRows, m) !== 1"));
  assert.ok(dist.includes("/*EN9DEDPARENT*/EN9parentSign(a,F)!==1") && dist.includes("/*EN9CASHGRP*/"));
});

t("dist carries the same page rules and bookings guards", () => {
  for (const s of ["/*EN9ESPNL*/", "/*EN9SECRESET*/", "/*EN9YEARHDR*/", "/*EN9NOTETOTAL*/", "/*EN9NONSTMT*/", "/*EN9NONSTMT-BEGIN*/", "/*EN9SIGNPAGE*/", "/*EN9FEEDNONSTMT*/",
                   "/*EN9CONTTITLE*/", "/*EN9RESULTSKIP*/", "/*EN9SHLOAN*/", "/*EN9DEGLUE-BEGIN*/", "/*EN9RESULTSUB*/", "/*EN9DATEDES*/"]) assert.ok(dist.includes(s), s);
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(store.includes('isResultSubtotal(m.row.label))) target = "SKIP";'), "the P&L's own result lines are never expenses");
  assert.ok(store.includes('if (target === "BS:46" && /\\b(accionistas?|socios?|shareholders?'), "a payable to shareholders is Schedule F line 18");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
