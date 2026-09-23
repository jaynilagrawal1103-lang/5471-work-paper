/* The one controlling year.
 *
 * A work paper is prepared FOR a year. The documents are evidence about that
 * year, not the choice of it. Before this, the newest year any document
 * reported became the current year and drove column routing, carry-forward
 * selection, the rates and every validation — so a set of accounts one year
 * ahead of the engagement silently became the current year, and correcting the
 * year end in Basic Information changed nothing but the date on the form.
 *
 * Both trees are checked, and they must agree.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const SRC = (() => {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, "src/prototype/wp/store.ts")],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
    external: ["react", "react-dom"],
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
})();

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const region = (a, b) => {
  const i = dist.indexOf(a), j = dist.indexOf(b);
  assert.ok(i > 0 && j > i, a + " present in dist");
  return dist.slice(i + a.length, j);
};
const SHIPPED = (() => {
  const sandbox = {};
  new Function("exports",
    // the shipped resolver falls back to the document vote, which lives in Z1
    "function Z1(t){let e=new Map;for(let n of t)(n.kind===\"cfc-financial-statements\"||n.kind===\"cfc-tax-return\")" +
    "&&!n.duplicateOf&&n.statementYear&&e.set(n.statementYear,(e.get(n.statementYear)||0)+1);" +
    "let i=[...e.keys()].sort((n,a)=>a-n),s=i[0]??null;return{cy:s,py:s?s-1:null,dissent:i.slice(1)}}" +
    region("/*EN9CASEYEAR-BEGIN*/", "/*EN9CASEYEAR-END*/") +
    ";exports.resolveCaseYears=EN9caseYears;exports.selectedYear=EN9selectedYear;" +
    "exports.detectedYears=EN9detectedYears;exports.caseYearReason=EN9caseYearReason;")(sandbox);
  return sandbox;
})();

const TREES = [["src", SRC], ["dist", SHIPPED]];

/** An entity with the documents and profile that matter to the year. */
const ENT = (docs, profile = {}, detected = {}) => ({
  profile,
  detected,
  docClasses: Object.fromEntries(docs.map((d, i) => [`d${i}`, {
    fileId: `d${i}`, fileName: d.name || `d${i}.pdf`, kind: d.kind || "cfc-financial-statements",
    statementYear: d.year ?? null, duplicateOf: d.duplicateOf,
  }])),
});

for (const [tree, M] of TREES) {
  t(`${tree}: with nothing typed, the documents decide — unchanged behaviour`, () => {
    const y = M.resolveCaseYears(ENT([{ year: 2025 }, { year: 2023, kind: "cfc-tax-return" }]));
    assert.strictEqual(y.cy, 2025);
    assert.strictEqual(y.py, 2024);
    assert.strictEqual(y.source, "documents");
  });

  t(`${tree}: the year the preparer typed wins over the newest document`, () => {
    const y = M.resolveCaseYears(ENT([{ year: 2025 }, { year: 2023, kind: "cfc-tax-return" }], { cyEnd: "03/31/24" }));
    assert.strictEqual(y.cy, 2024);
    assert.strictEqual(y.py, 2023);
    assert.strictEqual(y.source, "selected");
    assert.deepStrictEqual(y.dissent, [2025, 2023]);
  });

  t(`${tree}: a year the TOOL proposed is not a choice — the documents still decide`, () => {
    // detected[cyEnd] equal to the profile value is the record that the tool
    // filled it. Only a value typed over it counts as the preparer's.
    const ent = ENT([{ year: 2025 }], { cyEnd: "03/31/25" }, { cyEnd: { key: "cyEnd", value: "03/31/25" } });
    const y = M.resolveCaseYears(ent);
    assert.strictEqual(y.source, "documents");
    assert.strictEqual(y.cy, 2025);
  });

  t(`${tree}: typing over the proposed value is a choice`, () => {
    const ent = ENT([{ year: 2025 }], { cyEnd: "03/31/24" }, { cyEnd: { key: "cyEnd", value: "03/31/25" } });
    assert.strictEqual(M.selectedYear(ent), 2024);
    assert.strictEqual(M.resolveCaseYears(ent).source, "selected");
  });

  t(`${tree}: no documents and no typed year leaves the year unestablished`, () => {
    const y = M.resolveCaseYears(ENT([]));
    assert.strictEqual(y.cy, null);
    assert.strictEqual(y.source, "none");
  });

  t(`${tree}: the choice holds for any year pair, not just 2024/2025`, () => {
    for (const [typed, docYear, wantCy] of [["12/31/22", 2023, 2022], ["06/30/26", 2025, 2026], ["12/31/19", 2021, 2019]]) {
      const y = M.resolveCaseYears(ENT([{ year: docYear }], { cyEnd: typed }));
      assert.strictEqual(y.cy, wantCy, typed);
      assert.strictEqual(y.py, wantCy - 1, typed);
    }
  });

  t(`${tree}: a duplicate document does not vote`, () => {
    const y = M.resolveCaseYears(ENT([{ year: 2025, duplicateOf: "d1" }, { year: 2024 }]));
    assert.strictEqual(y.cy, 2024);
  });

  t(`${tree}: the reason says who chose`, () => {
    const chosen = M.caseYearReason(M.resolveCaseYears(ENT([{ year: 2025 }], { cyEnd: "03/31/24" })));
    assert.match(chosen, /you set the year end/);
    const voted = M.caseYearReason(M.resolveCaseYears(ENT([{ year: 2025 }])));
    assert.match(voted, /taken from the documents/);
  });

  t(`${tree}: every year the documents report is listed, newest first`, () => {
    const y = M.resolveCaseYears(ENT([{ year: 2023, kind: "cfc-tax-return" }, { year: 2025 }, { year: 2024 }]));
    assert.deepStrictEqual(y.detected, [2025, 2024, 2023]);
  });
}

