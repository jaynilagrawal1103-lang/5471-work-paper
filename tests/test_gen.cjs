/* Generation-safety and deploy-safety guards (P0/P2 audit fixes).
   String-pins the shipped bundle: corruption vectors stay closed,
   the provenance sheet stays wired, the SPA-fallback health check stays strict. */
const fs = require("fs");
const path = require("path");
const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (c, m) => { if (!c) { console.error("FAIL:", m); fails++; } else console.log("ok:", m); };

// corruption vectors
a(!dist.includes('n.charAt(0)==="="?`<c r="${t}"${s}><f>'),
  "a8 no longer turns leading-= strings into live formulas");
a(dist.includes('if(A[2]!=="/>"&&/<f[ >]/.test(A[2]))return A8=!0,t;') &&
  !dist.includes('!(typeof i=="string"&&i.charAt(0)==="=")&&A[2]!=="/>"'),
  "_J always protects existing template formulas (= bypass removed)");
a(dist.includes('Enter a number \\u2014 this exception writes into a numeric schedule cell'),
  "exception edits into schedule cells reject non-numeric text");

// generate guard
a(dist.includes('Object.values(i).filter(EN9v=>EN9v!==""&&EN9v!=null).length'),
  "Os counts only real writes — empty entities cannot generate a mutilated template");

// provenance sheet
a(dist.includes("async function EN9prov("), "provenance-sheet writer present");
a(dist.includes("try{await EN9prov(i,t)}catch{}"), "B8 writes the provenance sheet, failure-safe");
a(dist.includes('name="Provenance"'), "provenance sheet is registered in the workbook");
a(dist.includes("preparer aid"), "the provenance sheet carries the preparer-aid disclaimer");

// deploy safety
a(dist.includes('includes("application/json")') && dist.includes("no backend at this origin"),
  "un() rejects non-JSON responses — an SPA fallback page is not a backend");
a(dist.includes('||!Array.isArray(e.tasks))return'),
  "Task view falls back to local mode instead of dereferencing null tasks");

// manual FX protection
a(dist.includes('r[h]&&r[h].tag==="Manual"'), "auto-fill never overwrites a Manual-tagged rate");

// export completeness
a(dist.includes("aiProfileFields:") && dist.includes("fxSources:") && dist.includes('appVersion:"2.1.0"'),
  "audit export carries AI profile fields, FX sources and the app version");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL GENERATION-SAFETY TESTS PASSED");
