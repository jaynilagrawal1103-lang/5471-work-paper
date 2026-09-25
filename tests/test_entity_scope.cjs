/* One document set, two foreign corporations.
 *
 * A stapled statement pack carries pages for more than one corporation, and a
 * Form 5471 is filed per corporation. Two things have to hold or the work
 * paper belongs to neither company: a page that names another corporation
 * must not feed this entity, and a second corporation named on a prior-year
 * return must become its own entity even when a reference ID read off a
 * neighbouring page belongs to the corporation already being prepared.
 *
 *   node tests/test_entity_scope.cjs
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const DIST = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

/* The two helpers are pure and exported, so they are tested directly rather
   than through a whole processing run. */
const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, "src/prototype/wp/store.ts")],
  bundle: true, write: false, format: "cjs", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
}).outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", "require", `${bundle}\n`)(mod, mod.exports, require);
const { entityNameVariants, attributePagesToEntities } = mod.exports;
/* The classification helpers come from their own module: the store does not
   re-export them, and bundling classify.ts directly keeps this test honest
   about which file is under test. */
const clBundle = esbuild.buildSync({
  entryPoints: [path.join(root, "src/prototype/wp/classify.ts")],
  bundle: true, write: false, format: "cjs", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;
const clMod = { exports: {} };
new Function("module", "exports", "require", `${clBundle}\n`)(clMod, clMod.exports, require);
const CL = clMod.exports;

const page = (n, lines) => lines.map((l) => ({ page: n, cells: [{ text: l }] }));
const DOC = {
  rows: [
    ...page(1, ["CONTPAQ i", "TEZCATLIPOCA INVERSIONES S DE RL DE CV", "Balance General al 31/Dic/2024", "Bancos 299.17"]),
    ...page(2, ["Acreedores diversos 53,983,795.40"]),
    ...page(3, ["CONTPAQ i", "EL KIJ EXPORTACIONES S DE RL DE CV", "Balance General al 31/Dic/2024", "Terrenos 11,999,579.90"]),
  ],
};
const ENTS = [
  { key: "tez", vars: entityNameVariants("TEZCATLIPOCA INVERSIONES S DE RL DE CV") },
  { key: "kij", vars: entityNameVariants("EL KIJ EXPORTACIONES S DE RL DE CV") },
];

t("a name yields its own key, and an English suffix yields a bare form too", () => {
  assert.deepStrictEqual(entityNameVariants("HMC Communications Limited"), ["hmccommunicationslimited", "hmccommunications"]);
  assert.deepStrictEqual(entityNameVariants("EL KIJ EXPORTACIONES S DE RL DE CV"), ["elkijexportacionessderldecv"]);
  assert.deepStrictEqual(entityNameVariants("   "), []);
});

t("each page goes to the corporation its letterhead names", () => {
  const owner = attributePagesToEntities(DOC, ENTS);
  assert.strictEqual(owner.get(1), "tez");
  assert.strictEqual(owner.get(3), "kij");
});

t("a page that names nobody stays with the page before it", () => {
  const owner = attributePagesToEntities(DOC, ENTS);
  assert.strictEqual(owner.get(2), "tez", "page 2 carries on from page 1, not from the page after it");
});

t("pages before the first letterhead belong to the first corporation named", () => {
  const doc = { rows: [...page(1, ["Continuation sheet"]), ...page(2, ["EL KIJ EXPORTACIONES S DE RL DE CV"])] };
  const owner = attributePagesToEntities(doc, ENTS);
  assert.strictEqual(owner.get(1), "kij");
});

t("a page naming two corporations is left unattributed rather than guessed", () => {
  const doc = { rows: [...page(1, ["TEZCATLIPOCA INVERSIONES S DE RL DE CV and EL KIJ EXPORTACIONES S DE RL DE CV"])] };
  const owner = attributePagesToEntities(doc, ENTS);
  assert.strictEqual(owner.get(1), null, "two names on one page decide nothing");
});

t("with one entity in the case nothing is attributed away", () => {
  const owner = attributePagesToEntities(DOC, [ENTS[0]]);
  // page 3 names the other corporation, which has no entity: it stays here.
  assert.strictEqual(owner.get(3), "tez");
});

/* ---- the second corporation still becomes its own entity ---- */

t("src: the fan-out freshness test asks the NAME first, the reference ID only without one", () => {
  const src = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  const i = src.indexOf("async function fanOutSiblings");
  const body = src.slice(i, i + 1400);
  assert.match(body, /if \(plan\.cfcName && !placeholderName\(known\)\) return entitySimilarity\(known, plan\.cfcName\) >= 0\.5;/);
  assert.match(body, /return plan\.refIds\.length > 0 && !!e\.profile\.refId && plan\.refIds\.includes\(e\.profile\.refId\);/);
});

t("dist carries the same rule, inside balanced sentinels", () => {
  assert.ok(DIST.includes("/*EN9FANNAME-BEGIN*/") && DIST.includes("/*EN9FANNAME-END*/"), "EN9FANNAME missing or unbalanced");
  const seg = DIST.slice(DIST.indexOf("/*EN9FANNAME-BEGIN*/"), DIST.indexOf("/*EN9FANNAME-END*/"));
  assert.match(seg, /if\(a\.cfcName&&!EN9phName\(EN9k\)\)return Wh\(EN9k,a\.cfcName\)>=\.5/);
  assert.match(seg, /return a\.refIds\.length>0&&!!r\.profile\.refId&&a\.refIds\.includes\(r\.profile\.refId\)/);
});

t("dist attributes pages the same way src does", () => {
  const m = /function EN9_attr\(t,e\)\{[\s\S]*?\n?\}(?=var X1=)/.exec(DIST);
  assert.ok(m, "EN9_attr not found in dist");
  const H = new Function(`function EN9_norm(t){return String(t||"").toLowerCase().replace(/[^a-z0-9]+/g,"")}\n${m[0]}\nreturn EN9_attr;`)();
  const distOwner = H(DOC, ENTS);
  const srcOwner = attributePagesToEntities(DOC, ENTS);
  assert.deepStrictEqual([...distOwner.entries()], [...srcOwner.entries()]);
});

/* ---- the shape tests, in both trees, on the same pages ---- */

/* The dist block is self-contained apart from the pieces it shares with the
   rest of the file: the statement-title pattern, the amount-row counter, the
   section-banner lexicon and the questionnaire test. Extracting all four and
   running them beside the source versions is the only way to prove the
   shipped file decides what the source decides. */
function distShapes() {
  const grab = (name) => {
    const a = DIST.indexOf(`/*${name}-BEGIN*/`);
    const b = DIST.indexOf(`/*${name}-END*/`);
    assert.ok(a >= 0 && b > a, `${name} not found in dist`);
    return DIST.slice(a, b + `/*${name}-END*/`.length);
  };
  const banners = (() => {
    const a = DIST.indexOf("var EN9SECTB=");
    const b = DIST.indexOf("];", a);
    assert.ok(a >= 0 && b > a, "EN9SECTB not found in dist");
    return DIST.slice(a, b + 2);
  })();
  const src = [
    banners,
    grab("EN9QUEST"),
    grab("EN9GENERIC"),
    "var EN9NAMENOISE=/^(hoja|p[a\u00e1]gina|page|fecha|date|contpaq|sheet|names? (of|shown)|address|country|currency|identifying|reference|previous|enter|check|see instructions|description)\\b/i;",
    "function V1(d,pg,take){var rows=d.rows.filter(function(r){return r.page===pg});var slice=take===\"head\"?rows.slice(0,14):take===\"foot\"?rows.slice(-3):rows;return slice.map(function(r){return r.cells.map(function(c){return c.text}).join(\" \")}).join(\"\\n\").toLowerCase()}",
    grab("EN9SHAPE"),
    grab("EN9SHAPE2"),
    "return { EN9bsShape, EN9pnlShape, EN9schedPage, EN9questPage, EN9titleRow, EN9headingName, EN9isGeneric };",
  ].join("\n");
  return new Function(src)();
}

const D = distShapes();

const bsPage = { pageCount: 1, rows: [
  { page: 1, cells: [{ text: "ACTIVO" }] },
  { page: 1, cells: [{ text: "Bancos" }, { text: "1,234.00" }] },
  { page: 1, cells: [{ text: "Terrenos" }, { text: "11,999,579.90" }] },
  { page: 1, cells: [{ text: "PASIVO" }] },
  { page: 1, cells: [{ text: "Acreedores diversos" }, { text: "15,541,257.57" }] },
  { page: 1, cells: [{ text: "CAPITAL" }] },
  { page: 1, cells: [{ text: "Capital Social" }, { text: "3,000.00" }] },
  { page: 1, cells: [{ text: "Resultado de ejercicios anteriores" }, { text: "-3,029,900.18" }] },
] };
const schedulePage = { pageCount: 1, rows: [
  { page: 1, cells: [{ text: "Shareholder Current Accounts" }] },
  { page: 1, cells: [{ text: "Opening Balance" }, { text: "1,384.00" }] },
  { page: 1, cells: [{ text: "Funds Introduced" }, { text: "26,000.00" }] },
  { page: 1, cells: [{ text: "Drawings" }, { text: "15,548.00" }] },
  { page: 1, cells: [{ text: "Closing Balance" }, { text: "1,312.00" }] },
] };
const phonePage = { pageCount: 1, rows: [
  { page: 1, cells: [{ text: "Mobile" }, { text: "6421751051" }] },
  { page: 1, cells: [{ text: "IP Address/es" }, { text: "1141348192" }] },
  { page: 1, cells: [{ text: "Signed on Pages" }, { text: "5.1" }] },
  { page: 1, cells: [{ text: "Mobile" }, { text: "6421527032" }] },
  { page: 1, cells: [{ text: "IP Address/es" }, { text: "10314217209" }] },
] };

t("a balance sheet is recognised by its two sides, in Spanish, with no English title", () => {
  assert.strictEqual(CL.looksLikeBalanceSheetShape(bsPage, 1), true);
  assert.strictEqual(D.EN9bsShape(bsPage, 1), true, "dist disagrees");
});

t("a page of money with no section name is a schedule, not a statement", () => {
  assert.strictEqual(CL.looksLikeBalanceSheetShape(schedulePage, 1), false);
  assert.strictEqual(CL.looksLikeSchedulePage(schedulePage, 1), true);
  assert.strictEqual(D.EN9bsShape(schedulePage, 1), false, "dist disagrees on the statement test");
  assert.strictEqual(D.EN9schedPage(schedulePage, 1), true, "dist disagrees on the schedule test");
});

t("phone numbers and IP addresses are not money", () => {
  assert.strictEqual(CL.looksLikeSchedulePage(phonePage, 1), false);
  assert.strictEqual(D.EN9schedPage(phonePage, 1), false, "dist disagrees");
});

t("a form caption is never a company name, in either tree", () => {
  for (const s of ["foreign corporation", "any corporation", "Transactions Between Controlled Foreign Corporation", "the company"]) {
    assert.strictEqual(CL.isGenericCompanyName(s), true, s);
    assert.strictEqual(D.EN9isGeneric(s), true, `dist: ${s}`);
  }
  for (const s of ["EL KIJ EXPORTACIONES S DE RL DE CV", "HMC Communications Ltd", "Rise Digital Marketing"]) {
    assert.strictEqual(CL.isGenericCompanyName(s), false, s);
    assert.strictEqual(D.EN9isGeneric(s), false, `dist: ${s}`);
  }
});

t("the title is found below the head band, and both trees find the same row", () => {
  const rows = [];
  for (let i = 0; i < 16; i++) rows.push({ page: 1, cells: [{ text: `letterhead line ${i}` }] });
  rows.push({ page: 1, cells: [{ text: "BALANCE GENERAL AL 31/DIC/2024" }] });
  rows.push({ page: 1, cells: [{ text: "Bancos" }, { text: "1,234.00" }] });
  const doc = { pageCount: 1, rows };
  assert.strictEqual(CL.titleRowIndex(doc, 1), 16);
  assert.strictEqual(D.EN9titleRow(doc, 1), 16, "dist disagrees");
});

t("accents are decoration: POSICION and POSICIÓN are one title", () => {
  const mk = (title) => ({ pageCount: 1, rows: [{ page: 1, cells: [{ text: title }] }, { page: 1, cells: [{ text: "Bancos" }, { text: "1,234.00" }] }] });
  for (const title of ["POSICI\u00d3N FINANCIERA, BALANCE GENERAL AL 31/DIC/2024", "POSICION FINANCIERA, BALANCE GENERAL AL 31/DIC/2024"]) {
    assert.strictEqual(CL.titleRowIndex(mk(title), 1), 0, title);
    assert.strictEqual(D.EN9titleRow(mk(title), 1), 0, `dist: ${title}`);
  }
});

/* ---- the terminology layer, in both trees ---- */

const TERMS = require("path").join(root, "src/prototype/wp/terms.ts");
const termsBundle = esbuild.buildSync({
  entryPoints: [TERMS], bundle: true, write: false, format: "cjs", platform: "neutral", logLevel: "silent",
}).outputFiles[0].text;
const tMod = { exports: {} };
new Function("module", "exports", "require", `${termsBundle}\n`)(tMod, tMod.exports, require);
const T = tMod.exports;

function distTerms() {
  const a = DIST.indexOf("/*EN9TERMS-BEGIN*/");
  const b = DIST.indexOf("/*EN9TERMS-END*/");
  assert.ok(a >= 0 && b > a, "EN9TERMS not found in dist");
  return new Function(DIST.slice(a, b) + "\nreturn { EN9identifyByTerms, EN9translateCaption, EN9detectTextLanguage, EN9CAPTION_TERMS };")();
}
const DT = distTerms();

t("a tax return is identified by what it calls itself, in Spanish", () => {
  const hit = T.identifyByTerms("SERVICIO DE IMPUESTOS INTERNOS FORM. 22 IMPUESTOS ANUALES A LA RENTA");
  assert.strictEqual(hit && hit.kind, "tax-return");
  const dhit = DT.EN9identifyByTerms("SERVICIO DE IMPUESTOS INTERNOS FORM. 22 IMPUESTOS ANUALES A LA RENTA");
  assert.strictEqual(dhit && dhit.kind, "tax-return", "dist disagrees");
});

t("a return outranks a statement heading printed inside it", () => {
  const text = "IMPUESTOS ANUALES A LA RENTA ... Total del Activo ... Balance General";
  assert.strictEqual(T.identifyByTerms(text).kind, "tax-return");
  assert.strictEqual(DT.EN9identifyByTerms(text).kind, "tax-return", "dist disagrees");
});

t("a statement in a language with no English title is still identified", () => {
  for (const [text, want] of [
    ["ESTADO DE RESULTADOS 2024", "income-statement"],
    ["BALAN\u00c7O PATRIMONIAL", "balance-sheet"],
    ["GEWINN- UND VERLUSTRECHNUNG", "income-statement"],
    ["CONTO ECONOMICO", "income-statement"],
  ]) {
    assert.strictEqual(T.identifyByTerms(text).kind, want, text);
    assert.strictEqual(DT.EN9identifyByTerms(text).kind, want, `dist: ${text}`);
  }
});

t("captions carry their English, whole phrase only, in both trees", () => {
  assert.strictEqual(T.translateCaption("Remuneraciones pagadas"), "wages and salaries paid");
  assert.strictEqual(DT.EN9translateCaption("Remuneraciones pagadas"), "wages and salaries paid", "dist disagrees");
  assert.strictEqual(T.translateCaption("Total del Activo"), "total assets");
  assert.strictEqual(T.translateCaption("a caption nobody has listed"), null, "no partial guessing");
  assert.strictEqual(DT.EN9translateCaption("a caption nobody has listed"), null, "dist guesses");
});

t("the two trees carry the same caption table", () => {
  assert.deepStrictEqual(DT.EN9CAPTION_TERMS, T.CAPTION_TERMS);
});

t("language is decided by function words, not by script", () => {
  for (const [text, want] of [
    ["Ingresos del giro percibidos segun el ejercicio anual, impuesto a la renta pagados", "Spanish"],
    ["Total income for the year ended, assets and liabilities of the company", "English"],
  ]) {
    assert.strictEqual(T.detectTextLanguage(text).name, want, text);
    assert.strictEqual(DT.EN9detectTextLanguage(text).name, want, `dist: ${text}`);
  }
});

/* ---- the parent must re-read itself after a fan-out ---- */

/* An entity processed while it was the only one in the case has every page of
 * its own, so page attribution never ran. Once its siblings exist the tool
 * re-reads it, and THAT is what keeps each corporation's pages to its own
 * work paper. The shipped build asks the preparer to confirm a re-process —
 * right for a button press, wrong for the tool re-reading its own work: the
 * modal appeared mid fan-out, and a Cancel (or a browser that answers no)
 * left CECILIA GONZALEZ ACUNA SPA with both Chilean statements attributed to
 * document companies and nothing booked from her own. */
t("the re-process prompt is skipped while the tool is fanning out", () => {
  assert.ok(DIST.includes("/*EN9REASKFAN-BEGIN*/"), "the guard is missing");
  assert.ok(/if\(!d8&&e\.processedAt&&Object\.keys\(e\.lines\|\|\{\}\)\.length/.test(DIST),
    "the confirm is not guarded by the fan-out flag");
  // The flag is set for exactly the length of the self-read, and the
  // self-read is still called.
  assert.ok(DIST.includes("/*EN9REPARENT*/await Be.processEntity(t);"), "the parent is never re-read");
  assert.ok(/d8=!0;try\{await r_\(t,d\)/.test(DIST), "the flag is not set around the fan-out");
  assert.ok(/finally\{d8=!1\}/.test(DIST), "the flag is never cleared");
});

t("a preparer pressing the button is still asked", () => {
  // Only the fan-out is exempt: the prompt itself, and its wording, stay.
  assert.ok(/Re-process \$\{e\.name\}\?/.test(DIST), "the prompt was removed rather than guarded");
  assert.ok(/mapped line\(s\) will be recomputed from the current documents/.test(DIST));
});

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