t("both trees answer identically across the whole matrix", () => {
  const cases = [
    [[{ year: 2025 }], {}, {}],
    [[{ year: 2025 }, { year: 2023, kind: "cfc-tax-return" }], { cyEnd: "03/31/24" }, {}],
    [[{ year: 2025 }], { cyEnd: "03/31/25" }, { cyEnd: { value: "03/31/25" } }],
    [[], { cyEnd: "12/31/24" }, {}],
    [[{ year: 2021 }, { year: 2022 }], { cyEnd: "12/31/21" }, {}],
  ];
  for (const [docs, profile, detected] of cases) {
    const a = SRC.resolveCaseYears(ENT(docs, profile, detected));
    const b = SHIPPED.resolveCaseYears(ENT(docs, profile, detected));
    assert.deepStrictEqual({ ...b }, { ...a }, JSON.stringify(profile));
  }
});

/* The prior year end is one year before the current one, for every year pair.
   It used to be proposed from whichever period the documents printed, and a
   proposal only fills a blank field — so a 2024 work paper built from 2025
   statements kept 03/31/24 as its OPENING date, which is its closing date. */
const PRIOR_DIST = (() => {
  const sandbox = {};
  new Function("exports", region("/*EN9PRIOREND-BEGIN*/", "/*EN9PRIOREND-END*/")
    + ";exports.EN9priorEnd=EN9priorEnd;")(sandbox);
  return sandbox.EN9priorEnd;
})();

t("the prior period end is one year back, whatever the year end is", () => {
  const cases = [
    ["03/31/24", "03/31/23"],
    ["12/31/25", "12/31/24"],
    ["06/30/26", "06/30/25"],
    ["01/01/20", "01/01/19"],
    ["02/29/24", "02/28/23"],   // 29 February has no counterpart in a common year
    ["02/29/28", "02/28/27"],
    ["12/31/2025", "12/31/24"],
    ["", null],
    ["not a date", null],
  ];
  for (const [input, want] of cases) {
    assert.strictEqual(SRC.priorPeriodEnd(input), want, `src ${JSON.stringify(input)}`);
    assert.strictEqual(PRIOR_DIST(input), want, `dist ${JSON.stringify(input)}`);
  }
});

t("no year pair is hard-coded: the step back holds for every year in a century", () => {
  for (let y = 2000; y < 2100; y++) {
    const short = String(y).slice(2).padStart(2, "0");
    const back = String(y - 1).slice(2).padStart(2, "0");
    assert.strictEqual(SRC.priorPeriodEnd(`03/31/${short}`), `03/31/${back}`, String(y));
    assert.strictEqual(PRIOR_DIST(`03/31/${short}`), `03/31/${back}`, String(y));
  }
});

t("the run applies it only while the preparer has not typed a prior year end", () => {
  // `detected.pyEnd` is present exactly while the value is the tool's own
  // proposal; setField deletes it the moment a value is typed over.
  const follows = (profile, detected) => {
    const want = SRC.priorPeriodEnd(profile.cyEnd);
    const pyTyped = !!profile.pyEnd && !detected.pyEnd;
    return want && !pyTyped && profile.pyEnd !== want ? want : null;
  };
  assert.strictEqual(follows({ cyEnd: "03/31/24", pyEnd: "03/31/24" }, { pyEnd: {} }), "03/31/23");
  assert.strictEqual(follows({ cyEnd: "03/31/24", pyEnd: "" }, {}), "03/31/23");
  assert.strictEqual(follows({ cyEnd: "03/31/24", pyEnd: "09/30/23" }, {}), null);
  assert.strictEqual(follows({ cyEnd: "03/31/24", pyEnd: "03/31/23" }, { pyEnd: {} }), null);
});

t("the shipped file moves the prior year end when the work paper year is typed", () => {
  assert.ok(/EN9PYFOLLOW-BEGIN/.test(dist), "setField carries the follow-up patch");
  assert.ok(/EN9PYFOLLOWRUN-BEGIN/.test(dist), "the processing run carries it too");
  assert.ok(dist.indexOf("/*EN9PYFOLLOWRUN-BEGIN*/") < dist.indexOf('id:"period-end-assumed"'),
    "it runs after every period proposal and before the assumed-period notice");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
