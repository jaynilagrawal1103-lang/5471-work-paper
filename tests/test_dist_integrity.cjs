/* Guards the committed dist/index.html against structural loss: all script/style
   blocks present at plausible sizes, EN9 sentinel pairs balanced. A rebuild from
   the stale src/ (which drops every EN9 fix) turns this suite red. SheetJS is not
   at risk — build.mjs has emitted the vendored copy since 1df6707. */
const fs = require("fs");
const path = require("path");
const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (c, m) => { if (!c) { console.error("FAIL:", m); fails++; } else console.log("ok:", m); };

// the app is delivered as a fixed set of embedded blocks
a(dist.includes('<script id="wp-template"'), "master template block present");
a(/JSZip/.test(dist), "JSZip present");
a(/xlsx\.js \(C\) 2013-present\s+SheetJS/.test(dist) || dist.includes("SheetJS"), "SheetJS present (build.mjs inlines vendor/xlsx.full.min.js)");
a(dist.includes('<style id="en9-theme">') && dist.includes('<style id="en9-css">') && dist.includes('<script id="en9-js">'),
  "EN9 layer blocks injected");
// Measured 2026-09-09: a bare src rebuild is ~2.89MB, ~2.98MB once the EN9 layer
// is injected. The ~0.12MB above that is the dist-only patch weight, so this
// threshold really does catch "someone rebuilt from src".
a(dist.length > 3_000_000, `bundle size plausible (${(dist.length / 1e6).toFixed(2)}MB — a src rebuild + layer is ~2.98MB)`);

// sentinel pairs
for (const s of ["EN9AIMODE", "EN9FX", "EN9GROQ", "EN9POP", "EN9PRUNE", "EN9ROUND", "EN9SANI", "EN9SCHE", "EN9STRUCT", "EN9TASKS", "EN9TIE", "EN9AI-PURE", "EN9AGENT", "EN9AGENTCALL", "EN9AGENTACT", "EN9PERIOD", "EN9STMTPERIOD", "EN9UNDERSTANDCALL", "EN9CASEYEAR", "EN9PRIOREND", "EN9PYFOLLOW", "EN9PYFOLLOWRUN", "EN9POOLSHARE", "EN9POOLSHARED", "EN9ATTSCH", "EN9TAXYEARPAIR", "EN9PANEL", "EN9MONTHALIAS", "EN9SUFFIX", "EN9AGRISK", "EN9CASECTX", "EN9DEEPTOT", "EN9FANNAME", "EN9ZEROSCOPE", "EN9ZEROSCOPE2", "EN9FEEOD", "EN9FEEFN", "EN9RULEMOVED", "EN9RULEMOVE", "EN9RULEMOVE2", "EN9SCHMBLANK", "EN9NEGASSET2", "EN9DOTDOC", "EN9DOTTHOU", "EN9DUPFIG", "EN9ECHOPAGE", "EN9REASKFAN",
  "EN9SHAPE2", "EN9SHAPEFALL", "EN9PASS4", "EN9FEEDLOOSE", "EN9KINDPROMO", "EN9NAMESCOPE",
  "EN9GENERIC", "EN9GENERICNAME", "EN9COMPANYSCOPE", "EN9LOOSE", "EN9HOMELESS",
  "EN9PDFQUEST", "EN9UNCLASSBLOCK", "EN9READDETAIL", "EN9ENTCELL", "EN9READCELL", "EN9AGRISK2",
  "EN9TERMS", "EN9TAXFORM", "EN9TERMSHAPE", "EN9TAXMETA", "EN9GENERICNAME", "EN9BOXED", "EN9TERMWRITE", "EN9DOTTHOU", "EN9NAMEKEY"]) {
  const b = dist.includes(`/*${s}-BEGIN*/`) || dist.includes(`/*${s}-START*/`);
  const e = dist.includes(`/*${s}-END*/`);
  a(b && e, `sentinel pair ${s} balanced`);
}
// the agent is wired, not merely present: the graph, the processing call and
// the action the Settings panel binds to.
for (const [needle, what] of [
  ["EN9buildAgent", "the agent graph"],
  ["await EN9agentRun(", "the agent runs during processing"],
  ["EN9agentSeen", "the AI pass leaves the agent's captions alone"],
  ["EN9setAgent", "the Settings panel can turn the agent off"],
  ["EN9agReconcile", "the agent reads the booked balance sheet back"],
  ["EN9agentUnderstand", "the agent reads the documents before mapping"],
  ["await EN9agentUnderstand(", "the understanding pass is wired into processing"],
  ["EN9agSpotlight", "it picks out what the rules would let past"],
  ["EN9agYearCheck", "every document is placed against the work paper year"],
  ["EN9stmtPeriod(", "a printed period range is read whole, start and end"],
  ["EN9YEARFROMPERIOD", "a document with no year anchor takes its year from its period"],
  ["EN9agentImportant", "and an important row the structure pass dropped reaches Review"],
  ["EN9translateCaptions", "translation runs before mapping, through one translator"],
  ["EN9caseYears(", "one resolver decides the work paper year"],
  ["EN9selectedYear(", "a year the preparer typed outranks the documents"],
  ["EN9YEARSTALE", "changing the year after a run marks the results stale"],
  ["year-changed-reprocess", "and blocks generation until it is re-processed"],
  ["year-columns-unused", "a column outside the pair is named, not dropped quietly"],
  ["statementPeriodEnd:EN9per.end", "the classifier reads the period the statements print"],
  ["period end printed on the statements", "the statements' own period end seeds Basic Information"],
  ["rolled forward one year", "a rolled-forward year end says so in its provenance"],
]) a(dist.includes(needle), `${what} (${needle})`);

// the guard itself must stay in the builder
const build = fs.readFileSync(path.join(__dirname, "..", "scripts", "build.mjs"), "utf8");
a(build.includes("FORCE_REBUILD"), "build.mjs refuses to overwrite a fixed dist without FORCE_REBUILD=1");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL DIST-INTEGRITY TESTS PASSED");
