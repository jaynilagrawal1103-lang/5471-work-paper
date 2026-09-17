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
a(dist.includes('if(!EN9ok&&A[2]!=="/>"&&/<f[ >]/.test(A[2]))return A8=!0,t;') &&
  !dist.includes('!(typeof i=="string"&&i.charAt(0)==="=")&&A[2]!=="/>"'),
  "_J protects existing template formulas (= bypass still removed)");
/* The one allowance: a plain value may replace a shipped formula ONLY in the
   U.S. Shareholders block, whose B7/H7/J7 ship as =B19/=H19/=J19 and must be
   overwritten by Schedule B Part I. It is a fixed cell list in code, not
   anything a document or a user can influence, and a8 still cannot emit <f>,
   so no user string can become a live formula. */
a(/mayReplaceFormula:function\(EN9sh,EN9rf\)\{return EN9sh===Ce\.shareholding&&\(?\/\^\[BFHJP\]/.test(dist),
  "the only formula-replacement allowance is the U.S. Shareholders block");
{
  // the intent: the allowance may name exactly ONE sheet, whatever cell refs
  // it lists inside. Counting sheet references is the honest check.
  const i = dist.indexOf("mayReplaceFormula:function");
  const body = dist.slice(i, dist.indexOf("}", dist.indexOf("return", i)));
  const sheets = [...new Set(body.match(/Ce\.[A-Za-z]+/g) || [])];
  a(sheets.length === 1 && sheets[0] === "Ce.shareholding",
    `that allowance names one sheet only (${sheets.join(", ") || "none"})`);
}
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
// Item F replaced the whole gate: the view no longer bails out, it renders
// from a local store. The null-safety these two pinned still has to hold.
a(dist.includes('EN9tasks=Array.isArray(e.tasks)?e.tasks:[]'),
  "Task view coerces a null task list instead of dereferencing it");
a(dist.includes('tasks:(await EN9taskStore.list())||[]'),
  "refreshTasks coerces a null task list to []");
a(dist.includes('catch{try{sa({tasks:await EN9tasksLoadLocal()})}catch{}}'),
  "and falls back to the local store when the API call throws");
a(dist.includes('(await ss.listWorkpapers())||[]'),
  "hydrateAll tolerates a null workpaper list");
a(dist.includes('createWorkpaper returned no record'),
  "ensureWorkpaper rejects a null create result (no autosave TypeError loop)");
// Item F: one banner became three states, each naming its actual cause.
a(!dist.includes('title:"Task management is currently unavailable'),
  "REGRESSION: the dead-end 'unavailable' banner is gone");
a(dist.includes('Local mode \\u2014 tasks are saved in this browser only'),
  "no-backend copy says where the tasks live and that they still work");
a(dist.includes('Backend configured but not reachable'),
  "an unreachable backend is distinguished from having no backend at all");

// generate-button placement (Overview/Preview/Workspace/Sign-off only)
a(!dist.includes('disabled:t.busy,onClick:()=>void Be.generateWorkpapers()'),
  "Entities-header generate button removed");
a(!dist.includes('children:n.length?"Blocked":"Generate"'),
  "Readiness generate button removed");
a(dist.includes('children:"Open sign-off"'),
  "Readiness links to Sign-off instead");

// re-processing truth: current documents are the single source
a(dist.includes("/*EN9PRUNE-BEGIN*/"),
  "re-process prunes data sourced from removed documents");
a(dist.includes('docKindOverrides:EN9dk,status:"idle"'),
  "removeFile clears per-doc state and resets status");

// manual FX protection
a(dist.includes('r[h]&&r[h].tag==="Manual"'), "auto-fill never overwrites a Manual-tagged rate");

// export completeness
a(dist.includes("aiProfileFields:") && dist.includes("fxSources:") && dist.includes('appVersion:"2.1.0"'),
  "audit export carries AI profile fields, FX sources and the app version");

/* Batch generation: one blocked entity must not hold up the rest of the case.
   The shipped app has done this for months; src refused the whole batch. Both
   trees are pinned here so they cannot drift apart again. */
const src = fs.readFileSync(path.join(__dirname, "..", "src", "prototype", "wp", "store.ts"), "utf8");
a(dist.includes("blocking issues open. Generating the rest.") &&
  src.includes("blocking issues open. Generating the rest."),
  "a partially blocked batch names the skipped entities and generates the rest");
a(dist.includes('We("Generation skipped"') && src.includes('logEvent("Generation skipped"'),
  "each skipped entity is logged by name, not silently dropped");
a(dist.includes("e.length===t.length") && src.includes("blocked.length === targets.length"),
  "generation is refused outright only when NOTHING can be written");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL GENERATION-SAFETY TESTS PASSED");
