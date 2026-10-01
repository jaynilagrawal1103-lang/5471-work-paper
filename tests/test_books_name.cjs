/* A company whose books print another name (Jacob Kelt / SHORI CORPORATION,
 * statements under "Power Real Group, LLC").
 *
 *   - One Form 5471 in the prior return and one other name on the current
 *     documents is the same company's books or trading name — not a second
 *     foreign corporation. Anything that could be two companies is not.
 *   - The page scope, the fan-out and the agent all treat that name as the
 *     entity's own, in both trees.
 *   - Confirming "same company" remembers the other name; "different
 *     company" switches it off.
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
const S = load("src/prototype/wp/store.ts");
const CLS = load("src/prototype/wp/classify.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const src = fs.readFileSync(path.join(root, "src/prototype/wp/store.ts"), "utf8");
const DIST = (() => {
  const b = dist.indexOf("/*EN9BOOKSALIAS-BEGIN*/"), e = dist.indexOf("/*EN9BOOKSALIAS-END*/");
  assert.ok(b > 0 && e > b, "EN9BOOKSALIAS block present");
  return new Function("Wh", dist.slice(b, e) + ";return EN9booksAlias;")(CLS.entitySimilarity);
})();
const BOTH = [["src", S.booksNameAlias], ["dist", DIST]];

const prior = (...names) => ({ kind: "prior-year-us-return", entityName: names[0], foreignCorpName: names[0], blocks5471: names.map((n) => ({ cfcName: n })) });
const stmt = (name) => ({ kind: "cfc-financial-statements", entityName: name });

t("one Form 5471 and one other name on the statements is the same company's books name", () => {
  for (const [who, fn] of BOTH) {
    assert.deepStrictEqual(fn([stmt("Power Real Group, LLC"), prior("SHORI CORPORATION"), stmt("Power Real Group, LLC")], []),
      { alias: "Power Real Group, LLC", cfcName: "SHORI CORPORATION" }, who);
    // An unnamed page or an unnamed document does not change it.
    assert.ok(fn([stmt("Power Real Group, LLC"), prior("SHORI CORPORATION"), stmt(null)], ["Entity 1"]), who + " placeholder entity");
  }
});

t("anything that could be two companies is not an alias", () => {
  for (const [who, fn] of BOTH) {
    assert.strictEqual(fn([stmt("EL KIJ EXPORTACIONES"), stmt("TEZCATLIPOCA INVERSIONES"), prior("EL KIJ EXPORTACIONES S DE RL DE CV", "TEZCATLIPOCA INVERSIONES S DE RL DE CV")], []), null, who + " two 5471s");
    assert.strictEqual(fn([stmt("Power Real Group, LLC"), stmt("Other Trading Ltd"), prior("SHORI CORPORATION")], []), null, who + " two other names");
    assert.strictEqual(fn([stmt("Power Real Group, LLC"), stmt("SHORI CORPORATION"), prior("SHORI CORPORATION")], []), null, who + " the corporation's own statements are there too");
    assert.strictEqual(fn([stmt("Barnomadics Limited"), prior("BARNOMADICS LIMITED")], []), null, who + " same name is not an alias");
    assert.strictEqual(fn([stmt("Power Real Group, LLC"), prior("SHORI CORPORATION")], ["Power Real Group, LLC"]), null, who + " another entity owns that name");
    assert.strictEqual(fn([stmt("Power Real Group, LLC"), prior("SHORI CORPORATION")], ["SHORI CORPORATION"]), null, who + " another entity owns the corporation");
    assert.strictEqual(fn([stmt("Power Real Group, LLC"), prior("SHORI CORPORATION")], [], { sameEntity: false }), null, who + " preparer said different company");
    assert.ok(fn([stmt("Power Real Group, LLC"), prior("SHORI CORPORATION")], [], { sameEntity: true }), who + " preparer said same company");
    assert.strictEqual(fn([stmt("Power Real Group, LLC")], []), null, who + " no prior return");
  }
});

t("confirming the same company remembers the other name; a different company does not", () => {
  S.actions.addEntity();
  const id = S.getSnapshot().activeEntityId;
  const mm = { statementName: "Power Real Group, LLC", priorName: "SHORI CORPORATION", source: "2023US.pdf" };
  S.loadState({ ...S.getSnapshot(), entities: S.getSnapshot().entities.map((e) => e.id === id ? { ...e, nameMismatch: mm } : e) });
  S.actions.confirmLegalName(id, "SHORI CORPORATION", true);
  let e = S.getSnapshot().entities.find((x) => x.id === id);
  assert.strictEqual(e.profile.legalName, "SHORI CORPORATION");
  assert.deepStrictEqual(e.nameAliases, ["Power Real Group, LLC"]);
  assert.deepStrictEqual(e.nameDecision, { priorName: "SHORI CORPORATION", sameEntity: true });
  S.loadState({ ...S.getSnapshot(), entities: S.getSnapshot().entities.map((x) => x.id === id ? { ...x, nameMismatch: mm, nameAliases: [] } : x) });
  S.actions.confirmLegalName(id, "Power Real Group, LLC", false);
  e = S.getSnapshot().entities.find((x) => x.id === id);
  assert.deepStrictEqual(e.nameAliases, []);
});

