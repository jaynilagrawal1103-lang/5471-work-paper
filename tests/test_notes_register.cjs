/* The statement notes, and the shareholder register on the directory page.
 *
 * Both were added because a work paper generated from a real set of accounts
 * differed from the hand-prepared one in ways the face of the statements could
 * not explain:
 *
 *   - Schedule F wants a fixed asset at COST on line 9a with accumulated
 *     depreciation on 9b. The balance sheet prints only the net, and the split
 *     is in the note;
 *   - "Other Non Current Assets" is unmappable, and its note says it is one
 *     thing: intangible assets, which is line 12c;
 *   - the prior return's Schedule B Part II named one of the three
 *     shareholders, and the accounts' own directory names all three.
 *
 * Both readers prove their arithmetic before anything moves, and both are
 * checked here against the src port and the shipped file.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; }
                          catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const root = path.join(__dirname, "..");
function load(entry) {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, write: false,
    format: "cjs", platform: "node", logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const ENG = load("src/prototype/wp/engine.ts");
const CF = load("src/prototype/wp/carryForward.ts");
const STORE = load("src/prototype/wp/store.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

/* ---- the shipped readers, lifted out of dist ---- */
const SHIPPED = (() => {
  const cut = (begin, end) => {
    const b = dist.indexOf(begin), e = dist.indexOf(end);
    assert.ok(b > 0 && e > b, begin + " present in dist");
    return dist.slice(b + begin.length, e);
  };
  const block = cut("/*EN9NOTES-BEGIN*/", "/*EN9NOTES-END*/") +
                cut("/*EN9DIRSH-BEGIN*/", "/*EN9DIRSH-END*/") +
                cut("/*EN9DIRECTORS-BEGIN*/", "/*EN9DIRECTORS-END*/") +
                cut("/*EN9SAMEPERSON-BEGIN*/", "/*EN9SAMEPERSON-END*/");
  const sandbox = {};
  new Function("exports", block +
    ";exports.statementNotes=EN9statementNotes;exports.fixedAssetSplit=EN9fixedAssetSplit;" +
    "exports.noteLookthrough=EN9noteLookthrough;exports.directoryShareholders=EN9directoryShareholders;" +
    "exports.directoryDirectors=EN9directoryDirectors;exports.samePerson=EN9samePerson;")(sandbox);
  return sandbox;
})();

/** A note row: [label, values, x0]. Page 15 unless stated. */
const N = (label, values, x0, page = 15) => ({ label, values, page, x0 });

/* The fixed asset note exactly as the accounts set it out: two classes, each
   with a cost and an accumulated depreciation, then the note's own total. */
const FIXED_ASSET_NOTE = [
  N("Cost", [43517, 21479], 70.9),
  N("Accumulated Depreciation", [-29537, -6202], 70.9),
  N("Total Plant and Equipment", [13980, 15277], 70.9),
  N("Cost", [53838, 35793], 70.9),
  N("Accumulated Depreciation", [-44465, -22404], 70.9),
  N("Total Vehicles", [9373, 13389], 70.9),
  N("Total Property, Plant and Equipment", [23353, 28667], 63.8),
  N("Intangible Assets", [2411, 2411], 63.8),
  N("Total Other Non Current Assets", [2411, 2411], 63.8),
];

t("a note is read backwards from its own closing total", () => {
  const notes = ENG.statementNotes(FIXED_ASSET_NOTE);
  const titles = notes.map((n) => n.title);
  assert.deepStrictEqual(titles,
    ["Plant and Equipment", "Vehicles", "Property, Plant and Equipment", "Other Non Current Assets"]);
  const outer = notes.find((n) => n.title === "Property, Plant and Equipment");
  assert.strictEqual(outer.components.length, 6, "the outer note covers both classes");
  assert.deepStrictEqual(outer.total, [23353, 28667]);
});

t("a note does not run back onto the previous page", () => {
  const rows = [
    N("Accounts Receivable", [111624, 152154], 63.8, 14),
    N("Total Trade and Other Receivables", [111624, 152154], 63.8, 14),
    N("Cost", [43517, 21479], 70.9, 15),
    N("Total Plant and Equipment", [43517, 21479], 70.9, 15),
  ];
  const notes = ENG.statementNotes(rows);
  const pe = notes.find((n) => n.title === "Plant and Equipment");
  assert.strictEqual(pe.components.length, 1, "only the cost row on its own page");
});

