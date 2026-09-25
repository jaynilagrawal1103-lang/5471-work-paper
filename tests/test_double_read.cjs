/* One figure, read twice off one page.
 *
 * Collaborate and Eight B.V. 2024 is a scanned Dutch annual statement. The
 * catalogue booked "Net turnover 10,400" from page 10; the OCR of that same
 * page also produced the fragment "Gross 10,400", which the model proposed
 * for gross receipts — so Schedule C line 1a carried the amount twice and
 * the work paper overstated turnover by its whole value.
 *
 * Same document, same page, same line, same amount is the same money,
 * whatever caption the reader put on it. What must NOT change: two genuinely
 * different accounts that happen to print an identical figure, and the same
 * figure on a DIFFERENT page, which the existing page-dupe rule already
 * reports on its own terms.
 *
 *   node tests/test_double_read.cjs
 */
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const out = esbuild.buildSync({
  entryPoints: [path.join(root, "src/prototype/wp/store.ts")],
  bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
});
const mod = { exports: {} };
new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
const { figureAlreadyBooked } = mod.exports;

const contrib = (over = {}) => ({
  docId: "d1", docName: "Annual_Statement_2024.pdf", page: 10,
  label: "Net turnover", value: 10400, field: "amount", via: "rule", ...over,
});
const row = (over = {}) => ({ docId: "d1", page: 10, values: [10400], ...over });

t("the model re-reading a booked figure off the same page is caught", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:7": [contrib()] }, "IS:7", row()), 10400);
});

t("a different caption does not make it a different figure", () => {
  const c = { "IS:7": [contrib({ label: "Net turnover" })] };
  assert.strictEqual(figureAlreadyBooked(c, "IS:7", { ...row(), label: "Gross" }), 10400);
});

t("the sign the line books it with does not hide it either", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:8": [contrib({ value: -305.92 })] }, "IS:8",
    { docId: "d1", page: 10, values: [305.92] }), 305.92);
});

t("a different PAGE is left to the existing page-dupe rule", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:7": [contrib({ page: 17 })] }, "IS:7", row()), null);
});

t("a different DOCUMENT is a different figure", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:7": [contrib({ docId: "d2" })] }, "IS:7", row()), null);
});

t("a different LINE is a different figure", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:7": [contrib()] }, "IS:26", row()), null);
});

t("a different amount books normally", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:7": [contrib()] }, "IS:7", { ...row(), values: [12] }), null);
});

t("zero never counts as a match", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:7": [contrib({ value: 0 })] }, "IS:7", { ...row(), values: [0] }), null);
});

t("an empty line books normally", () => {
  assert.strictEqual(figureAlreadyBooked({}, "IS:7", row()), null);
});

t("cents matter: 10,400.01 is not 10,400", () => {
  assert.strictEqual(figureAlreadyBooked({ "IS:7": [contrib()] }, "IS:7", { ...row(), values: [10400.01] }), null);
});

/* Both trees. */
const fs = require("fs");
const DIST = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

t("the shipped bundle carries the guard, wired at both AI call sites", () => {
  assert.ok(DIST.includes("/*EN9DUPFIG-BEGIN*/") && DIST.includes("/*EN9DUPFIG-END*/"), "helper missing");
  assert.ok(DIST.includes("/*EN9DUPFIG1*/"), "not wired into the AI mapping pass");
  assert.ok(DIST.includes("/*EN9DUPFIG2*/"), "not wired into the agent suggestion pass");
});

t("the shipped guard answers the same as the source one", () => {
  const body = /\/\*EN9DUPFIG-BEGIN\*\/[\s\S]*?\/\*EN9DUPFIG-END\*\//.exec(DIST)[0];
  const shipped = new Function(`${body}\nreturn EN9dupFigure;`)();
  for (const [c, target, r] of [
    [{ "IS:7": [contrib()] }, "IS:7", row()],
    [{ "IS:7": [contrib({ page: 17 })] }, "IS:7", row()],
    [{ "IS:7": [contrib({ docId: "d2" })] }, "IS:7", row()],
    [{ "IS:8": [contrib({ value: -305.92 })] }, "IS:8", { docId: "d1", page: 10, values: [305.92] }],
    [{}, "IS:7", row()],
  ]) {
    assert.strictEqual(shipped(c, target, r), figureAlreadyBooked(c, target, r), JSON.stringify(r));
  }
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
