/* Andrew Ban / Macroroots Fintech Consulting SRL (Romanian leu), live run.

   - The IRS publishes no yearly average for the leu and OFX does not carry
     it, so C59 stayed blank: the ECB's daily reference rates are the next
     source, and with nothing reachable an estimate is OFFERED, never written.
   - "Dividend Payouts" printed inside equity is the year's distribution.
   - Retained earnings that do not add up in the client's own currency are the
     client's problem to fix, not a translation adjustment.
   - Book retained earnings and E&P differ by nature; not a warning.
   - "Other revenues" inside the revenue block is gross receipts.
   - The work paper year is known from the start when only a prior return
     states one. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const root = path.join(__dirname, "..");
const load = (entry) => {
  const out = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent", external: ["react", "react-dom"] });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
};
const PROV = load("src/prototype/wp/providers.ts");
const CLS = load("src/prototype/wp/classify.ts");
const S = load("src/prototype/wp/store.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

const series = (n, v) => {
  const rates = {};
  for (let i = 0; i < n; i++) rates[`2024-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`] = { RON: v + (i % 2 ? 0.02 : -0.02) };
  return { amount: 1, base: "USD", rates };
};

t("the ECB daily average fills the leu when the IRS has none", async () => {
  const real = global.fetch;
  let url = "";
  global.fetch = async (u) => { url = String(u); return { ok: true, status: 200, json: async () => series(250, 4.6), text: async () => JSON.stringify(series(250, 4.6)) }; };
  try {
    const r = await PROV.fxFrankfurterAverage("RON", "2024-01-01", "2024-12-31");
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.value.rate, 4.6);
    assert.strictEqual(r.value.points, 250);
    assert.ok(/frankfurter\.dev\/v1\/2024-01-01\.\.2024-12-31\?base=USD&symbols=RON/.test(url), url);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => series(12, 4.6), text: async () => JSON.stringify(series(12, 4.6)) });
    const thin = await PROV.fxFrankfurterAverage("RON", "2024-01-01", "2024-12-31");
    assert.ok(!thin.ok && /only 12/.test(thin.error), "a thin window is refused, never guessed");
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rates: {} }), text: async () => "{}" });
    const none = await PROV.fxFrankfurterAverage("AED", "2024-01-01", "2024-12-31");
    assert.ok(!none.ok && /no AED rate/.test(none.error));
  } finally { global.fetch = real; }
});

const ent = (extra = {}) => ({
  id: "e", name: "e", files: [], processedAt: "x", lines: { "IS:7": { amount: 1 } }, contributions: {}, unmatched: [],
  profile: { cyEnd: "12/31/24", currency: "RON", activity: "x" }, ownership: {}, categories: { "4": true },
  fx: { cyRate: "4.779", pyRate: "4.499" }, fxMeta: {}, docClasses: {}, detected: {}, reviewItems: [], ...extra,
});

t("with nothing reachable an estimate is offered on the blocker, not written", () => {
  const v = S.validateEntity(ent({ fxMeta: { avgRateNote: { source: "no IRS RON average; online fallbacks failed", asOf: "", estimate: 4.639 } } }));
  const b = v.find((r) => r.id === "fx-avg-missing");
  assert.ok(b && b.level === "block");
  assert.strictEqual(b.suggestedValue, 4.639);
  assert.ok(/4\.499 and 4\.779/.test(b.message) && /not an IRS rate/.test(b.message));
  const plain = S.validateEntity(ent()).find((r) => r.id === "fx-avg-missing");
  assert.strictEqual(plain.suggestedValue, undefined);
});

t("a dividend line inside equity is the year's distribution", () => {
  const c = (label, value, field = "eoy") => ({ label, value, field, docId: "d", docName: "d", via: "rule" });
  const e = ent({ contributions: { "BS:61": [c("Dividend Payouts", 43478), c("Retained earnings", 107043), c("Dividend Payouts", 0, "boy")] } });
  assert.deepStrictEqual(S.equityDividendLine(e), { amount: 43478, label: "Dividend Payouts", addsToEquity: true });
  const paid = ent({ contributions: { "BS:61": [c("Dividend disbursed", -100000), c("Retained earnings", 430379)] } });
  assert.deepStrictEqual(S.equityDividendLine(paid), { amount: 100000, label: "Dividend disbursed", addsToEquity: false }, "a reduction of equity is a paid distribution");
  assert.strictEqual(S.equityDividendLine(ent({ contributions: { "BS:61": [c("Dividends payable", 500), c("Retained earnings", 9)] } })), null);
  assert.strictEqual(S.equityDividendLine(ent({ contributions: { "BS:61": [c("Retained earnings", 9)] } })), null);
});

t("a prior return alone names the work paper year from the start", () => {
  const r = CLS.deriveCaseYears([{ kind: "trial-balance", statementYear: null }, { kind: "prior-year-us-return", statementYear: 2023 }]);
  assert.deepStrictEqual([r.cy, r.py, r.afterPrior], [2024, 2023, 2023]);
  const fiscal = CLS.deriveCaseYears([{ kind: "prior-year-us-return", statementYear: 2023, statementPeriodEnd: "03/31/2024" }]);
  assert.strictEqual(fiscal.cy, null, "a stated fiscal period end is not rolled to a calendar year");
});

t("dist carries the same pieces", () => {
  for (const s of ["/*EN9ECBAVG*/", "/*EN9AVGCHAIN*/", "/*EN9AVGEST*/", "/*EN9ESTOFFER*/", "/*EN9EQDIV*/", "/*EN9DIVEQ*/", "/*EN9BOOKSROLL*/",
                   "/*EN9EPNOTE*/", "/*EN9OTHERREV*/", "/*EN9STMTDOC*/", "/*EN9PERIODOK*/", "/*EN9AUTONAME*/", "/*EN9CYAGAIN*/", "/*EN9TBPERIOD*/"]) {
    assert.ok(dist.includes(s), s);
  }
  assert.ok(dist.includes('{label:"Trial balance / statement spreadsheet",kind:"trial-balance"}'));
  const i = dist.indexOf("function EN9eqDivLine(t){"), j = dist.indexOf("\n", i);
  const f = new Function("EN9r2", dist.slice(i, j) + ";return EN9eqDivLine;")((x) => Math.round(x * 100) / 100);
  const c = (label, value, field = "eoy") => ({ label, value, field });
  for (const rows of [[c("Dividend Payouts", 43478), c("Retained earnings", 107043)], [c("Dividend disbursed", -100000)], [c("Dividends payable", 5)], []]) {
    const e = ent({ contributions: { "BS:61": rows } });
    assert.deepStrictEqual(f(e), S.equityDividendLine(e));
  }
});

