/* Wilbur J Thompson feedback (Boating Made Easy Ltd.), items 5-7.

   5. Basic Information had no box for the Reference ID or the Principal
      Place of Business. Both were read from the prior Form 5471 face
      (items 1b(2) and 1e) and then dropped, because nothing wrote them.
   6. "Entity Name" (B4, the header every sheet title reads) and "Legal Name
      of Entity" (B11) were two boxes for one fact. B4 now follows B11.
   7. Schedule J line 1a is carried from the prior return's line 14, but the
      Provenance sheet never said so — the reviewer could not tell where the
      figure came from. Carried writes that kept a source snapshot are now
      listed with document, page and the row that was read. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");

let pass = 0, fail = 0;
const pending = [];
const t = (name, fn) => {
  const ok = () => { console.log("ok:", name); pass++; }, bad = (e) => { console.log("FAILED:", name, "-", e.message); fail++; };
  try { const r = fn(); if (r && typeof r.then === "function") pending.push(r.then(ok, bad)); else ok(); } catch (e) { bad(e); }
};

const root = path.join(__dirname, "..");
const STORE = SRC.STORE, ENG = SRC.ENG;
const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

const ent = (profile) => ({ ...STORE.makeEntity("Boating Made Easy Ltd.", "Stakeholder"), profile: { ...STORE.makeEntity("x", "y").profile, ...profile } });

t("the profile has a Reference ID box (B5) and a Principal Place of Business box (B29)", () => {
  const f = Object.fromEntries(ENG.PROFILE_FIELDS.map((x) => [x.key, x.cell]));
  assert.strictEqual(f.refId, "B5");
  assert.strictEqual(f.principalPlace, "B29");
  assert.ok(dist.includes('{key:"refId",cell:"B5",label:"Reference ID"}'), "dist field list");
  assert.ok(dist.includes('{key:"principalPlace",cell:"B29",label:"Principal place of business"}'), "dist field list");
});

t("both boxes are labelled and filled in the work paper", () => {
  const w = STORE.buildWrites(ent({ legalName: "Boating Made Easy Ltd.", refId: "BOATING2008", principalPlace: "CAYMAN ISLANDS" }))[ENG.SHEET.basic];
  assert.strictEqual(w.A5, "Reference ID:");
  assert.strictEqual(w.B5, "BOATING2008");
  assert.strictEqual(w.A29, "Principal Place of Business");
  assert.strictEqual(w.B29, "CAYMAN ISLANDS");
  assert.ok(dist.includes('/*EN9BASICBOX*/e.A5="Reference ID:";e.A29="Principal Place of Business";'), "dist writes the labels");
});

t("the labels appear even when nothing was found, so the preparer sees where to type", () => {
  const w = STORE.buildWrites(ent({ legalName: "Boating Made Easy Ltd." }))[ENG.SHEET.basic];
  assert.strictEqual(w.A5, "Reference ID:");
  assert.strictEqual(w.A29, "Principal Place of Business");
  assert.ok(!("B5" in w) && !("B29" in w), "no invented value");
});

t("rows 5 and 29 are empty in the template and nothing references them", async () => {
  // checked against the master template: any formula pointing at these cells
  // would change meaning once they carry text
  const JSZip = require("jszip");
  return JSZip.loadAsync(fs.readFileSync(path.join(root, "assets", "master-template.xlsx"))).then(async (z) => {
    for (const name of Object.keys(z.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
      const x = await z.file(name).async("string");
      assert.ok(!/Basic Information'!\$?[AB]\$?(5|29)\b/.test(x), `${name} references row 5 or 29`);
    }
  });
});

t("Entity Name (B4) follows Legal Name (B11): one box to fill, the header still reads the name", () => {
  const w = STORE.buildWrites(ent({ legalName: "Boating Made Easy Ltd.", entityShort: "Boating Made Easy Ltd." }))[ENG.SHEET.basic];
  assert.strictEqual(w.B4, "=B11");
  assert.strictEqual(w.B11, "Boating Made Easy Ltd.");
  assert.ok(dist.includes('EN9pp.legalName&&(e.B4="=B11")'), "dist writes the same");
  // the shipped writer turns only that one constant into a formula
  assert.ok(dist.includes('/*EN9CELLREF*/if(n==="=B11")return`<c r="${t}"${s}><f>B11</f></c>`;'));
});

t("with no legal name the header keeps its own value", () => {
  const w = STORE.buildWrites(ent({ entityShort: "Boating" }))[ENG.SHEET.basic];
  assert.strictEqual(w.B4, "Boating");
});

t("the Reference ID review note no longer says the template has nowhere to put it", () => {
  assert.ok(!store.includes("the template has no designated cell for it"));
  assert.ok(!dist.includes("the template has no designated cell for it"));
  assert.ok(store.includes("carried to Basic Information B5") && dist.includes("carried to Basic Information B5"));
});

t("carried-forward schedule figures are listed on the Provenance sheet with their source row", () => {
  assert.ok(store.includes('rows.push(["CARRIED FORWARD FROM THE PRIOR-YEAR RETURN"]);'));
  assert.ok(store.includes('(ent.extraWrites || []).filter((w) => w.prov)'));
  assert.ok(dist.includes('/*EN9CFPROV*/try{var EN9cw=(e.extraWrites||[]).filter(function(w){return w&&w.prov});'));
  assert.ok(dist.includes('"CARRIED FORWARD FROM THE PRIOR-YEAR RETURN"'));
  // the opening E&P write is the one that carries a snapshot
  assert.ok(store.includes('sheet: SHEET.schJ, ref: "F15", value: cf.openingEP.value,') && store.includes("prov: { docName: cfSource, page: cf.openingEP.page, rowText: cf.openingEP.rowText },"));
});

(async () => {
  await Promise.all(pending);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