t("'different company' takes back what the prior return supplied while the question was open", () => {
  S.actions.addEntity();
  const id = S.getSnapshot().activeEntityId;
  const mm = { statementName: "Power Real Group, LLC", priorName: "SHORI CORPORATION", source: "2023US.pdf" };
  const face = "2023US.pdf · 5471 face";
  S.loadState({ ...S.getSnapshot(), entities: S.getSnapshot().entities.map((e) => e.id === id ? { ...e, name: "SHORI CORPORATION", nameMismatch: mm,
    profile: { ...e.profile, legalName: "SHORI CORPORATION", entityShort: "SHORI CORPORATION", refId: "SHORI01", countryInc: "BELIZE", activity: "E-COMMERCE (typed)" },
    ownership: { ownEnd: "100", cfc: "Yes" },
    detected: { refId: { key: "refId", value: "SHORI01", sourceLabel: face }, countryInc: { key: "countryInc", value: "BELIZE", sourceLabel: face },
      activity: { key: "activity", value: "ECOMMERCE", sourceLabel: face }, ownEnd: { key: "ownEnd", value: "100", sourceLabel: face },
      cyEnd: { key: "cyEnd", value: "12/31/24", sourceLabel: "BS.pdf · period end" } },
    usShareholders: [{ id: "u", name: "JACOB A KELT", boy: 1, eoy: 1, source: "2023US.pdf · Sch B Part I p.16" }],
  } : e) });
  S.actions.confirmLegalName(id, "Power Real Group, LLC", false);
  const e = S.getSnapshot().entities.find((x) => x.id === id);
  assert.strictEqual(e.profile.legalName, "Power Real Group, LLC");
  assert.strictEqual(e.profile.refId, "", "the other corporation's reference ID is gone");
  assert.strictEqual(e.profile.countryInc, "");
  assert.strictEqual(e.profile.activity, "E-COMMERCE (typed)", "a value the preparer changed stays");
  assert.strictEqual(e.ownership.ownEnd, "");
  assert.deepStrictEqual(e.usShareholders, []);
  assert.strictEqual(e.profile.entityShort, "Power Real Group, LLC");
  assert.strictEqual(e.name, "Power Real Group, LLC");
  assert.ok(e.detected.cyEnd, "values read from the statements stay");
  assert.ok(dist.includes("/*EN9DIFFCLEAR-BEGIN*/") && dist.includes("...EN9dc,/*EN9ALIASKEEP*/"));
});

t("the scope, the fan-out and the agent use it in src", () => {
  assert.ok(/const booksAlias = meScope \? booksNameAlias\(/.test(src));
  assert.ok(src.includes("entityScope.some((e) => e.names.some((n) => entitySimilarity(n, nm) >= 0.5))"));
  assert.ok(src.includes("siblingPlans = deduped.filter((c) => c !== selected && c !== pendingBlock && !!c.cfcName);"));
  assert.ok(src.includes("pendingBlock = best;"));
  assert.ok(/else if \(best && !decided && booksAlias && entitySimilarity\(best\.cfcName, booksAlias\.cfcName\) >= 0\.8\)/.test(src));
  assert.ok(src.includes("...(booksAlias ? [booksAlias.alias, booksAlias.cfcName] : [])],"));
  const agent = fs.readFileSync(path.join(root, "src/prototype/wp/agent.ts"), "utf8");
  assert.ok(agent.includes("(ctx?.aliases || []).some((a) => entitySimilarity(String(name), a) >= 0.5)"));
});

t("and in dist", () => {
  for (const tag of ["/*EN9ALIASSCOPE*/", "/*EN9ALIASKEEP*/", "/*EN9PENDBLOCK*/", "/*EN9BOOKSPROV*/", "/*EN9BOOKSASK*/", "/*EN9ALIASHINT*/", "/*EN9ALIASCTX*/", "/*EN9ALIASRISK*/"])
    assert.strictEqual(dist.split(tag).length - 1, 1, tag);
  assert.ok(dist.includes("d=E.filter(y=>y!==p&&y!==EN9pend&&!!y.cfcName);"));
  assert.ok(dist.includes("var EN9pend=null;let Q="));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
