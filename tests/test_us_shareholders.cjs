/* Schedule B Part I must reach the U.S. Shareholders block (rows 7-14).
 *
 * The block used to be unreachable: engine.ts marked rows 7-16 as formula
 * cells so every write was refused, no writer targeted those rows, and the
 * master template ships B7/H7/J7 as =B19/=H19/=J19 — a one-row mirror of the
 * FIRST DIRECT holder. On HMC Communications that printed a New Zealand trust
 * as a 100% U.S. shareholder while the two U.S. shareholders named in Part I
 * appeared nowhere, and the Subpart F column stayed blank because Part I
 * column (e) is its only source.
 *
 * Both trees are checked: the src helper, and the shipped EN9USSH region.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; }
                          catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const here = (...p) => path.join(__dirname, "..", ...p);

function load(entry) {
  const out = esbuild.buildSync({ entryPoints: [here(entry)], bundle: true, write: false,
    format: "cjs", platform: "node", logLevel: "silent" });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const ENG = load("src/prototype/wp/engine.ts");
const STORE = load("src/prototype/wp/store.ts");
const dist = fs.readFileSync(here("dist", "index.html"), "utf8");

/* ---- the shipped region, evaluated on its own ---- */
const m = /\/\*EN9USSH-BEGIN\*\/([\s\S]*?)\/\*EN9USSH-END\*\//.exec(dist);
assert(m, "EN9USSH region not found in dist");
const distWrites = new Function("Ce", m[1] + ";return EN9usShWrites;")({ shareholding: "Shareholding Details" });

const SH = ENG.SHEET.shareholding;
const PART_I = [
  { name: "RODNEY W CLAYCOMB", classOfShares: "COMMON", boy: 25.5, eoy: 25.5, pct: 25.5, source: "prior 5471" },
  { name: "HEATHER M CLAYCOMB", classOfShares: "COMMON", boy: 25.5, eoy: 25.5, pct: 25.5, source: "prior 5471" },
];
const at = (rows, ref) => rows.find((w) => w.ref === ref);

/* ---------------- 1. rows 7-14 are writable, formulas are not ---------------- */
const writable = ENG.FORMULA_REFS[SH];
t("the U.S. block's data columns are writable (B/F/H/J/P rows 7-14)", () => {
  for (const ref of ["B7", "F7", "H7", "J7", "P7", "B14", "J14", "P14"]) {
    assert.strictEqual(writable(ref), false, `${ref} must be writable`);
  }
});
t("the U.S. block's percentage columns stay formulas", () => {
  for (const ref of ["L7", "N7", "L14", "N14"]) assert.strictEqual(writable(ref), true, `${ref} is a formula`);
});
t("the U.S. block totals stay formulas", () => {
  for (const ref of ["H15", "J15", "L15", "N15", "P15", "L16", "N16"]) {
    assert.strictEqual(writable(ref), true, `${ref} is a total`);
  }
});
t("the direct block below is untouched by the change", () => {
  for (const ref of ["B19", "F19", "H19", "J26"]) assert.strictEqual(writable(ref), false, `${ref} stays writable`);
  assert.strictEqual(writable("H27"), true, "the direct total stays a formula");
  assert.strictEqual(writable("L19"), true, "the direct % column stays a formula");
});

/* ---------------- 2. what gets written ---------------- */
for (const [label, fn] of [["src", STORE.usShareholderWrites], ["dist", distWrites]]) {
  t(`${label}: both Part I holders land on rows 7 and 8`, () => {
    const rows = fn(PART_I, "prior 5471");
    assert.strictEqual(at(rows, "B7").value, "RODNEY W CLAYCOMB");
    assert.strictEqual(at(rows, "B8").value, "HEATHER M CLAYCOMB");
    assert.strictEqual(at(rows, "H7").value, 25.5);
    assert.strictEqual(at(rows, "J8").value, 25.5);
    assert.strictEqual(at(rows, "F7").value, "COMMON");
    assert(rows.every((w) => w.sheet === SH), "every write targets Shareholding Details");
  });
  t(`${label}: the pro rata percentage reaches the Subpart F column as a fraction`, () => {
    const rows = fn(PART_I, "prior 5471");
    // The cell is formatted as a percentage, so 25.5% is stored as 0.255.
    assert.strictEqual(at(rows, "P7").value, 0.255);
    assert.strictEqual(at(rows, "P8").value, 0.255);
    const total = at(rows, "P7").value + at(rows, "P8").value;
    assert.ok(Math.abs(total - 0.51) < 1e-9, `combined Subpart F should be 51%, got ${total}`);
  });
  t(`${label}: unused rows are cleared so the template mirror cannot survive`, () => {
    const rows = fn(PART_I, "prior 5471");
    for (const row of [9, 10, 11, 12, 13, 14]) {
      for (const col of ["B", "F", "H", "J", "P"]) {
        assert.strictEqual(at(rows, `${col}${row}`).value, "", `${col}${row} must be cleared`);
      }
    }
  });
  t(`${label}: nothing is written to the direct block`, () => {
    const rows = fn(PART_I, "prior 5471");
    assert(!rows.some((w) => /^[A-Z]+(1[5-9]|2\d)$/.test(w.ref)), "must not touch rows 15+");
  });
  t(`${label}: no Part I data writes nothing at all`, () => {
    assert.deepStrictEqual(fn([], "prior 5471"), []);
    assert.deepStrictEqual(fn(undefined, "prior 5471"), []);
  });
  t(`${label}: a holder with no stated percentage clears the Subpart F cell`, () => {
    const rows = fn([{ name: "SOLE US OWNER", classOfShares: "COMMON", boy: 100, eoy: 100 }], "src");
    assert.strictEqual(at(rows, "B7").value, "SOLE US OWNER");
    assert.strictEqual(at(rows, "P7").value, "", "row 7 is cleared, not left mirroring");
  });
  t(`${label}: at most eight holders are written`, () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `H${i}`, classOfShares: "COMMON", boy: 1, eoy: 1 }));
    const rows = fn(many, "src");
    assert.strictEqual(at(rows, "B14").value, "H7");
    assert(!rows.some((w) => w.ref === "B15"), "must not spill past row 14");
  });
}

