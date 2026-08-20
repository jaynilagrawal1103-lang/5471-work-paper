/* Always-on AI mapping tests (CHANGE 1).
   Pins the pure helpers (chunking, response parsing, confidence gate) and the
   detectProfile candidate capture — all evaluated straight out of dist/index.html. */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- pure helpers ----------------------------------------------------------
const pm = dist.match(/\/\*EN9AI-PURE-START\*\/([\s\S]*?)\/\*EN9AI-PURE-END\*\//);
a(!!pm, "EN9AI pure-helper block present in dist");
eval(pm[1]);

a(JSON.stringify(EN9chunk([1, 2, 3, 4, 5], 2)) === "[[1,2],[3,4],[5]]", "EN9chunk slices with a remainder");
a(EN9chunk(Array.from({ length: 100 }), 40).map(c => c.length).join(",") === "40,40,20", "EN9chunk 100 -> 40/40/20");
a(EN9chunk([], 40).length === 0, "EN9chunk empty input");

let map = EN9parseMap('{"map":{"0":{"t":"IS:26","c":"high","r":"depreciation"},"1":{"t":null,"c":"low","r":""}}}');
a(map["0"] && map["0"].t === "IS:26" && map["1"] && map["1"].t === null, "parseMap: valid object form");
map = EN9parseMap('```json\n{"map":{"0":"IS:26"}}\n```');
a(map["0"] === "IS:26", "parseMap: legacy string form with code fences");
map = EN9parseMap('{"map":{"0":{"t":"IS:7","c":"high","r":"sales"},"1":{"t":"IS:2');
a(map["0"] && map["0"].t === "IS:7" && map["1"] === undefined, "parseMap: truncated JSON salvages the complete entries");
a(JSON.stringify(EN9parseMap("total garbage")) === "{}", "parseMap: garbage yields empty map");

a(EN9norm1({ k: "formed", c: "HIGH", r: "x" }).t === "formed", "norm1: profile k alias + case-folded confidence");
a(EN9norm1({ t: "IS:7", c: "certain", r: "" }).c === "low", "norm1: unknown confidence downgraded to low");
a(EN9norm1("IS:26").c === "medium", "norm1: bare string normalizes to medium");
a(EN9norm1({ t: 42 }).t === null, "norm1: non-string target nulled");
a(EN9norm1(null) === null, "norm1: null passthrough");
a(EN9ok({ t: "IS:7", c: "high" }) && EN9ok({ t: "IS:7", c: "medium" }), "EN9ok: high and medium pass");
a(!EN9ok({ t: "IS:7", c: "low" }) && !EN9ok({ t: null, c: "high" }), "EN9ok: low or null target refused");

// --- live QF: profile candidate capture ------------------------------------
const qi = dist.indexOf("function QF(t){");
const qj = dist.indexOf("var t_=[[", qi);
a(qi > 0 && qj > qi, "QF extraction boundaries found");
const XJ = v => String(v).toLowerCase().replace(/[\s ]+/g, " ").replace(/[:\-–—*]+$/, "").trim();
const EF = (row, idx) => { for (let k = idx + 1; k < row.length; k++) { const v = row[k]; if (v !== undefined && String(v).trim() !== "") return { value: String(v).trim() }; } return null; };
const zh = v => /^(y|yes|true|x|✓)$/i.test(String(v).trim()) ? "Yes" : "No";
const $J = [{ key: "formed", labels: ["date of formation", "date of incorporation"], clean: v => v }];
const e_ = [];
const QF = new Function("$J", "e_", "XJ", "EF", "zh", dist.slice(qi, qj) + ";return QF;")($J, e_, XJ, EF, zh);

let res = QF([["Date of formation", "12/05/2014"], ["Company formation date", "12/05/2014"], ["Cash", "9,703"]]);
a(res.profile.length === 1 && res.profile[0].key === "formed", "QF: matched caption still lands in profile (regression)");
a(!res.EN9unmatched.some(u => u.norm === "date of formation"), "QF: matched caption NOT double-reported to AI");
const cand = res.EN9unmatched.find(u => u.norm === "company formation date");
a(cand && cand.value === "12/05/2014" && cand.caption === "Company formation date",
  "QF: unmatched fuzzy caption captured with caption/norm/value");
res = QF([["Company formation date", ""]]);
a(res.EN9unmatched.length === 0, "QF: caption with empty value cell excluded");
res = QF([["1234567", "12/05/2014", "x"]]);
a(res.EN9unmatched.length === 0, "QF: all-digit caption excluded");
res = QF(Array.from({ length: 45 }, (_, i) => [`unknown caption number ${i}`, "value " + i]));
a(res.EN9unmatched.length === 40, "QF: candidate cap at 40 per grid");
a(JSON.stringify(QF(null).EN9unmatched) === "[]", "QF: null-grid early return carries EN9unmatched:[]");

// --- dist wiring smoke -----------------------------------------------------
a(dist.includes('"AI mapping of leftover captions"]'), "6th processing step present");
a(dist.includes("try{await EN9aiRun(t,s,!1)}catch"), "processEntity awaits the AI pass inside its own try/catch");
a(dist.includes("te.groq.EN9auto===!1"), "auto toggle read (default ON when undefined)");
a(dist.includes("EN9unmatchedProfile:e.EN9unmatchedProfile||[]"), "processEntity snapshot keeps profile candidates");
a(dist.includes('await EN9aiRun(t,null,!0)'), "manual Resolve-with-Groq delegates to the shared pass");
a(dist.includes('Be.setGroq({EN9auto:n.target.checked})'), "Settings toggle wired");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL AI-MAPPING TESTS PASSED");
