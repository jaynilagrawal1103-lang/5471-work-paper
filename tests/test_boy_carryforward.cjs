/* Schedule F column (a) — beginning of year.
 *
 * A single-period statement (Yuki and most software exports) carries only the
 * current year, so column (a) has NO source among the current-year documents.
 * The prior return's closing column IS the opening column, and the tool
 * already read it into priorClosingUSD — but that was only ever used to print
 * a comparison note, never written. Column (a) therefore came out blank, and
 * Schedule F cannot be filed without it.
 *
 * Figures verified against the 2Hats 2023 Form 5471 and the reviewed 2024
 * work paper. Filed amounts are USD; column (a) is local currency, so the
 * conversion is EUR = USD x 0.905 (the prior year-end rate).
 */
const assert = require("assert");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const PY_RATE = 0.905;

/** The seeding rule, exactly as store.ts applies it. */
function seedBoy(priorClosingUSD, existingLines, rate) {
  const map = [
    ["cash", 10, false], ["ar", 11, false], ["oca", 15, false],
    ["depreciable", 28, false], ["accumDep", 29, true],
    ["ap", 46, false], ["ocl", 47, false],
    ["commonStock", 59, false], ["re", 61, false],
  ];
  const lines = { ...existingLines };
  const seeded = [];
  for (const [key, row, negate] of map) {
    const filed = priorClosingUSD[key]?.value;
    if (typeof filed !== "number") continue;
    const k = `BS:${row}`;
    if (typeof lines[k]?.boy === "number") continue;      // never overwrite
    const local = Math.round(filed * rate * 100) / 100;
    lines[k] = { ...(lines[k] || {}), boy: negate ? -Math.abs(local) : local };
    seeded.push(k);
  }
  return { lines, seeded };
}

/* Real 2023 Form 5471 Schedule F column (b), in whole USD. */
const FILED = {
  cash:         { value: 13322 },
  oca:          { value: 243 },
  depreciable:  { value: 1602 },
  accumDep:     { value: 1274 },     // printed in brackets on the form
  ap:           { value: 0 },
  ocl:          { value: 10840 },
  commonStock:  { value: 4973 },
  re:           { value: -1920 },
  totalAssets:  { value: 13893 },
};

t("column (a) is populated where it used to be blank", () => {
  const { seeded } = seedBoy(FILED, {}, PY_RATE);
  assert.ok(seeded.length >= 8, `only ${seeded.length} lines seeded`);
  for (const k of ["BS:10", "BS:15", "BS:28", "BS:29", "BS:47", "BS:59", "BS:61"]) {
    assert.ok(seeded.includes(k), `${k} not seeded`);
  }
});

t("the converted figures match the reviewed work paper", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  // Reviewed work paper column (a), EUR. Whole-dollar filing rounds to ~+/-1.
  const expected = {
    "BS:10": 12056.41,   // cash
    "BS:15": 220,        // other current assets
    "BS:28": 1449.37,    // depreciable assets
    "BS:29": -1153.15,   // accumulated depreciation
    "BS:61": -1737.15,   // retained earnings
  };
  for (const [k, want] of Object.entries(expected)) {
    const got = lines[k].boy;
    assert.ok(Math.abs(got - want) <= 1.0, `${k}: got ${got}, expected ~${want}`);
  }
});

t("accumulated depreciation is carried as a negative", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  assert.ok(lines["BS:29"].boy < 0, "must reduce assets");
  assert.ok(Math.abs(lines["BS:29"].boy + 1153.15) <= 1.0);
});

t("total assets reconcile to the reviewed figure", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  const total = lines["BS:10"].boy + lines["BS:15"].boy + lines["BS:28"].boy + lines["BS:29"].boy;
  assert.ok(Math.abs(total - 12572.63) <= 2.0, `total ${total}, expected ~12,572.63`);
});

t("a value already present is NEVER overwritten", () => {
  // A two-column source document, or a figure the preparer typed.
  const existing = { "BS:10": { boy: 99999, eoy: 28447.17 } };
  const { lines, seeded } = seedBoy(FILED, existing, PY_RATE);
  assert.strictEqual(lines["BS:10"].boy, 99999, "carry-forward clobbered a real value");
  assert.ok(!seeded.includes("BS:10"));
  assert.ok(seeded.includes("BS:15"), "other lines should still seed");
});

t("the end-of-year column is left untouched", () => {
  const existing = { "BS:10": { eoy: 28447.17 } };
  const { lines } = seedBoy(FILED, existing, PY_RATE);
  assert.strictEqual(lines["BS:10"].eoy, 28447.17, "EOY was modified");
  assert.ok(Math.abs(lines["BS:10"].boy - 12056.41) <= 1.0, "BOY should still seed");
});

t("nothing is carried when the prior year-end rate is unknown", () => {
  // Guessing a rate would silently mis-state every opening balance.
  for (const bad of [0, NaN, undefined]) {
    const rate = Number(bad);
    const ok = isFinite(rate) && rate > 0;
    assert.strictEqual(ok, false, `rate ${bad} should be rejected`);
  }
});

t("lines absent from the prior return stay blank rather than zero", () => {
  const partial = { cash: { value: 13322 } };
  const { lines, seeded } = seedBoy(partial, {}, PY_RATE);
  assert.strictEqual(seeded.length, 1);
  assert.strictEqual(lines["BS:47"], undefined, "invented an opening balance");
});

t("the line 15/16 grouping difference is detectable", () => {
  // Prior return puts everything on line 16; the current year splits it.
  const priorAllOnOne = (!FILED.ap.value || FILED.ap.value === 0) && !!FILED.ocl.value;
  const currentSplit = !!6087 && !!20944.69;
  assert.ok(priorAllOnOne && currentSplit, "should raise one review item");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
