/* Review insights (insights.ts; dist sentinel EN9INSIGHTS).
 *
 *   - a missing balance sheet, P&L, prior return or ownership register is
 *     named, with the schedule it blocks;
 *   - OCR confidence is summarised overall, per table, per figure and per
 *     page, and a weak page is its own item;
 *   - a document that produced nothing says why, what to do and what to ask
 *     for;
 *   - Schedule C is explained step by step;
 *   - the ownership answers are explained;
 *   - earlier choices come back as suggestions only;
 *   - the review list is ranked and the reconciliations are summarised.
 *
 * The shipped block is the same module compiled, and it must answer the same.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const root = path.join(__dirname, "..");
const load = (entry) => {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
};
const SRC = load("src/prototype/wp/insights.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const DIST = (() => {
  const b = dist.indexOf("/*EN9INSIGHTS-BEGIN*/"), e = dist.indexOf("/*EN9INSIGHTS-END*/");
  assert.ok(b > 0 && e > b, "EN9INSIGHTS block present");
  return new Function(dist.slice(b, e) + ";return EN9INS;")();
})();
const BOTH = [["src", SRC], ["dist", DIST]];

const veillon = () => ({
  name: "Entity 1", processedAt: "x",
  profile: { legalName: "PACIFIC MALIBU PROPERTIES, INC.", cyEnd: "12/31/24", currency: "USD" },
  ownership: { ownStart: "100", ownEnd: "100", cfc: "Yes", tenPct: "No" },
  fx: { avgRate: "1" }, fxMeta: {},
  files: [{ id: "f1", name: "EF (OCR).pdf", ocr: { pages: [
    { page: 3, status: "ocr", confMean: 0.955, words: [{ text: "Apartamento", bbox: [69, 300, 130, 310], conf: 0.99 }, { text: "175,000", bbox: [469, 300, 510, 310], conf: 0.98 }] },
    { page: 4, status: "ocr", confMean: 0.72, words: [{ text: "Gastos", bbox: [70, 400, 100, 410], conf: 0.7 }, { text: "(621)", bbox: [483, 400, 510, 410], conf: 0.8 }] },
  ] } }],
  docClasses: {
    f1: { fileId: "f1", fileName: "EF (OCR).pdf", kind: "cfc-financial-statements", pages: [{ page: 3, kind: "fs-balance-sheet" }, { page: 4, kind: "fs-pnl" }], statementYear: 2024, textRows: 90, textChars: 3000, amountRows: 20, language: "Spanish" },
    f2: { fileId: "f2", fileName: "Veillon 2023 return.pdf", kind: "prior-year-us-return", pages: [] },
    f3: { fileId: "f3", fileName: "Scan.pdf", kind: "unknown", pages: [{ page: 1, kind: "unknown" }], textRows: 0, textChars: 0, amountRows: 0 },
  },
  lines: { "IS:34": { amount: 621 }, "BS:28": { eoy: 175000, boy: 173000 }, "BS:52": { eoy: 175621, boy: 163650 }, "BS:61": { eoy: -621, boy: -650 } },
  contributions: { "IS:34": [{ docName: "EF (OCR).pdf", label: "Gastos Generales y Administrativos", value: 621, field: "amount" }] },
  unmatched: [],
  shareholders: [{ name: "JOHN R VEILLON", eoy: 50 }, { name: "DONNA B VEILLON", eoy: 50 }],
  usShareholders: [{ name: "JOHN R VEILLON", pct: 50 }, { name: "DONNA B VEILLON", pct: 50 }],
  detected: { ownEnd: { sourceLabel: "2023 return · 5471 face" }, cfc: { sourceLabel: "item C 100% as filed" } },
  statedResults: [{ label: "GANANCIA O (PERDIDA) NETA DEL PERIODO", value: -621, feed: "is" }],
});

t("a complete set names no missing document; each missing one names the schedule it blocks", () => {
  for (const [who, M] of BOTH) {
    assert.deepStrictEqual(M.missingDocuments(veillon()), [], who);
    const bare = { ...veillon(), docClasses: {}, lines: {}, shareholders: [], usShareholders: [], ownership: {} };
    const ids = M.missingDocuments(bare).map((i) => i.id);
    assert.deepStrictEqual(ids, ["doc-missing-balance-sheet", "doc-missing-pnl", "doc-missing-prior-return", "doc-missing-ownership"], who);
    const msg = M.missingDocuments(bare).map((i) => i.message).join(" | ");
    assert.ok(/Balance Sheet is required because Schedule F/.test(msg) && /Prior-year Form 5471 is required for opening balances/.test(msg), who);
  }
});

