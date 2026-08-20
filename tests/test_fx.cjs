/* FX chain tests (CHANGE 3): nearest-date OFX lookups, fiscal window computation,
   manual-entry attribution, and source tags. Evals the /*EN9FX-BEGIN*​/ block
   straight out of dist/index.html so it pins the shipped code. */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const m = dist.match(/\/\*EN9FX-BEGIN\*\/([\s\S]*?)\/\*EN9FX-END\*\//);
a(!!m, "EN9FX sentinel block present in dist");
if (!m) { process.exit(1); }

// Oc stub the eval'd block closes over (swappable per test)
var OcCalls = [];
var OcImpl = async () => { throw new Error("Oc not stubbed"); };
async function Oc(url) { OcCalls.push(url); return OcImpl(url); }
void Oc;

eval(m[1]);

const day = (y, mo, d) => Date.UTC(y, mo - 1, d, 12, 0, 0); // midday avoids TZ edges
const pts = (...days) => days.map(([y, mo, d, r]) => ({ t: day(y, mo, d), r }));

(async () => {
  // --- 1. EN9nearestPoint --------------------------------------------------
  const series = pts([2024, 6, 18, 1.51], [2024, 6, 21, 1.52], [2024, 6, 23, 1.53], [2024, 6, 25, 1.54]);
  let n = EN9nearestPoint(series, "2024-06-21");
  a(n && n.rate === 1.52 && n.date === "2024-06-21" && n.diffDays === 0, "nearest: exact hit");
  n = EN9nearestPoint(series, "2024-06-22");
  a(n && n.date === "2024-06-21", "nearest: 1-day tie resolves to the EARLIER date (Jun 21 over Jun 23)");
  n = EN9nearestPoint(series, "2024-06-24");
  a(n && n.date === "2024-06-23", "nearest: tie Jun 23 vs Jun 25 picks earlier Jun 23");
  n = EN9nearestPoint(pts([2024, 6, 25, 1.54]), "2024-06-22");
  a(n && n.date === "2024-06-25" && n.diffDays === 3, "nearest: gap of 3 days accepted");
  a(EN9nearestPoint(pts([2024, 6, 1, 1.5]), "2024-06-22") === null, "nearest: >7 days away refused");
  a(EN9nearestPoint([], "2024-06-22") === null, "nearest: empty series refused");
  a(EN9nearestPoint(series, "junk") === null, "nearest: malformed date refused");

  // --- 2. EN9ofxAllTime + EN9ofxOnDate (cache, errors, no inversion) -------
  OcCalls = [];
  OcImpl = async () => ({ HistoricalPoints: series.map(p => ({ PointInTime: p.t, InterbankRate: p.r })) });
  let r = await EN9ofxOnDate("aud", "2024-06-22");
  a(r.ok && r.value.rate === 1.52, "ofxOnDate: returns the divide rate unchanged (no inversion)");
  a(r.value.asOf === "2024-06-21" && r.value.requested === "2024-06-22", "ofxOnDate: resolved date differs from requested and both are reported");
  await EN9ofxOnDate("AUD", "2024-06-23");
  a(OcCalls.length === 1, "ofxOnDate: second lookup for the same currency hits the session cache (one download)");
  r = await EN9ofxOnDate("AUD", "2023-01-01");
  a(!r.ok && /within 7 days/.test(r.error), "ofxOnDate: date outside the series fails with the 7-day message");
  OcImpl = async () => ({ ErrorCode: 17, Message: "Currency RON not supported" });
  r = await EN9ofxOnDate("RON", "2024-06-22");
  a(!r.ok && /RON not supported/.test(r.error), "ofxOnDate: provider error is passed through");
  let before = OcCalls.length;
  OcImpl = async () => ({ HistoricalPoints: [{ PointInTime: day(2024, 6, 22), InterbankRate: 4.5 }] });
  r = await EN9ofxOnDate("RON", "2024-06-22");
  a(r.ok && r.value.rate === 4.5 && OcCalls.length === before + 1, "ofxOnDate: a failed series is evicted so the next call retries");

  // --- 3. EN9yearBefore / EN9toIso -----------------------------------------
  a(EN9yearBefore("2024-12-31") === "2024-01-01", "yearBefore: calendar year window");
  a(EN9yearBefore("2024-02-29") === "2023-03-01", "yearBefore: Feb-29 clamps without throwing (old code raised RangeError)");
  a(EN9yearBefore("2025-06-30") === "2024-07-01", "yearBefore: fiscal-year window");
  a(EN9yearBefore("garbage") === null, "yearBefore: junk refused");
  a(EN9toIso("06/22/2024") === "2024-06-22", "toIso: M/D/YYYY");
  a(EN9toIso("6-22-24") === "2024-06-22", "toIso: dashed short form");
  a(EN9toIso("22/06/2024") === "2024-06-22", "toIso: day/month swap when first field > 12");
  a(EN9toIso("11/30/2023") === "2023-11-30", "toIso: cross-year dates no longer nulled (old m8 required a matching year)");
  a(EN9toIso("13/13/2024") === null, "toIso: impossible date refused");

  // --- 4. Manual meta, tags, labels ----------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  let meta = EN9fxManualMeta({}, "cyRate", "1.5");
  a(meta.cyRate && meta.cyRate.source === "Manual entry" && meta.cyRate.tag === "Manual" && meta.cyRate.asOf === today,
    "manualMeta: typing a rate stamps Manual entry + today");
  meta = EN9fxManualMeta({ cyRate: { source: "x", asOf: "y" } }, "cyRate", "");
  a(!("cyRate" in meta), "manualMeta: clearing the input deletes the stale meta");
  a(EN9fxTag({ tag: "OFX" }) === "OFX", "fxTag: explicit tag wins");
  a(EN9fxTag({ source: "Built-in IRS yearly average + US Treasury 12/31 tables · IRS yearly average" }) === "IRS",
    "fxTag: legacy IRS prose sniffed");
  a(EN9fxTag({ source: "Built-in tables · Treasury 12/31 spot" }) === "Treasury", "fxTag: legacy Treasury prose sniffed");
  a(EN9fxTag({ source: "frankfurter (live fallback)" }) === "ECB", "fxTag: frankfurter prose sniffed as ECB");
  a(EN9fxTag({ source: "Manual entry" }) === "Manual", "fxTag: manual prose sniffed");
  a(EN9fxTag(undefined) === "", "fxTag: missing meta yields empty (badge hidden)");
  a(EN9asOfLabel("2024-06-21", "2024-06-22") === "2024-06-21 (requested 2024-06-22)", "asOfLabel: substitution surfaced");
  a(EN9asOfLabel("2024-06-21", "2024-06-21") === "2024-06-21", "asOfLabel: exact date stays plain");

  // --- 5. dist wiring smoke -------------------------------------------------
  a(dist.includes('a=i?await EN9ofxOnDate(t,i):await qJ(t)'), "tC routes dated OFX requests to the nearest-date lookup");
  a(dist.includes('EN9fiscal=Wc(i.profile.cyEnd)'), "fiscal guard lifted in autoFillRates");
  a(dist.includes('fxMeta:EN9fxManualMeta(n.fxMeta,i,s)'), "setField writes manual fxMeta");
  a(!dist.includes('u&&!d?["frankfurter"]:te.fxOrder'), "historical spot fallback no longer frankfurter-only");

  if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
  console.log("ALL FX TESTS PASSED");
})().catch(e => { console.error("UNCAUGHT:", e); process.exit(1); });