/* ---------------- 3. the two trees agree exactly ---------------- */
t("src and the shipped file produce identical writes", () => {
  const strip = (rows) => rows.map((w) => `${w.ref}=${JSON.stringify(w.value)}`).sort();
  assert.deepStrictEqual(strip(STORE.usShareholderWrites(PART_I, "x")), strip(distWrites(PART_I, "x")));
});

/* ---------------- 4. the percentage survives the write path ---------------- */
t("the Subpart F percentage is written with enough decimals", () => {
  // buildWrites rounds numbers to 2 dp unless the write says otherwise, which
  // shipped 25.5% as 0.26 (26%). A percentage stored as a fraction needs more.
  for (const fn of [STORE.usShareholderWrites, distWrites]) {
    const p7 = at(fn(PART_I, "x"), "P7");
    assert.strictEqual(p7.value, 0.255);
    assert.ok((p7.dp || 0) >= 4, `P7 must carry a dp of at least 4, got ${p7.dp}`);
  }
});

/* ---------------- 5. the template mirror can be overwritten ---------------- */
t("the curated map lets a write replace the template's mirror formula", () => {
  // Shareholding Details B7/H7/J7 ship as =B19/=H19/=J19. setCell refuses to
  // replace a formula with a plain value unless the caller says the curated
  // map does not claim that ref — which is exactly the case here.
  const XP = load("src/prototype/wp/xlsxPatch.ts");
  const xml = '<sheetData><row r="7"><c r="B7"><f>B19</f><v>ARCK TRUST</v></c></row></sheetData>';
  assert.ok(/<f>B19<\/f>/.test(XP.setCell(xml, "B7", "RODNEY W CLAYCOMB")), "protected by default");
  const opened = XP.setCell(xml, "B7", "RODNEY W CLAYCOMB", true);
  assert.ok(!/<f>/.test(opened), "the mirror formula is gone once allowed");
  assert.ok(/RODNEY W CLAYCOMB/.test(opened), "the U.S. shareholder's name replaced it");
});
t("the shipped file threads the same allowance through its writer", () => {
  assert(dist.includes("/*EN9FMLOVR-BEGIN*/"), "setCell takes the allow flag");
  assert(dist.includes("/*EN9FMLGUARD-BEGIN*/"), "the guard honours it");
  assert(/EN9FMLARG\*\/\{mayReplaceFormula:/.test(dist), "the caller supplies the allow-list");
  assert(/EN9sh===Ce\.shareholding&&\/\^\[BFHJP\]/.test(dist),
    "and that allow-list is only the U.S. Shareholders block, not every formula");
});

/* ---------------- 6. the shipped file is actually wired up ---------------- */
t("the shipped file calls the writer from both save paths", () => {
  assert(/EN9USSHR\*\/EN9usShWrites\(t\.usShareholders\)/.test(dist), "Shareholders-tab edit path");
  assert(/EN9USSHW\*\/EN9usShWrites\(t\.usShareholders,A\)/.test(dist), "processing path");
  assert(dist.includes("/*EN9USSEED-BEGIN*/"), "Part I is seeded onto the entity");
  assert(dist.includes('id:"cf-us-holders-absent"'), "warns when Part I is missing");
  assert(dist.includes('id:"cf-us-holder-base"'), "warns when the two parts disagree");
  assert(dist.includes("/*EN9USSHF*/usShareholders:[]"), "new entities start with an empty list");
});

if (fail) process.exit(1);
console.log(`\n${pass} passed`);