t("a balance sheet inside the prior return, or a sister company's statements, is not 'found' for this entity", () => {
  for (const [who, M] of BOTH) {
    /* Santmyer: the only balance-sheet pages are attached to the 2023 U.S.
       return; the current documents are tax returns. DELINK: the upload
       holds HMC's statements, which name another company. */
    const e = veillon();
    e.lines = { "BS:10": { boy: 38051200 } };
    e.docClasses = {
      r: { fileId: "r", fileName: "2023US.pdf", kind: "prior-year-us-return", pages: [{ page: 80, kind: "fs-balance-sheet" }, { page: 90, kind: "fs-pnl" }] },
      s: { fileId: "s", fileName: "Sister.pdf", kind: "cfc-financial-statements", entityName: "HMC Communications Ltd", pages: [{ page: 9, kind: "fs-balance-sheet" }, { page: 6, kind: "fs-pnl" }] },
    };
    const out = M.missingDocuments(e);
    const bs = out.find((i) => i.id === "doc-missing-balance-sheet"), pl = out.find((i) => i.id === "doc-missing-pnl");
    assert.ok(bs && /Ask the client for the balance sheet/.test(bs.message), `${who}: ${bs && bs.message}`);
    assert.ok(pl && /Ask the client for the profit and loss/.test(pl.message), `${who}: ${pl && pl.message}`);
    // Its own statement, read but empty, is still "found".
    e.docClasses.o = { fileId: "o", fileName: "Own.pdf", kind: "cfc-financial-statements", entityName: "Pacific Malibu Properties Inc", pages: [{ page: 1, kind: "fs-balance-sheet" }] };
    assert.ok(/was found in the documents/.test(M.missingDocuments(e).find((i) => i.id === "doc-missing-balance-sheet").message), who);
  }
});

t("OCR confidence is summarised and a weak page is flagged", () => {
  for (const [who, M] of BOTH) {
    const out = M.ocrSummary(veillon());
    const sum = out.find((i) => i.id === "ocr-summary-f1");
    assert.ok(/84% overall/.test(sum.message) && /tables/.test(sum.message) && /figures/.test(sum.message), who + " " + sum.message);
    assert.ok(/page 4: 72% — needs review/.test(sum.message), who);
    assert.ok(/page 4 \(\(621\)\)/.test(sum.message), who + ": the figure read below 90% is named");
    assert.ok(out.some((i) => i.id === "ocr-page-low-f1-p4" && i.level === "warn"), who);
  }
});

t("a document that produced nothing says why, what next and what to ask for", () => {
  for (const [who, M] of BOTH) {
    const out = M.documentDiagnosis(veillon());
    assert.deepStrictEqual(out.map((i) => i.id), ["doc-diagnosis-f3"], who + ": the booked document and the prior return are left alone");
    assert.ok(/no text layer — it is a scanned image/.test(out[0].message) && /Run it through OCR/.test(out[0].message) && /Document needed/.test(out[0].message), who);
    const tr = { ...veillon(), docClasses: { f4: { fileId: "f4", fileName: "Form 22.pdf", kind: "cfc-tax-return", pages: [{ page: 1, kind: "tax-form" }], textRows: 40, textChars: 900, amountRows: 30 } } };
    assert.ok(/foreign tax return, not a set of financial statements/.test(M.documentDiagnosis(tr)[0].message), who);
    const other = { ...veillon(), docClasses: { f5: { fileId: "f5", fileName: "KEX.pdf", kind: "cfc-financial-statements", entityName: "EL KIJ EXPORTACIONES", pages: [], textRows: 50, textChars: 900 } } };
    assert.deepStrictEqual(M.documentDiagnosis(other), [], who + ": another company's document is not this entity's gap");
  }
});

