/* A work-paper row that has to carry more than one account says so.
 *
 * The template gives each "attach schedule" line a fixed number of relabel
 * rows — three on Schedule F line 16, twenty-five on Schedule C line 17. A
 * statement with more accounts than that has to share the last row. Sharing
 * is allowed: the form line is a single line and the total stays right. What
 * was wrong was that it happened silently, the row kept the first account's
 * name, and the notice counted only the accounts that arrived AFTER the first
 * one — so a row holding three accounts was reported as holding two.
 *
 * Also pinned here: a rule that lands on the wrong sheet for the page loses,
 * but the catalogue is asked again with the sheet fixed instead of the caption
 * being dropped. "Motor Vehicle" is a depreciable asset on a balance sheet and
 * a running cost on a P&L, and both catalogues own the words.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const load = (entry) => {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
    external: ["react", "react-dom"],
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
};
const STORE = load("src/prototype/wp/store.ts");
const ENG = load("src/prototype/wp/engine.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

const fresh = () => {
  const s = {};
  for (const [k, p] of Object.entries(ENG.POOLS)) s[k] = { byLabel: new Map(), free: [...p.rows], shared: [] };
  return s;
};

t("each distinct caption gets its own row while rows remain", () => {
  const s = fresh();
  assert.deepStrictEqual(STORE.resolvePool(s, "BS:OCL", "Unearned Income"), { target: "BS:48", relabel: "Unearned Income" });
  assert.deepStrictEqual(STORE.resolvePool(s, "BS:OCL", "GST Payable"), { target: "BS:49", relabel: "GST Payable" });
});

t("the same caption twice lands on the same row and is not counted twice", () => {
  const s = fresh();
  STORE.resolvePool(s, "BS:OCL", "GST Payable");
  const again = STORE.resolvePool(s, "BS:OCL", "gst payable");
  assert.strictEqual(again.target, "BS:48");
  assert.strictEqual(again.relabel, undefined);
  assert.deepStrictEqual(STORE.sharedPoolCaptions(s, "BS:OCL"), []);
});

t("the row that has to be shared names every account on it, the first one included", () => {
  const s = fresh();
  const caps = ["Bank overdraft", "GST Payable", "Unearned Income", "Income Tax Payable", "Provisions"];
  const out = caps.map((c) => STORE.resolvePool(s, "BS:OCL", c));
  // three rows for five accounts: two on their own, three sharing the last
  assert.deepStrictEqual(out.map((o) => o.target), ["BS:48", "BS:49", "BS:50", "BS:50", "BS:50"]);
  const shared = STORE.sharedPoolCaptions(s, "BS:OCL");
  assert.deepStrictEqual(shared, ["Unearned Income", "Income Tax Payable", "Provisions"]);
  assert.strictEqual(out[4].relabel, "Other (3 accounts — see Attached schedules)");
  for (const c of shared) assert.ok(out[4].overflowNote.includes(c), c + " is named in the notice");
  assert.ok(/template offers 3/.test(out[4].overflowNote), "the notice says how many rows the template has");
});

t("a lone account on the last row keeps its own name", () => {
  const s = fresh();
  for (const c of ["a", "b", "c"]) STORE.resolvePool(s, "BS:OCL", c);
  assert.strictEqual(STORE.sharedPoolCaptions(s, "BS:OCL").length, 1);
  assert.strictEqual(s.byLabel, undefined);
});

t("Schedule C line 17 shares only past its twenty-fifth account", () => {
  const s = fresh();
  const out = [];
  for (let i = 1; i <= 27; i++) out.push(STORE.resolvePool(s, "IS:OD", "Account " + i));
  assert.strictEqual(out[24].target, "IS:58");
  assert.strictEqual(out[26].target, "IS:58");
  assert.deepStrictEqual(STORE.sharedPoolCaptions(s, "IS:OD"), ["Account 25", "Account 26", "Account 27"]);
});

t("the sharing notice is raised once, from the final state, at warn level", () => {
  const src = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
  assert.ok(/sharedPoolCaptions\(pools, poolKey\)/.test(src), "src raises it from the pool state after the loop");
  assert.ok(/id: `pool-overflow-\$\{target\}`, level: "warn"/.test(src), "src raises it as a warning");
  assert.ok(/EN9POOLSHARED-BEGIN/.test(dist), "the shipped file carries the same pass");
  assert.ok(/EN9POOLSHARE-BEGIN/.test(dist), "the shipped allocator records the first occupant too");
  assert.ok(/EN9ATTSCH-BEGIN/.test(dist), "the shipped file writes the Attached schedules sheet");
  assert.ok(/Attached schedules/.test(src), "src writes the Attached schedules sheet");
});

t("a rule on the wrong sheet is re-asked with the sheet fixed, not dropped", () => {
  const R = ENG.DEFAULT_RULES;
  assert.strictEqual(ENG.matchRule("Motor Vehicle", R), "IS:OD", "unscoped, the P&L rule wins the tie");
  assert.strictEqual(ENG.matchRuleScoped("Motor Vehicle", R, "BS"), "BS:28", "on a balance sheet the asset rule answers");
  assert.strictEqual(ENG.matchRuleScoped("Motor Vehicle Expenses", R, "IS"), "IS:OD");
  assert.strictEqual(ENG.matchRuleScoped("Accounts Receivables", R, "IS"), null, "no IS rule invents an answer");
});

t("SKIP stays reachable from either sheet", () => {
  const R = ENG.DEFAULT_RULES;
  for (const sheet of ["IS", "BS"]) {
    assert.strictEqual(ENG.matchRuleScoped("Total for Assets", R, sheet), "SKIP", sheet);
  }
});

t("scoping never changes an answer that was already on the right sheet", () => {
  const R = ENG.DEFAULT_RULES;
  for (const g of R) {
    for (const kw of g.kw) {
      const plain = ENG.matchRule(kw, R);
      if (!plain || plain === "SKIP") continue;
      const sheet = plain.slice(0, 2);
      assert.strictEqual(ENG.matchRuleScoped(kw, R, sheet), plain, kw);
    }
  }
});

t("the shipped catalogue scan takes the same sheet argument", () => {
  assert.ok(/\/\*EN9SCOPE\*\//.test(dist), "the shipped scan skips rules off the sheet");
  assert.ok(/\/\*EN9FEEDRE\*\//.test(dist), "the shipped booking loop re-asks instead of nulling");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
