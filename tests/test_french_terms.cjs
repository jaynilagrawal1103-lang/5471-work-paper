/* French/Swiss statements read offline (Romy Cuadras, Athletic Prime SARL).

   1. The built-in terminology now covers French leaf captions and is applied
      to every statement row, not only boxed tax forms. It only ever places a
      caption no rule matched: the raw caption is tried first.
   2. OCR drops spaces and confuses thin strokes, so the look-up also compares
      whole captions with those removed ("Reporta nouveau", "CIC Associe").
   3. Swiss statements print a subtotal after its items at the same indent,
      with no total word. It is dropped only when every year column (two or
      more) equals the sum of the rows directly above it, and it is not all
      zero. A single-column statement is never tested. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const root = path.join(__dirname, "..");
const TERMS = SRC.LOAD("src/prototype/wp/terms.ts");
const SECT = SRC.LOAD("src/prototype/wp/sections.ts");
const ENG = SRC.ENG;
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

t("French leaf captions translate to English the mapping rules already place", () => {
  const want = {
    "Prestations de services": "IS:7", "Clients": "BS:11", "C/C Associé": "BS:19", "Charges à payer": "BS:OCL",
    "Provision pour impôts": "BS:OCL", "Report à nouveau": "BS:61", "Frais de communication": "IS:OD",
    "Frais de publicité": "IS:OD", "Assurances": "IS:OD", "Intérêts créditeurs": "IS:15", "Frais bancaires": "IS:OD", "Impôts": "IS:62",
  };
  for (const [fr, line] of Object.entries(want)) {
    const en = TERMS.translateCaption(fr);
    assert.ok(en, `no English for ${fr}`);
    assert.strictEqual(ENG.matchRule(en, ENG.DEFAULT_RULES), line, `${fr} → ${en}`);
  }
});

t("subtotal captions and the year's result are deliberately NOT translated", () => {
  for (const c of ["Trésorerie", "Passifs de régularisation", "Autres dettes à court terme", "Autres créances à court terme",
                   "Bénéfice de l'exercice", "Perte de l'exercice", "Charges et produits financiers"])
    assert.strictEqual(TERMS.translateCaption(c), null, c);
});

t("OCR spellings still find their whole caption, never a part of one", () => {
  assert.strictEqual(TERMS.translateCaption("Reporta nouveau"), "retained earnings");
  assert.strictEqual(TERMS.translateCaption("Provision pourimpots"), "income tax payable");
  assert.strictEqual(TERMS.translateCaption("CIC Associe"), "loan to shareholder");
  assert.strictEqual(TERMS.translateCaption("Frais de communication et divers"), null, "a longer caption is not guessed");
  assert.strictEqual(TERMS.translateCaption("Loy"), null, "short keys are never squeezed");
});

t("existing entries are unchanged (Spanish 'capital social' is still common stock)", () => {
  assert.strictEqual(TERMS.translateCaption("Capital social"), "common stock");
  assert.strictEqual(TERMS.translateCaption("Bancos"), "cash at bank");
});

t("the terminology is applied to every statement row, and a translation already on the entity still wins", () => {
  assert.ok(store.includes("for (const m of mapRows) {") && store.includes("const en = translateCaption(lb);"));
  assert.ok(store.includes("const merged = { ...termTranslations, ...(cur?.translations || {}) };"), "entity translations win");
  assert.ok(dist.includes("/*EN9STMTTERMS*/try{for(var EN9sq=0;EN9sq<a.length;EN9sq++)"));
  assert.ok(dist.includes("/*EN9TERMSQ*/"));
});

const R = (label, values, x0 = 85, page = 1) => ({ row: { label, values, page }, x0, docId: "d", docName: "d", feed: "bs", kind: "pdf" });
const skipped = (rows) => SECT.sameIndentSubtotals(rows).filter((m) => m.skipReason).map((m) => m.row.label);

t("Swiss subtotals after their items are dropped: one item, two items, a mixed-sign pair", () => {
  assert.deepStrictEqual(skipped([R("Banques", [0, 72.45]), R("Trésorerie", [0, 72.45])]), ["Trésorerie"]);
  assert.deepStrictEqual(skipped([R("Charges à payer", [1300, 1300]), R("Provision pour impôts", [96, 150]), R("Passifs de régularisation", [1396, 1450])]), ["Passifs de régularisation"]);
  assert.deepStrictEqual(skipped([R("Bénéfice d'exploitation", [-9671.7, 2934.72]), R("Intérêts créditeurs", [505.42, 528.6]), R("Frais bancaires", [-52.7, -53.08]), R("Charges et produits financiers", [452.72, 475.52])]),
    ["Charges et produits financiers"], "the sum is of the rows directly above, not the whole run");
});

t("what it must leave alone: one column, all zeros, a mismatch in either year, a heading in between, another page", () => {
  assert.deepStrictEqual(skipped([R("Rent", [1200]), R("Insurance", [1200])]), [], "single-column: two equal expenses are ordinary");
  assert.deepStrictEqual(skipped([R("Clients", [0, 0]), R("Créances", [0, 0])]), [], "zeros prove nothing");
  assert.deepStrictEqual(skipped([R("A", [100, 90]), R("B", [100, 95])]), [], "every year must agree");
  assert.deepStrictEqual(skipped([R("A", [100, 90]), R("CHARGES", []), R("B", [100, 90])]), [], "a heading is a boundary");
  assert.deepStrictEqual(skipped([R("A", [100, 90], 85, 1), R("B", [100, 90], 85, 2)]), [], "a page break is a boundary");
  assert.deepStrictEqual(skipped([R("Capital", [20000, 20000]), R("Réserve", [4000, 4000]), R("Report", [9928.04, 7028.8]), R("Bénéfice", [-9303.78, 2899.24])]), [], "equity lines are not subtotals of each other");
});

t("dist carries the same subtotal rule, wired after structRows", () => {
  assert.ok(dist.includes("/*EN9SAMEINDSUB-BEGIN*/function EN9sameIndentSubtotals(t){") && dist.includes("/*EN9SAMEINDSUB-END*/"));
  assert.ok(dist.includes('/*EN9SAMEINDSUB-CALL*/typeof EN9sameIndentSubtotals<"u"&&(EN9pi=EN9sameIndentSubtotals(EN9pi),EN9pb=EN9sameIndentSubtotals(EN9pb)),'));
  assert.ok(store.includes("pdfIs = sameIndentSubtotals(pdfIs);") && store.includes("pdfBs = sameIndentSubtotals(pdfBs);"));
  for (const k of ["c/c associe", "report a nouveau", "prestations de services", "frais bancaires"]) assert.ok(dist.includes(JSON.stringify(k)), k);
  const gi = dist.indexOf("EN9CAPTION_TERMS"), glossary = dist.slice(gi, dist.indexOf("};", gi));
  assert.ok(glossary.includes('"c/c associe"'), "found the shipped glossary");
  assert.ok(!glossary.includes('"benefice de l\'exercice"'), "the year's result is not in the shipped glossary either");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