t("Schedule C is explained and tied to the statement", () => {
  for (const [who, M] of BOTH) {
    const [c] = M.calculationExplanation(veillon());
    assert.ok(/Gross receipts 0 = gross profit 0 − deductions 621 = income before tax -621 = net income -621/.test(c.message), who + " " + c.message);
    assert.ok(/agrees with the statement's own/.test(c.message), who);
  }
});

t("the shipped file's stated result (values and years) is read too, and one bad check never silences the rest", () => {
  for (const [who, M] of BOTH) {
    const e = { ...veillon(), statedResults: [{ label: "NETA DEL PERIODO", values: [-621], years: [null], feed: "is" }] };
    assert.ok(/agrees with the statement's own/.test(M.calculationExplanation(e)[0].message), who);
    const broken = { ...veillon(), files: [{ id: "x", name: "x", ocr: { pages: [{ page: 1, status: "ocr", words: [null] }] } }] };
    const ids = M.entityInsights(broken, {}).map((i) => i.id);
    assert.ok(ids.includes("calc-explain") && ids.includes("ownership-basis"), who + " " + ids.join(","));
  }
});

t("the ownership answers are explained", () => {
  for (const [who, M] of BOTH) {
    const [o] = M.ownershipExplanation(veillon());
    assert.ok(/Ownership 100% at year end/.test(o.message) && /every Schedule B holder is a person/.test(o.message), who);
  }
});

t("earlier choices come back as suggestions only", () => {
  const mem = { docKind: { [SRC.fileSignature("Client.8_20_2025.MISC.Balance_Sheet_2024.pdf")]: { kind: "trial-balance", count: 2, example: "Balance_Sheet_2023.pdf" } },
                fx: { "RON|2024": { rate: "4.788", count: 1, entity: "MACROROOTS" } } };
  for (const [who, M] of BOTH) {
    const e = { ...veillon(), profile: { ...veillon().profile, currency: "RON" }, fx: { avgRate: "4.600619" }, fxMeta: { avgRate: { tag: "Market" } },
      docClasses: { g1: { fileId: "g1", fileName: "Other.9_1_2025.MISC.Balance_Sheet_2024.pdf", kind: "cfc-financial-statements", pages: [] } } };
    const out = M.memorySuggestions(e, mem);
    assert.deepStrictEqual(out.map((i) => i.id), ["memory-doctype-g1", "memory-fx-RON"], who);
    assert.strictEqual(out[1].suggestedValue, "4.788");
    assert.ok(out.every((i) => i.level === "info" && /nothing was changed automatically/.test(i.message)), who);
  }
});

t("the review list is ranked and the reconciliations are summarised", () => {
  const items = [
    { id: "mapping-unmatched", level: "warn", category: "mapping", message: "3 captions unmatched." },
    { id: "EN9-tie-bs-eoy", level: "block", category: "tie-out", message: "Schedule F does not balance at the end of the year: out by 1,234." },
    { id: "fx-avg-missing", level: "block", category: "fx", message: "No average rate." },
    { id: "calc-explain", level: "info", category: "consistency", message: "How…" },
  ];
  for (const [who, M] of BOTH) {
    const out = M.summarizeReview(veillon(), items);
    const pr = out.find((i) => i.id === "review-priorities");
    assert.ok(/1\. \[Blocking\] Schedule F does not balance/.test(pr.message) && /2\. \[Blocking\] No average rate/.test(pr.message), who + " " + pr.message);
    const rc = out.find((i) => i.id === "reconciliation-summary");
    assert.ok(/✗ Schedule F balances at the year end/.test(rc.message) && /✓ Schedule C agrees/.test(rc.message) && /✓ no figure is counted twice/.test(rc.message), who + " " + rc.message);
    assert.ok(out.every((i) => i.level === "info"), who + ": advice never blocks");
  }
});

t("the pipeline wires it in both trees", () => {
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(store.includes("entityInsights(ent, readChoiceMemory())") && store.includes("summarizeReview(ent, merged)"));
  assert.ok(store.includes('rememberChoice("docKind", fileSignature(f.name)') && store.includes('rememberChoice("fx"'));
  assert.ok(store.includes("id: `dup-doc-${resolved.target}-${norm(m.row.label)}`"), "a figure repeated by another document is counted once");
  for (const s of ["/*EN9INSCALL*/", "/*EN9INSSUM*/", "/*EN9MEMDOC*/", "/*EN9MEMFX*/", "/*EN9DUPDOC*/"]) assert.ok(dist.includes(s), s);
});

t("one English wording everywhere, with the printed words kept for the audit", () => {
  const CAP = load("src/prototype/wp/captions.ts");
  const tr = { "Otros gastos deducibles": "Other deductible expenses" };
  assert.strictEqual(CAP.bilingualLabel(tr, "Otros gastos deducibles"), "Other deductible expenses (original: Otros gastos deducibles)");
  assert.strictEqual(CAP.bilingualLabel(tr, "Rent"), "Rent");
  const i = dist.indexOf("/*EN9BILABEL*/");
  const f = new Function(dist.slice(i, dist.indexOf("function EN9dispLabel(t,e){", i)) + dist.slice(dist.indexOf("function EN9dispLabel(t,e){"), dist.indexOf("\n", dist.indexOf("function EN9dispLabel(t,e){"))) + ";return EN9biLabel;");
  for (const s of ["/*EN9BILABEL*/", "/*EN9TERMMEM*/", "/*EN9TERMMEM-BEGIN*/", "/*EN9TERMREUSE*/"]) assert.ok(dist.includes(s), s);
  assert.ok(dist.includes('EN9biLabel(e.translations,EN9c.label||"")'), "Provenance source caption");
  assert.ok(dist.includes('We("Caption remapped",`"${EN9biLabel(n.translations,i)}"'), "the remap log");
  assert.ok(dist.includes('children:[EN9biLabel(e.translations,g)," "'), "the mapping screen");
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(store.includes("bilingualLabel(ent.translations, c.label || \"\")") && store.includes("termsFromMemory(cur.translations"));
  void f;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