t("public market mid-rates are the third average source, sampled twice a month", async () => {
  const real = global.fetch;
  const urls = [];
  const mk = (ron) => async (u) => { urls.push(String(u)); return { ok: true, status: 200, json: async () => ({ date: "x", usd: { ron } }), text: async () => JSON.stringify({ usd: { ron } }) }; };
  try {
    global.fetch = mk(4.6);
    const r = await PROV.fxCurrencyApiAverage("RON", "2024-01-01", "2024-12-31");
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.value.rate, 4.6);
    assert.strictEqual(r.value.points, 24);
    assert.ok(urls.some((u) => /currency-api@2024\.6\.15\/v1\/currencies\/usd\.min\.json$/.test(u)), urls[0]);
    urls.length = 0;
    global.fetch = async (u) => { urls.push(String(u)); return { ok: false, status: 404, json: async () => ({}) }; };
    const none = await PROV.fxCurrencyApiAverage("RON", "2024-01-01", "2024-12-31");
    assert.ok(!none.ok && /only 0 sample dates/.test(none.error), none.error);
    assert.ok(urls.some((u) => /2024-06-15\.currency-api\.pages\.dev/.test(u)), "the second mirror is tried");
    // dist mirror gives the same answer
    const i = dist.indexOf("/*EN9CAPIAVG*/"), j = dist.indexOf("/*EN9CAPIAVG-END*/");
    const f = new Function(dist.slice(i, j) + ";return EN9capiAvg;")();
    global.fetch = mk(4.6);
    const d = await f("RON", "2024-01-01", "2024-12-31");
    assert.deepStrictEqual(d.value, r.value);
  } finally { global.fetch = real; }
});

t("Andrew Ban feedback fixes are in both trees", () => {
  const store = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(/const itemCControl = typeof ownPct === "number" && ownPct > 50;/.test(store), "item C over 50% answers the CFC question");
  assert.ok(store.includes("const fromEqLine = "), "an equity-line dividend stays off Schedules R, J and M");
  assert.ok(/ref: "O16", value: taxAbs/.test(store) && /ref: "E57", value: taxAbs/.test(store), "income tax reaches Schedule E and E-1");
  assert.ok(store.includes('"Where it was read"'), "provenance names the page, row and column");
  assert.ok(store.includes("if (filerPartI.pct >= 10) {"), "item C comes down only while the filer's own stake still makes a U.S. shareholder");
  assert.ok(store.includes("eqDiv.addsToEquity"), "only a dividend line that adds to equity stays off Schedules R, J and M");
  for (const s of ["/*EN9DIVSIGN*/", "/*EN9DIVPAID*/", "/*EN9KEEPITEMC*/", "/*EN9SCHETAX*/", "/*EN9WHERE*/", "/*EN9EQNOSCH*/", "/*EN9CAPIAVG*/", "/*EN9CAPICHAIN*/"]) assert.ok(dist.includes(s), s);
  assert.ok(dist.includes('"Where it was read"'));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