t("the fixed asset note gives cost and accumulated depreciation per column", () => {
  const split = ENG.fixedAssetSplit(ENG.statementNotes(FIXED_ASSET_NOTE));
  assert.deepStrictEqual(split.cost, [43517 + 53838, 21479 + 35793]);
  assert.deepStrictEqual(split.accumDep, [29537 + 44465, 6202 + 22404]);
  assert.deepStrictEqual(split.net, [23353, 28667]);
});

t("the OUTER note wins over the classes inside it", () => {
  // "Plant and Equipment" and "Vehicles" match the same pattern; taking either
  // would book one class as the whole fixed asset.
  const split = ENG.fixedAssetSplit(ENG.statementNotes(FIXED_ASSET_NOTE));
  assert.strictEqual(split.cost[0], 97355, "both classes, not just the first");
});

t("a note whose cost less depreciation does not tie is refused", () => {
  const broken = FIXED_ASSET_NOTE.map((r) =>
    r.label === "Total Property, Plant and Equipment" ? N(r.label, [99999, 28667], 63.8) : r);
  assert.strictEqual(ENG.fixedAssetSplit(ENG.statementNotes(broken)), null,
    "a note we have misread must book nothing");
});

t("a class that states a cost but no depreciation is refused", () => {
  const rows = [
    N("Cost", [43517, 21479], 70.9),
    N("Total Plant and Equipment", [43517, 21479], 70.9),
    N("Total Property, Plant and Equipment", [43517, 21479], 63.8),
  ];
  assert.strictEqual(ENG.fixedAssetSplit(ENG.statementNotes(rows)), null);
});

t("a note holding exactly one thing renames the caption to that thing", () => {
  const look = ENG.noteLookthrough(ENG.statementNotes(FIXED_ASSET_NOTE));
  assert.strictEqual(look.get("other non current assets"), "Intangible Assets");
  assert.ok(!look.has("property, plant and equipment"), "a note listing several things says nothing");
});

t("a single component that does NOT equal the total is refused", () => {
  const rows = [N("Intangible Assets", [2400, 2411], 63.8), N("Total Other Non Current Assets", [2411, 2411], 63.8)];
  assert.strictEqual(ENG.noteLookthrough(ENG.statementNotes(rows)).size, 0);
});

t("src and the shipped file read the notes identically", () => {
  const mine = ENG.statementNotes(FIXED_ASSET_NOTE).map((n) => [n.title, n.total, n.components.length]);
  const theirs = SHIPPED.statementNotes(FIXED_ASSET_NOTE).map((n) => [n.title, n.total, n.components.length]);
  assert.deepStrictEqual(mine, theirs);
  assert.deepStrictEqual(ENG.fixedAssetSplit(ENG.statementNotes(FIXED_ASSET_NOTE)),
                         SHIPPED.fixedAssetSplit(SHIPPED.statementNotes(FIXED_ASSET_NOTE)));
  const a = [...ENG.noteLookthrough(ENG.statementNotes(FIXED_ASSET_NOTE))].sort();
  const b = Object.entries(SHIPPED.noteLookthrough(SHIPPED.statementNotes(FIXED_ASSET_NOTE))).sort();
  assert.deepStrictEqual(a, b);
});

/* ---- the shareholder register ---- */

const R = (cells, page = 3) => ({ page, cells });
const DIRECTORY = [
  R(["Directors"]), R(["Heather Claycomb"]), R(["Rodney Claycomb"]),
  R(["Shareholders"]),
  R(["Heather Claycomb 1 Ordinary"]),
  R(["Rodney Claycomb 1 Ordinary"]),
  R(["ARCK Trust", "98 Ordinary"]),
  R(["Company Status"]), R(["Close Company"]),
];

t("the register is read, however the row builder split the cells", () => {
  const found = CF.directoryShareholders(DIRECTORY);
  assert.deepStrictEqual(found.map((h) => [h.name, h.boy, h.eoy]),
    [["Heather Claycomb", 1, 1], ["Rodney Claycomb", 1, 1], ["ARCK Trust", 98, 98]]);
  assert.strictEqual(found.reduce((n, h) => n + h.eoy, 0), 100, "and they account for every share");
});

