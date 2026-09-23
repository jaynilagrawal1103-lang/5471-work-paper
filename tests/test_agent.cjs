/* The AI Mapping & Review Agent.
 *
 * Three things are checked:
 *
 *   1. The state-graph runtime -- channel defaults, reducers, conditional
 *      edges, the recursion limit and the refusal to write a channel that was
 *      never declared.
 *   2. The agent itself against a stubbed model: a confident answer becomes a
 *      suggestion the mapping gate may take, a low-confidence answer and a
 *      conflict go to the Exception Centre instead, a caption with no figure
 *      is reported as a gap, and a translated caption gets its English
 *      checked. Every suggestion carries its document, page and figures.
 *   3. That the copy shipping in dist behaves identically to the src port.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const ta = async (name, fn) => { try { await fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const GRAPH = load("src/prototype/wp/agentGraph.ts");
const AGENT = load("src/prototype/wp/agent.ts");

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
function region(startTag, endTag) {
  const b = dist.indexOf(startTag), e = dist.indexOf(endTag);
  assert.ok(b > 0 && e > b, startTag + " present in dist");
  return dist.slice(b + startTag.length, e);
}
const SHIPPED = (() => {
  const sandbox = {};
  new Function("exports",
    region("/*EN9AI-PURE-START*/", "/*EN9AI-PURE-END*/") +
    region("/*EN9GROQ-BEGIN*/", "/*EN9GROQ-END*/") +
    region("/*EN9AGENT-BEGIN*/", "/*EN9AGENT-END*/") +
    ";exports.StateGraph=EN9StateGraph;exports.START=EN9START;exports.END=EN9END;" +
    "exports.append=EN9append;exports.last=EN9last;exports.runAgent=EN9runAgent;" +
    "exports.buildAgent=EN9buildAgent;exports.citeEvidence=EN9citeEvidence;" +
    "exports.AGENT_NAME=EN9AGENT_NAME;exports.AGENT_FRAMEWORK=EN9AGENT_FRAMEWORK;" +
    "exports.AGENT_PROVIDER=EN9AGENT_PROVIDER;exports.AGENT_CAN=EN9AGENT_CAN;" +
    "exports.AGENT_CANNOT=EN9AGENT_CANNOT;exports.AGENT_GRAPH=EN9AGENT_GRAPH;")(sandbox);
  return sandbox;
})();

const TREES = [["src", GRAPH, AGENT], ["dist", SHIPPED, SHIPPED]];

/* ---------------- 1. the runtime ---------------- */

async function runtimeChecks() {
for (const [tree, G] of TREES) {
  await ta(`${tree}: channel defaults fill the state before the first node`, async () => {
    const g = new G.StateGraph({ channels: { seen: G.append(), n: G.last(0) } });
    g.addNode("a", (s) => { assert.deepStrictEqual(s.seen, []); assert.strictEqual(s.n, 0); return { seen: ["a"] }; });
    g.addEdge(G.START, "a");
    g.addEdge("a", G.END);
    return g.compile().invoke({});
  });

  await ta(`${tree}: reducers accumulate, last-write wins for scalars`, async () => {
    const g = new G.StateGraph({ channels: { seen: G.append(), n: G.last(0) } });
    g.addNode("a", () => ({ seen: ["a"], n: 1 }));
    g.addNode("b", () => ({ seen: ["b"], n: 2 }));
    g.addEdge(G.START, "a"); g.addEdge("a", "b"); g.addEdge("b", G.END);
    const out = await g.compile().invoke({});
    assert.deepStrictEqual(out.seen, ["a", "b"]);
    assert.strictEqual(out.n, 2);
  });

  await ta(`${tree}: a conditional edge picks the branch from the state`, async () => {
    const build = (flag) => {
      const g = new G.StateGraph({ channels: { seen: G.append(), flag: G.last(false) } });
      g.addNode("a", () => ({ seen: ["a"] }));
      g.addNode("model", () => ({ seen: ["model"] }));
      g.addNode("offline", () => ({ seen: ["offline"] }));
      g.addEdge(G.START, "a");
      g.addConditionalEdges("a", (s) => (s.flag ? "y" : "n"), { y: "model", n: "offline" });
      g.addEdge("model", G.END); g.addEdge("offline", G.END);
      return g.compile().invoke({ flag });
    };
    return Promise.all([
      build(true).then((o) => assert.deepStrictEqual(o.seen, ["a", "model"])),
      build(false).then((o) => assert.deepStrictEqual(o.seen, ["a", "offline"])),
    ]);
  });
}
}

