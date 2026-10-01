/* Regression round (17): the gaps left after the full regression.
 *
 *   - Short-term debt is a borrowing: Schedule F line 19 like every other
 *     loan in the catalogue (the filed return and the reviewed paper both put
 *     it there). Taxes payable stay other current liabilities.
 *   - Sundry debtors ("deudores diversos") are other current assets, not
 *     trade receivables; plain debtors and "trade and other debtors" are not
 *     affected.
 *   - A saved v12 catalogue moves short-term debt; an older one gains it.
 *   - Capital printed without its class keeps the class the prior return
 *     filed it under (line 20a preferred when 20b was blank).
 */
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
const ENG = load("src/prototype/wp/engine.ts");
const S = load("src/prototype/wp/store.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const clone = (x) => JSON.parse(JSON.stringify(x));

t("short-term debt is Schedule F line 19; taxes payable stay line 16", () => {
  const R = ENG.DEFAULT_RULES;
  for (const c of ["Short-term debt", "Short term debt", "Short-term loans", "Long-term debt"]) assert.strictEqual(ENG.matchRuleScoped(c, R, "BS"), "BS:OL", c);
  for (const c of ["Taxes payable", "Tax payable"]) assert.strictEqual(ENG.matchRuleScoped(c, R, "BS"), "BS:OCL", c);
});

t("sundry debtors are other current assets; trade debtors are not moved", () => {
  const R = ENG.DEFAULT_RULES;
  for (const c of ["Deudores diversos", "DEUDORES DIVERSOS", "Otros deudores", "Sundry debtors"]) assert.strictEqual(ENG.matchRuleScoped(c, R, "BS"), "BS:OCA", c);
  for (const c of ["Deudores", "Debtors", "Trade and other debtors", "Trade debtors"]) assert.strictEqual(ENG.matchRuleScoped(c, R, "BS"), "BS:11", c);
});

t("a saved v12 catalogue moves short-term debt and gains sundry debtors; an older one gains both", () => {
  const cur = S.RULE_CATALOGUE_VERSION;
  assert.ok(cur >= 13);
  // v12 as shipped: short-term debt shared the taxes-payable group on BS:OCL.
  const v12 = clone(ENG.DEFAULT_RULES).filter((r) => !r.kw.includes("deudores diversos"))
    .map((r) => r.kw.includes("taxes payable") ? { t: "BS:OCL", kw: ["short-term debt", "short term debt", "short-term loans", "short-term loan", "short-term borrowings", "taxes payable", "tax payable"] }
      : r.kw.includes("long-term debt") ? { t: "BS:OL", kw: r.kw.filter((k) => !/^short/.test(k)) } : r);
  assert.strictEqual(ENG.matchRuleScoped("Short-term debt", v12, "BS"), "BS:OCL", "fixture is the v12 behaviour");
  const up = S.upgradeRules(v12, 12);
  assert.strictEqual(ENG.matchRuleScoped("Short-term debt", up, "BS"), "BS:OL");
  assert.strictEqual(ENG.matchRuleScoped("Taxes payable", up, "BS"), "BS:OCL");
  assert.strictEqual(ENG.matchRuleScoped("Deudores diversos", up, "BS"), "BS:OCA");
  // v10 (before debt by term existed): the groups are added whole.
  const v10 = clone(v12).filter((r) => !r.kw.includes("short-term debt") && !r.kw.includes("long-term debt"));
  const up10 = S.upgradeRules(v10, 10);
  assert.strictEqual(ENG.matchRuleScoped("Short-term debt", up10, "BS"), "BS:OL");
  assert.strictEqual(ENG.matchRuleScoped("Taxes payable", up10, "BS"), "BS:OCL");
  assert.strictEqual(ENG.matchRuleScoped("Deudores diversos", up10, "BS"), "BS:OCA");
  assert.deepStrictEqual(S.upgradeRules(clone(up), cur), up, "idempotent");
});

t("dist carries the same catalogue version and upgrade tables", () => {
  assert.ok(/var EN9RULEVER=(1[3-9]);/.test(dist));
  assert.ok(dist.includes('12:["deudores diversos"]'));
  assert.ok(dist.includes('12:[{kw:["short-term debt","short term debt","short-term loans","short-term loan","short-term borrowings"],from:"BS:OCL",to:"BS:OL"}]'));
});

const distCap = (() => {
  const b = dist.indexOf("/*EN9CAPCLASSFN-BEGIN*/"), e = dist.indexOf("/*EN9CAPCLASSFN-END*/");
  assert.ok(b > 0 && e > b, "EN9CAPCLASSFN block present");
  return new Function("$h", dist.slice(b, e) + ";return EN9capClass;")((x) => String(x).toLowerCase().replace(/\s+/g, " ").trim());
})();
const andrew = () => ({
  lines: { "BS:59": { eoy: 100, boy: 100 }, "BS:61": { eoy: 150521 } },
  contributions: { "BS:59": [{ label: "Contributed capital", value: 100, field: "eoy", via: "rule" }, { label: "Contributed capital", value: 100, field: "boy", via: "rule" }] },
  sourceLabels: { "BS:59": { label: "Contributed capital" } }, relabels: {}, mapOverrides: {},
});

t("capital without a class follows the prior return's line 20a", () => {
  for (const [who, fn] of [["src", S.capitalClassFromPrior], ["dist", distCap]]) {
    const m = fn(andrew(), { preferredStock: 22, commonStock: undefined });
    assert.ok(m, who);
    assert.deepStrictEqual(m.lines["BS:58"], { eoy: 100, boy: 100 }, who);
    assert.strictEqual(m.lines["BS:59"], undefined, who);
    assert.strictEqual(m.contributions["BS:58"].length, 2, who);
    assert.strictEqual(m.lines["BS:61"].eoy, 150521, who);
    assert.ok(m.sourceLabels["BS:58"] && !m.sourceLabels["BS:59"], who);
  }
});

t("nothing moves when the prior return used common stock, the caption names a class, or the preparer chose", () => {
  for (const [who, fn] of [["src", S.capitalClassFromPrior], ["dist", distCap]]) {
    assert.strictEqual(fn(andrew(), { preferredStock: 22, commonStock: 5 }), null, who + " common filed");
    assert.strictEqual(fn(andrew(), { preferredStock: 0, commonStock: undefined }), null, who + " no preferred");
    assert.strictEqual(fn(andrew(), {}), null, who + " no prior figures");
    const named = andrew(); named.contributions["BS:59"][0].label = "Ordinary share capital";
    assert.strictEqual(fn(named, { preferredStock: 22 }), null, who + " named class");
    const manual = andrew(); manual.contributions["BS:59"][0].via = "manual";
    assert.strictEqual(fn(manual, { preferredStock: 22 }), null, who + " manual");
    const ov = andrew(); ov.mapOverrides = { "contributed capital": { to: "BS:59" } };
    assert.strictEqual(fn(ov, { preferredStock: 22 }), null, who + " override");
    const taken = andrew(); taken.lines["BS:58"] = { eoy: 5 };
    assert.strictEqual(fn(taken, { preferredStock: 22 }), null, who + " line 20a already filled");
  }
});

t("the prior return's line 20a is read when the heading and its first sub-line print as one row", () => {
  const CF = load("src/prototype/wp/carryForward.ts");
  const fnText = (() => {
    const b = dist.indexOf("function EN9matchColB(");
    let d = 0, j = dist.indexOf("{", b);
    for (; j < dist.length; j++) { if (dist[j] === "{") d++; else if (dist[j] === "}" && --d === 0) break; }
    return dist.slice(b, j + 1);
  })();
  const num = (s) => { const m = /^\(?-?[\d,]+(?:\.\d*)?\)?$/.exec(String(s).trim()); return m ? Number(String(s).replace(/[,()]/g, "")) : null; };
  // The reader splits a cell holding two figures (round 21): its helpers ride along.
  const helpers = ["EN9multiTok", "EN9tokCells", "EN9cfCells"].map((n) => {
    const b = dist.indexOf(`function ${n}(`);
    let d = 0, j = dist.indexOf("{", b);
    for (; j < dist.length; j++) { if (dist[j] === "{") d++; else if (dist[j] === "}" && --d === 0) break; }
    return dist.slice(b, j + 1);
  }).join("\n");
  const DIST = new Function("Oa", helpers + "\n" + fnText + ";return EN9matchColB;")(num);
  // Macroroots 2023 Schedule F, as the reader returns it.
  const rows = [
    { page: 35, cells: [{ text: "20 Capital stock: a Preferred stock ~~~~~~~~", x0: 39 }, { text: "20a", x0: 372 }, { text: "22.", x0: 460 }, { text: "22.", x0: 553 }] },
    { page: 35, cells: [{ text: "b Common stock ~~~~~~~~", x0: 47 }, { text: "20b", x0: 372 }] },
    { page: 35, cells: [{ text: "19 Other liabilities (attach statement) ~~~", x0: 39 }, { text: "SEE STATEMENT 16", x0: 248 }, { text: "19", x0: 374 }, { text: "2,247.", x0: 439 }, { text: "61,180.", x0: 525 }] },
  ];
  for (const [who, fn] of [["src", CF.matchFormLineAtColumn], ["dist", DIST]]) {
    assert.strictEqual(fn(rows, /^preferred stock/i, 525).value, 22, who);
    assert.strictEqual(fn(rows, /^common stock/i, 525), null, who);
    assert.strictEqual(fn(rows, /^other liabilities/i, 525).value, 61180, who);
    assert.strictEqual(fn(rows, /^capital stock/i, 525), null, who + ": the heading itself is not a line");
  }
});

t("the call sites exist in both trees", () => {
  const src = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(/capitalClassFromPrior\(curC,/.test(src));
  assert.ok(dist.includes("/*EN9CAPCLASS-BEGIN*/") && dist.includes("EN9capClass(EN9cc0,"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