t("the list ends at the first line that is not a holding", () => {
  const found = CF.directoryShareholders(DIRECTORY);
  assert.ok(!found.some((h) => /Company Status|Close Company/.test(h.name)));
});

t("the DIRECTORS list above it is not mistaken for the register", () => {
  // Those lines carry no share count, so they cannot match.
  const found = CF.directoryShareholders([R(["Directors"]), R(["Heather Claycomb"]), R(["Rodney Claycomb"])]);
  assert.deepStrictEqual(found, []);
});

t("a document with no register yields nothing, not a guess", () => {
  assert.deepStrictEqual(CF.directoryShareholders([R(["Statement of Financial Position"]), R(["Total Assets", "179,864"])]), []);
});

t("share counts with thousands separators and named classes are read", () => {
  const found = CF.directoryShareholders([R(["Shareholders"]), R(["Big Holdings Ltd 1,250,000 Class A Shares"])]);
  assert.deepStrictEqual(found.map((h) => [h.name, h.eoy, h.classOfShares]), [["Big Holdings Ltd", 1250000, "Class A"]]);
});

t("src and the shipped file read the register identically", () => {
  assert.deepStrictEqual(CF.directoryShareholders(DIRECTORY).map((h) => [h.name, h.boy, h.eoy, h.classOfShares]),
                         SHIPPED.directoryShareholders(DIRECTORY).map((h) => [h.name, h.boy, h.eoy, h.classOfShares]));
});

/* ---- the wiring, in both trees ---- */

t("the pipeline reads the notes and the register", () => {
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(store.includes("statementNotes(extractPositionedRows"), "notes pages are extracted");
  assert.ok(store.includes("fixedAssetSplit(notes)"), "the split is taken");
  assert.ok(store.includes("directoryShareholders(parsed.pdf.rows"), "the register is read");
  for (const s of ["/*EN9NOTECALL-BEGIN*/", "/*EN9DIRCALL-BEGIN*/", "/*EN9DIRSEED-BEGIN*/"]) {
    assert.ok(dist.includes(s), s + " in the shipped file");
  }
});

t("a truncated Schedule B name is the same holder as the register's", () => {
  // The form cuts a long name at the column edge: "ARCK TRUST (ARCK LEGACY
  // TRUS". Counted as a second holder it doubles the trust's 98 shares.
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(/const sameHolder = /.test(store), "src dedupes on a name prefix");
  assert.ok(dist.includes("EN9same2="), "so does the shipped file");
});

/* ---- acknowledging a blocking exception ---- */

t("any reason is accepted — a short one is still a reason", () => {
  /* An earlier version demanded fifteen characters and rejected a list of
     filler words. It refused real answers for being short ("Rod confirmed" is
     thirteen characters) and left no way to acknowledge a blocker in order to
     see what the workbook looks like. The preparer signs the return. */
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(/item\.level === "block" && !String\(note \|\| ""\)\.trim\(\)/.test(store),
    "only an EMPTY note is refused");
  assert.ok(!/said\.length < 15/.test(store), "the fifteen-character rule is gone");
  assert.ok(dist.includes('n.level==="block"&&!String(i||"").trim()'), "and in the shipped file");
});

t("a thin note is recorded as thin, not refused", () => {
  const thin = ["test", "testing", "ok", "n/a", "x", "...", "done", "checked", "asdf", "-"];
  for (const n of thin) assert.strictEqual(STORE.isThinNote(n), true, n);
  const real = ["Rod confirmed", "Client confirmed the figure", "Agreed with the preparer on 18/09",
                "Immaterial — 2 of rounding", "Vodafone loan is non-current per note 7"];
  for (const n of real) assert.strictEqual(STORE.isThinNote(n), false, n);
});

t("the Provenance sheet says when a blocker was waved through", () => {
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(store.includes("NOTE GIVES NO REASON: check this figure before filing"),
    "src marks it");
  assert.ok(dist.includes("NOTE GIVES NO REASON: check this figure before filing"),
    "the shipped file marks it too");
});