async function main() {
await runtimeChecks();
await ta("src: a node that writes an undeclared channel is refused", async () => {
  const g = new GRAPH.StateGraph({ channels: { n: GRAPH.last(0) } });
  g.addNode("a", () => ({ nope: 1 }));
  g.addEdge(GRAPH.START, "a"); g.addEdge("a", GRAPH.END);
  await assert.rejects(() => g.compile().invoke({}), /unknown channel "nope"/);
});

await ta("src: a graph that never reaches END stops at the recursion limit", async () => {
  const g = new GRAPH.StateGraph({ channels: { n: GRAPH.last(0) } });
  g.addNode("a", (s) => ({ n: s.n + 1 }));
  g.addEdge(GRAPH.START, "a"); g.addEdge("a", "a");
  await assert.rejects(() => g.compile().invoke({}, { recursionLimit: 5 }), /exceeded 5 steps/);
});

/* ---------------- 2. the agent ---------------- */

const CATALOGUE = "IS:26 = Salaries and wages\nIS:34 = Other deductions\nBS:46 = Accounts payable";
const TARGETS = ["IS:26", "IS:34", "BS:46"];

const ROWS = [
  { key: "personeelskosten", label: "Personeelskosten", english: "Personnel costs", values: [120000], years: [2024], section: "costs", docName: "accounts.pdf", page: 7 },
  { key: "crediteuren", label: "Crediteuren", english: "Creditors", values: [8400], years: [2024], section: "liabilities", docName: "accounts.pdf", page: 5 },
  { key: "overige lasten", label: "Overige lasten", english: "Other charges", values: [900], years: [2024], section: "costs", docName: "accounts.pdf", page: 7 },
  { key: "herwaarderingsreserve", label: "Herwaarderingsreserve", english: "Revaluation reserve", values: [null], years: [2024], docName: "accounts.pdf", page: 5 },
];

/* index -> answer, by the order the node sends them. The stub replies to the
   mapping prompt and the terminology prompt differently, which is how the two
   model-using nodes are told apart. */
function stubModel(script) {
  const calls = [];
  const ask = async (messages) => {
    const user = messages[1].content;
    calls.push(/English used:/.test(user) ? "terminology" : "map");
    const rows = user.split("\n").filter((l) => /^\d+\./.test(l));
    const map = {};
    rows.forEach((line, i) => {
      const caption = /English used:/.test(user)
        ? (/original: ([^|]+)/.exec(line) || [, ""])[1].trim()
        : line.replace(/^\d+\.\s*/, "").split(" | ")[0].split(" [section")[0].trim();
      const answer = script[/English used:/.test(user) ? "term:" + caption : caption];
      if (answer) map[String(i)] = answer;
    });
    return JSON.stringify({ map });
  };
  return { ask, calls, deps: { ask, timeoutMs: 50 } };
}

for (const [tree, , A] of TREES) {
  await ta(`${tree}: a confident answer becomes an accepted suggestion with its evidence`, async () => {
    const stub = stubModel({ Personeelskosten: { t: "IS:26", c: "high", r: "staff cost" } });
    const out = await A.runAgent({ rows: [ROWS[0]], catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: true }, stub.deps);
    assert.strictEqual(out.suggestions.length, 1);
    const s = out.suggestions[0];
    assert.strictEqual(s.target, "IS:26");
    assert.strictEqual(s.status, "accepted");
    assert.strictEqual(s.evidence.doc, "accounts.pdf");
    assert.strictEqual(s.evidence.page, 7);
    assert.match(A.citeEvidence(s.evidence), /accounts\.pdf p\.7/);
    assert.match(A.citeEvidence(s.evidence), /2024: 120000/);
  });

  await ta(`${tree}: a low-confidence answer is never accepted — it becomes an exception`, async () => {
    const stub = stubModel({ "Overige lasten": { t: "IS:34", c: "low", r: "could be anything" } });
    const out = await A.runAgent({ rows: [ROWS[2]], catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: true }, stub.deps);
    assert.strictEqual(out.suggestions[0].status, "exception");
    assert.ok(out.findings.some((f) => f.kind === "ambiguous"));
  });

  await ta(`${tree}: two captions proposed for one line are both held as conflicts`, async () => {
    const stub = stubModel({
      Personeelskosten: { t: "IS:26", c: "high", r: "staff" },
      "Overige lasten": { t: "IS:26", c: "high", r: "staff too" },
    });
    const out = await A.runAgent({ rows: [ROWS[0], ROWS[2]], catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: true }, stub.deps);
    assert.strictEqual(out.suggestions.filter((s) => s.status === "accepted").length, 0);
    assert.strictEqual(out.findings.filter((f) => f.kind === "conflict").length, 2);
  });

  await ta(`${tree}: a line id that does not exist is a conflict, not a mapping`, async () => {
    const stub = stubModel({ Personeelskosten: { t: "IS:99", c: "high", r: "invented" } });
    const out = await A.runAgent({ rows: [ROWS[0]], catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: true }, stub.deps);
    assert.strictEqual(out.suggestions[0].status, "exception");
    assert.match(out.findings.map((f) => f.message).join(" "), /does not exist \(IS:99\)/);
  });

  await ta(`${tree}: a caption with no figure is reported as a gap`, async () => {
    const stub = stubModel({});
    const out = await A.runAgent({ rows: [ROWS[3]], catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: true }, stub.deps);
    const gap = out.findings.find((f) => f.kind === "missing");
    assert.ok(gap, "gap raised");
    assert.match(gap.message, /carries no figure/);
  });

  await ta(`${tree}: the English of a translated caption is checked, and a bad term is queried`, async () => {
    const stub = stubModel({
      Crediteuren: { t: "BS:46", c: "high", r: "payables" },
      "term:Crediteuren": { t: "trade payables", c: "high", r: "creditors is ambiguous in US usage" },
    });
    const out = await A.runAgent({ rows: [ROWS[1]], catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: true }, stub.deps);
    assert.ok(stub.calls.includes("terminology"), "terminology node ran");
    const term = out.findings.find((f) => f.kind === "terminology");
    assert.ok(term, "terminology finding raised");
    assert.match(term.message, /trade payables/);
    // The mapping itself is untouched by a terminology query.
    assert.strictEqual(out.suggestions[0].target, "BS:46");
  });

  await ta(`${tree}: with no key the agent still reports gaps and asks the model nothing`, async () => {
    const stub = stubModel({ Personeelskosten: { t: "IS:26", c: "high", r: "staff" } });
    const out = await A.runAgent({ rows: ROWS, catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: false }, stub.deps);
    assert.strictEqual(stub.calls.length, 0, "no model call");
    assert.strictEqual(out.suggestions.length, 0);
    assert.ok(out.findings.some((f) => f.kind === "missing"));
  });

  await ta(`${tree}: a line the rules already filled is flagged when the agent is unsure`, async () => {
    const stub = stubModel({ "Overige lasten": { t: "IS:34", c: "medium", r: "residual" } });
    const out = await A.runAgent({ rows: [ROWS[2]], catalogue: CATALOGUE, targets: TARGETS, occupied: ["IS:34"], haveModel: true }, stub.deps);
    assert.strictEqual(out.suggestions[0].status, "accepted");
    assert.ok(out.findings.some((f) => f.kind === "ambiguous" && /double-counted/.test(f.message)));
  });

  await ta(`${tree}: the graph runs its nodes in the published order`, async () => {
    const stub = stubModel({ Crediteuren: { t: "BS:46", c: "high", r: "payables" } });
    const seen = [];
    await A.runAgent({ rows: [ROWS[1]], catalogue: CATALOGUE, targets: TARGETS, occupied: [], haveModel: true }, stub.deps, (n) => seen.push(n.node));
    assert.deepStrictEqual(seen, ["gather", "understand", "suggest", "terminology", "critique", "route"]);
  });
}

/* ---------------- 2b. the review phase ---------------- */

const FACTS = {
  cyEnd: "06/30/24", cyEndSource: "accounts.pdf · period end printed on the statements",
  statementPeriodEnd: "06/30/2024", statementDoc: "accounts.pdf",
  assetsEoy: 100000, liabEquityEoy: 100000, equityEoy: 40000,
  filled: ["BS:10", "BS:11", "BS:28", "BS:29", "BS:46", "BS:59", "BS:61"],
};
const CASH_ROW = { key: "cash at bank", label: "Cash at bank", values: [8400], years: [2024], docName: "accounts.pdf", page: 5 };
const FIXED_ROW = { key: "motor vehicles", label: "Motor vehicles at cost", values: [25000], years: [2024], docName: "accounts.pdf", page: 6 };

for (const [tree, , A] of TREES) {
  await ta(`${tree}: a clean balance sheet raises nothing`, async () => {
    const out = await A.runAgent({ phase: "review", rows: [], facts: FACTS }, { ask: async () => "", timeoutMs: 10 });
    assert.deepStrictEqual(out.findings, []);
  });

  await ta(`${tree}: an empty Cash line is reported, naming the caption that was missed`, async () => {
    const facts = { ...FACTS, filled: FACTS.filled.filter((t) => t !== "BS:10") };
    const out = await A.runAgent({ phase: "review", rows: [CASH_ROW], facts }, { ask: async () => "", timeoutMs: 10 });
    const f = out.findings.find((x) => x.kind === "balance" && /Cash/.test(x.message));
    assert.ok(f, "cash gap raised");
    assert.match(f.message, /Cash at bank/);
    assert.strictEqual(f.evidence.page, 5);
  });

  await ta(`${tree}: fixed assets read but never booked are reported`, async () => {
    const facts = { ...FACTS, filled: FACTS.filled.filter((t) => t !== "BS:28" && t !== "BS:29") };
    const out = await A.runAgent({ phase: "review", rows: [FIXED_ROW], facts }, { ask: async () => "", timeoutMs: 10 });
    assert.ok(out.findings.some((x) => /line 9a/.test(x.message) && /Motor vehicles/.test(x.message)), "fixed-asset gap raised");
  });

  await ta(`${tree}: cost without accumulated depreciation is reported`, async () => {
    const facts = { ...FACTS, filled: FACTS.filled.filter((t) => t !== "BS:29") };
    const out = await A.runAgent({ phase: "review", rows: [], facts }, { ask: async () => "", timeoutMs: 10 });
    assert.ok(out.findings.some((x) => /line 9b/.test(x.message)), "9b gap raised");
  });

  await ta(`${tree}: an out-of-balance sheet names the unbooked caption that explains it exactly`, async () => {
    const facts = { ...FACTS, assetsEoy: 108400 };
    const out = await A.runAgent({ phase: "review", rows: [CASH_ROW], facts }, { ask: async () => "", timeoutMs: 10 });
    const f = out.findings.find((x) => /out by/.test(x.message));
    assert.ok(f, "imbalance raised");
    assert.match(f.message, /Cash at bank/);
    assert.match(f.message, /matches the difference exactly/);
  });

  await ta(`${tree}: two captions that together explain the gap are both named`, async () => {
    const facts = { ...FACTS, assetsEoy: 133400 };
    const out = await A.runAgent({ phase: "review", rows: [CASH_ROW, FIXED_ROW], facts }, { ask: async () => "", timeoutMs: 10 });
    const f = out.findings.find((x) => /out by/.test(x.message));
    assert.match(f.message, /Cash at bank/);
    assert.match(f.message, /Motor vehicles at cost/);
  });

  await ta(`${tree}: a whole missing group is named, not just one caption`, async () => {
    // A bank heading with three accounts under it goes missing together; one
    // and two-caption arithmetic cannot explain the hole it leaves.
    const group = [
      { key: "cheque account", label: "Cheque Account", values: [1047.63], years: [2024], docName: "bs.pdf", page: 1 },
      { key: "remote boss lifestyle", label: "Remote Boss Lifestyle", values: [35237.69], years: [2024], docName: "bs.pdf", page: 1 },
      { key: "computer equipment", label: "Computer Equipment", values: [4325.57], years: [2024], docName: "bs.pdf", page: 1 },
      { key: "office equipment", label: "Office Equipment", values: [4049.75], years: [2024], docName: "bs.pdf", page: 1 },
    ];
    const gap = 1047.63 + 35237.69 + 4325.57 + 4049.75;
    const facts = { ...FACTS, assetsEoy: FACTS.assetsEoy - gap };
    const out = await A.runAgent({ phase: "review", rows: group, facts }, { ask: async () => "", timeoutMs: 10 });
    const f = out.findings.find((x) => /out by/.test(x.message));
    assert.ok(f, "imbalance raised");
    for (const g of group) assert.match(f.message, new RegExp(g.label));
  });

  await ta(`${tree}: an assumed period end is reported as an assumption`, async () => {
    const facts = { ...FACTS, cyEndSource: "statement year 2024 — no period end stated, 31 December assumed", cyEnd: "12/31/24", statementPeriodEnd: null };
    const out = await A.runAgent({ phase: "review", rows: [], facts }, { ask: async () => "", timeoutMs: 10 });
    const f = out.findings.find((x) => x.kind === "period");
    assert.ok(f, "period finding raised");
    assert.match(f.message, /was assumed, not read/);
  });

  await ta(`${tree}: a year end rolled forward from last year's return says so`, async () => {
    const facts = { ...FACTS, cyEndSource: "2023 return.pdf · annual accounting period ended 06/30/2023, rolled forward one year", statementPeriodEnd: null };
    const out = await A.runAgent({ phase: "review", rows: [], facts }, { ask: async () => "", timeoutMs: 10 });
    assert.ok(out.findings.some((x) => x.kind === "period" && /rolled forward/.test(x.message)), "roll-forward named");
  });

  await ta(`${tree}: a year end that contradicts the statements is reported`, async () => {
    const facts = { ...FACTS, cyEnd: "12/31/24" };
    const out = await A.runAgent({ phase: "review", rows: [], facts }, { ask: async () => "", timeoutMs: 10 });
    assert.ok(out.findings.some((x) => x.kind === "period" && /not this period/.test(x.message)), "contradiction raised");
  });

  await ta(`${tree}: the review phase never calls the model`, async () => {
    let calls = 0;
    await A.runAgent({ phase: "review", rows: [CASH_ROW], facts: { ...FACTS, assetsEoy: 108400 } }, { ask: async () => { calls++; return ""; }, timeoutMs: 10 });
    assert.strictEqual(calls, 0);
  });
}

/* ---------------- 2c. the understanding phase ---------------- */

const DOCS = [{
  docId: "d1", name: "bs.pdf", kind: "cfc-financial-statements", pages: 1,
  statementYear: 2024, periodEnd: "12/31/2024",
  rowsRead: 4, rowsWithFigures: 4, rowsDropped: 2, sections: ["assets"],
  language: "English", feedsLineItems: true,
}];

for (const [tree, , A] of TREES) {
  await ta(`${tree}: a figure with no rule and no heading is flagged before mapping`, async () => {
    const rows = [
      { key: "remote boss lifestyle", label: "Remote Boss Lifestyle", values: [35237.69], years: [2024], docName: "bs.pdf", page: 1, ruleMatched: false },
      { key: "accounts receivable", label: "Accounts Receivable", values: [5054.6], years: [2024], docName: "bs.pdf", page: 1, ruleMatched: true },
    ];
    const out = await A.runAgent({ phase: "understand", rows, docs: DOCS, haveModel: false }, { ask: async () => "", timeoutMs: 10 });
    assert.strictEqual(out.important.length, 1);
    assert.strictEqual(out.important[0].risk, "no-rule");
    assert.match(out.important[0].figures, /35237.69/);
  });

  await ta(`${tree}: a heading places it, so it is not flagged`, async () => {
    const rows = [{ key: "remote boss lifestyle", label: "Remote Boss Lifestyle", values: [35237.69], years: [2024], docName: "bs.pdf", page: 1, ruleMatched: false, section: "cash" }];
    const out = await A.runAgent({ phase: "understand", rows, docs: DOCS, haveModel: false }, { ask: async () => "", timeoutMs: 10 });
    assert.deepStrictEqual(out.important, []);
  });

  await ta(`${tree}: a row dropped as a subtotal that does not name itself one is flagged`, async () => {
    const rows = [
      { key: "total bank", label: "Total Bank", values: [36285.32], years: [2024], docName: "bs.pdf", page: 1, dropped: "total of the 2 row(s) printed flush above it" },
      { key: "sundry provision", label: "Sundry provision", values: [900], years: [2024], docName: "bs.pdf", page: 1, dropped: "total of the 1 row(s) printed flush above it" },
    ];
    const out = await A.runAgent({ phase: "understand", rows, docs: DOCS, haveModel: false }, { ask: async () => "", timeoutMs: 10 });
    // "Total Bank" says it is a total; the other does not.
    assert.strictEqual(out.important.length, 1);
    assert.strictEqual(out.important[0].label, "Sundry provision");
    assert.strictEqual(out.important[0].risk, "dropped-as-structure");
  });

  await ta(`${tree}: a document that should carry line items and carries none is a named failure`, async () => {
    const docs = [{ ...DOCS[0], rowsRead: 0, rowsWithFigures: 0, rowsDropped: 0 }];
    const out = await A.runAgent({ phase: "understand", rows: [], docs, haveModel: false }, { ask: async () => "", timeoutMs: 10 });
    assert.strictEqual(out.failures.length, 1);
    assert.strictEqual(out.failures[0].stage, "understand");
    assert.ok(out.failures[0].reason && out.failures[0].action, "a failure carries a reason and what to do");
  });

  await ta(`${tree}: a prior-year return with no line items is NOT a failure`, async () => {
    const docs = [{ ...DOCS[0], name: "return.pdf", kind: "prior-year-us-return", rowsRead: 0, rowsWithFigures: 0, feedsLineItems: false }];
    const out = await A.runAgent({ phase: "understand", rows: [], docs, haveModel: false }, { ask: async () => "", timeoutMs: 10 });
    assert.deepStrictEqual(out.failures, []);
  });

  await ta(`${tree}: a low-confidence reading becomes a failure, never a guess`, async () => {
    const rows = [{ key: "xyz account", label: "XYZ account", values: [100], years: [2024], docName: "bs.pdf", page: 1, ruleMatched: false }];
    const ask = async () => JSON.stringify({ map: { 0: { t: "some kind of suspense account", c: "low", r: "the caption says nothing" } } });
    const out = await A.runAgent({ phase: "understand", rows, docs: DOCS, haveModel: true }, { ask, timeoutMs: 10 });
    assert.strictEqual(out.important[0].why.includes("suspense"), false, "an unsure reading is not written into the why");
    assert.ok(out.failures.some((f) => /could not be understood with confidence/.test(f.what)));
  });

  await ta(`${tree}: a confident reading is added to the why`, async () => {
    const rows = [{ key: "remote boss lifestyle", label: "Remote Boss Lifestyle", values: [35237.69], years: [2024], docName: "bs.pdf", page: 1, ruleMatched: false }];
    const ask = async () => JSON.stringify({ map: { 0: { t: "a bank account", c: "high", r: "named after the business, held at a bank" } } });
    const out = await A.runAgent({ phase: "understand", rows, docs: DOCS, haveModel: true }, { ask, timeoutMs: 10 });
    assert.match(out.important[0].why, /a bank account/);
    assert.deepStrictEqual(out.failures, []);
  });

  await ta(`${tree}: the review phase reports an important item nothing accounted for`, async () => {
    const important = [{ key: "remote boss lifestyle", label: "Remote Boss Lifestyle", doc: "bs.pdf", page: 1, figures: "35237.69", why: "no rule claims it", risk: "no-rule" }];
    const facts = { ...FACTS, important, bookedKeys: [], unmatchedKeys: [] };
    const out = await A.runAgent({ phase: "review", rows: [], facts }, { ask: async () => "", timeoutMs: 10 });
    assert.ok(out.findings.some((f) => f.kind === "unused" && /Remote Boss Lifestyle/.test(f.message)));
    assert.strictEqual(out.important[0].outcome, "unused");
  });

  await ta(`${tree}: an item that was booked is not reported`, async () => {
    const important = [{ key: "remote boss lifestyle", label: "Remote Boss Lifestyle", doc: "bs.pdf", page: 1, figures: "35237.69", why: "no rule claims it", risk: "no-rule" }];
    const facts = { ...FACTS, important, bookedKeys: ["remote boss lifestyle"], unmatchedKeys: [] };
    const out = await A.runAgent({ phase: "review", rows: [], facts }, { ask: async () => "", timeoutMs: 10 });
    assert.ok(!out.findings.some((f) => f.kind === "unused"));
    assert.strictEqual(out.important[0].outcome, "booked");
  });

  await ta(`${tree}: every earlier failure is surfaced in the review, with what to do`, async () => {
    const failures = [{ stage: "translate", what: "3 Dutch caption(s) were not translated", reason: "no AI key is configured", action: "Add a Groq key." }];
    const out = await A.runAgent({ phase: "review", rows: [], facts: { ...FACTS, failures } }, { ask: async () => "", timeoutMs: 10 });
    const f = out.findings.find((x) => x.kind === "failure");
    assert.ok(f, "failure surfaced");
    assert.match(f.message, /Agent failed at the translate step/);
    assert.match(f.message, /What to do: Add a Groq key\./);
  });
}

/* ---------------- 2d. the tax-year check ---------------- */

const DOC = (over) => ({
  docId: "d", name: "accounts.pdf", kind: "cfc-financial-statements", pages: 1,
  statementYear: 2024, periodEnd: "12/31/2024", rowsRead: 5, rowsWithFigures: 5,
  rowsDropped: 0, sections: [], language: "English", feedsLineItems: true, ...over,
});

for (const [tree, , A] of TREES) {
  const check = (docs, requiredYear) =>
    A.runAgent({ phase: "understand", rows: [], docs, haveModel: false, requiredYear }, { ask: async () => "", timeoutMs: 10 });

  await ta(`${tree}: this year's accounts are the current year`, async () => {
    const out = await check([DOC({})], 2024);
    assert.strictEqual(out.docs[0].role, "current-year");
    assert.strictEqual(out.docs[0].match, "match");
    // The only failure is the missing prior year, which is true of this pile.
    assert.deepStrictEqual(out.failures.map((f) => f.what), ["no document covers 2023, the year this work paper opens from"]);
  });

  await ta(`${tree}: nothing covering the prior year is named, not assumed away`, async () => {
    const out = await check([DOC({})], 2024);
    const f = out.failures.find((x) => /no document covers 2023/.test(x.what));
    assert.ok(f, "missing prior year raised");
    assert.match(f.action, /2023 Form 5471|2023 statements/);
  });

  await ta(`${tree}: a prior-year document present means no such failure`, async () => {
    const out = await check([DOC({}), DOC({ name: "prior.pdf", statementYear: 2023 })], 2024);
    assert.ok(!out.failures.some((x) => /no document covers/.test(x.what)));
  });

  await ta(`${tree}: last year's accounts are prior-year input, not this year's figures`, async () => {
    const out = await check([DOC({ statementYear: 2023, periodEnd: "12/31/2023" })], 2024);
    assert.strictEqual(out.docs[0].role, "prior-year-input");
    assert.strictEqual(out.docs[0].match, "match");
  });

  await ta(`${tree}: next year's accounts are the comparative source, not a stray`, async () => {
    // A 2025 set of accounts prints the 2024 column beside its own; for a 2024
    // work paper that column is the closing balance sheet.
    const out = await check([DOC({ statementYear: 2025, periodEnd: "12/31/2025" }), DOC({ name: "p.pdf", statementYear: 2023 })], 2024);
    assert.strictEqual(out.docs[0].role, "comparative");
    assert.strictEqual(out.docs[0].match, "match");
    assert.strictEqual(out.docs[0].supportsYear, 2024);
    assert.ok(!out.failures.some((f) => /reports on 2025/.test(f.what)), "not reported as a stray year");
  });

  await ta(`${tree}: a document two years out is a mismatch, with the reason`, async () => {
    const out = await check([DOC({ statementYear: 2021, periodEnd: "12/31/2021" })], 2024);
    assert.strictEqual(out.docs[0].match, "mismatch");
    assert.ok(out.failures.some((f) => /reports on 2021, not 2024/.test(f.what)));
    assert.match(out.failures[0].action, /wrong year/);
  });

  await ta(`${tree}: a document with no year is never used silently`, async () => {
    const out = await check([DOC({ statementYear: null, periodEnd: null })], 2024);
    assert.strictEqual(out.docs[0].match, "unclear");
    assert.strictEqual(out.docs[0].role, "unclear");
    assert.ok(out.failures.some((f) => /could not be read/.test(f.what)));
  });

  await ta(`${tree}: the prior return must be the year the work paper opens from`, async () => {
    const good = await check([DOC({ kind: "prior-year-us-return", statementYear: 2023, feedsLineItems: false })], 2024);
    assert.strictEqual(good.docs[0].match, "match");
    assert.strictEqual(good.docs[0].role, "prior-year-input");
    const bad = await check([DOC({ kind: "prior-year-us-return", name: "2022.pdf", statementYear: 2022, feedsLineItems: false })], 2024);
    assert.strictEqual(bad.docs[0].match, "mismatch");
    assert.ok(bad.failures.some((f) => /opens 2023/.test(f.what)));
  });

  await ta(`${tree}: a questionnaire is reference material, not a year mismatch`, async () => {
    const out = await check([DOC({ kind: "client-questionnaire", statementYear: null, feedsLineItems: false })], 2024);
    assert.strictEqual(out.docs[0].match, "unchecked");
    assert.ok(!out.failures.some((f) => /could not be read|reports on/.test(f.what)), "no year complaint about a questionnaire");
  });

  await ta(`${tree}: every document says which work paper year it supports`, async () => {
    const out = await check([DOC({}), DOC({ name: "prior.pdf", kind: "prior-year-us-return", statementYear: 2023, feedsLineItems: false })], 2024);
    assert.deepStrictEqual(out.docs.map((d) => d.supportsYear), [2024, 2024]);
  });
}

/* ---------------- 3. the two trees agree ---------------- */

t("the agent is named and framed identically in both trees", () => {
  assert.strictEqual(SHIPPED.AGENT_NAME, AGENT.AGENT_NAME);
  assert.strictEqual(SHIPPED.AGENT_FRAMEWORK, AGENT.AGENT_FRAMEWORK);
  assert.strictEqual(SHIPPED.AGENT_PROVIDER, AGENT.AGENT_PROVIDER);
  assert.deepStrictEqual(SHIPPED.AGENT_CAN, AGENT.AGENT_CAN);
  assert.deepStrictEqual(SHIPPED.AGENT_CANNOT, AGENT.AGENT_CANNOT);
});

t("both trees compile the same graph", () => {
  assert.deepStrictEqual(SHIPPED.AGENT_GRAPH, AGENT.AGENT_GRAPH);
  assert.deepStrictEqual(SHIPPED.AGENT_GRAPH.nodes,
    ["gather", "understand", "suggest", "terminology", "critique", "route", "reconcile", "survey", "yearCheck", "spotlight", "interpret", "handoff"]);
});

await ta("both trees route an identical caption set the same way", async () => {
  const script = {
    Personeelskosten: { t: "IS:26", c: "high", r: "staff" },
    Crediteuren: { t: "BS:46", c: "medium", r: "payables" },
    "Overige lasten": { t: "IS:34", c: "low", r: "unsure" },
    "term:Personeelskosten": { t: null, c: "high", r: "" },
    "term:Crediteuren": { t: "trade payables", c: "high", r: "clearer" },
  };
  const strip = (out) => ({
    suggestions: out.suggestions.map((s) => [s.key, s.target, s.confidence, s.status, s.issue || ""]),
    findings: out.findings.map((f) => [f.kind, f.key, f.message]),
  });
  const a = strip(await AGENT.runAgent({ rows: ROWS, catalogue: CATALOGUE, targets: TARGETS, occupied: ["IS:34"], haveModel: true }, stubModel(script).deps));
  const b = strip(await SHIPPED.runAgent({ rows: ROWS, catalogue: CATALOGUE, targets: TARGETS, occupied: ["IS:34"], haveModel: true }, stubModel(script).deps));
  assert.deepStrictEqual(b, a);
});

}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log("harness error:", e && e.stack || e); process.exit(1); });