t("Schedule F states its own out-of-balance on its face, in every column", () => {
  // The real defect was never the length of the note: it was that the
  // generated workbook said nothing about the imbalance where a reviewer
  // would look.
  const JSZip = require("jszip");
  return JSZip.loadAsync(fs.readFileSync(path.join(root, "assets", "master-template.xlsx")))
    .then((zip) => zip.file("xl/worksheets/sheet5.xml").async("string"))
    .then((xml) => {
      assert.ok(/Out of balance \(assets less liabilities and capital\)/.test(xml), "the row is labelled");
      for (const ref of ["D64", "F64", "G64", "H64"]) {
        assert.ok(new RegExp('<c r="' + ref + '"[^>]*><f>ROUND\\(' + ref[0]).test(xml), ref + " computes it");
      }
    });
});

/* ---- Basic Information ---- */

t("the entity address fills consecutive lines, with no hole", () => {
  /* The shipped build sorted the lines into street / city / region. On a
     two-line address nothing looked like a city, so address line 2 was left
     blank and the country printed on line 3 with a gap above it. The three
     template cells sit under one "Entity Address" label: they are lines. */
  assert.deepStrictEqual(CF.addressLines(["49 SHRULE PLACE", "HAMILTON 3210 NEW ZEALAND"]),
    ["49 SHRULE PLACE", "HAMILTON 3210 NEW ZEALAND"]);
  assert.deepStrictEqual(CF.addressLines(["1 High St", "", "  ", "Springfield", "NEW ZEALAND"]),
    ["1 High St", "Springfield", "NEW ZEALAND"], "blanks are closed up and only three lines fit");
  assert.deepStrictEqual(CF.addressLines([]), []);
  assert.ok(dist.includes("/*EN9ADDRLINES*/"), "the shipped file does the same");
});

t("the directors are read from the accounts' own directory page", () => {
  const rows = [
    R(["Directory"]), R(["Nature of Business"]), R(["Consultancy"]),
    R(["Directors"]), R(["Heather Claycomb"]), R(["Rodney Claycomb"]),
    R(["Shareholders"]), R(["Heather Claycomb 1 Ordinary"]),
  ];
  assert.deepStrictEqual(CF.directoryDirectors(rows), ["Heather Claycomb", "Rodney Claycomb"]);
  assert.deepStrictEqual(CF.directoryDirectors(rows), SHIPPED.directoryDirectors(rows), "both trees");
});

t("the shareholder list below it is not read as directors", () => {
  const rows = [R(["Directors"]), R(["Shareholders"]), R(["ARCK Trust 98 Ordinary"])];
  assert.deepStrictEqual(CF.directoryDirectors(rows), []);
});

t("a middle initial does not stop the filer matching a director", () => {
  // Item H could not answer it, so the accounts do: the filer is
  // "RODNEY W. CLAYCOMB" and the directory says "Rodney Claycomb".
  assert.strictEqual(CF.samePerson("RODNEY W. CLAYCOMB", "Rodney Claycomb"), true);
  assert.strictEqual(CF.samePerson("Rodney Claycomb", "Heather Claycomb"), false, "same surname is not enough");
  assert.strictEqual(CF.samePerson("Rodney Claycomb", "Rodney Smith"), false);
  assert.strictEqual(CF.samePerson("Claycomb", "Rodney Claycomb"), false, "one word proves nothing");
  assert.ok(dist.includes("/*EN9SAMEPERSON-BEGIN*/"), "the shipped file has it too");
});

t("the 10% corporate-shareholder test reads the register, not the truncated name", () => {
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(/const holders = \[\.\.\.directory, \.\.\.\(cf\.holders/.test(store),
    "the register goes first");
  assert.ok(dist.includes("/*EN9TENPCTREG*/"), "and in the shipped file");
  // The form truncates at the column edge, and the corporate test is anchored
  // on the END of the name, so the truncated form fails it.
  assert.strictEqual(STORE.isCorporateName("ARCK TRUST (ARCK LEGACY TRUS"), false);
  assert.strictEqual(STORE.isCorporateName("ARCK Trust"), true);
});

t("the filer's director status is proposed from the accounts when Item H cannot answer", () => {
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(store.includes('named as a director'), "src proposes it");
  assert.ok(dist.includes("/*EN9OFFICER-BEGIN*/"), "the shipped file proposes it");
});

if (fail) process.exit(1);
console.log(`\n${pass} passed`);
