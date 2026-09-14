/* OCR before processing — the SOURCE build.
 *
 * OCR used to run after a failed processing pass: the scan reached the reader,
 * the reader threw "no text layer", a watcher noticed, OCR ran, the copy was
 * attached and the entity was processed again. Every figure booked in the
 * first pass was wrong or missing and nothing said so until the second.
 *
 * Now the store exposes what the layer needs to do it the other way round:
 * probe a PDF's pages for a text layer at upload, hold a gate while OCR runs,
 * replace the scan with the searchable copy, and let processEntity wait on
 * that gate. This boots src/prototype/wp/store.ts in jsdom and drives the
 * real actions. The dist counterpart is tests/test_ocr_workflow.cjs.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");
const { JSDOM, VirtualConsole } = require("jsdom");

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, "src/prototype/wp/store.ts")],
  bundle: true, write: false, format: "cjs", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
}).outputFiles[0].text;

const quiet = new VirtualConsole();
const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.invalid/", pretendToBeVisual: true, virtualConsole: quiet });
const { window } = dom;
// jsdom (<=26) implements neither Blob.arrayBuffer() nor Blob.text(); the
// readers need both (PDF and CSV respectively).
if (!window.Blob.prototype.arrayBuffer) {
  window.Blob.prototype.arrayBuffer = function () {
    return new Promise((res, rej) => { const r = new window.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(this); });
  };
}
if (!window.Blob.prototype.text) {
  window.Blob.prototype.text = function () {
    return new Promise((res, rej) => { const r = new window.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(this); });
  };
}
const mod = { exports: {} };
const sandbox = {
  window, document: window.document, navigator: window.navigator,
  CustomEvent: window.CustomEvent, Event: window.Event, Blob: window.Blob, File: window.File,
  fetch: () => Promise.reject(new Error("no network in tests")),
  setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  crypto: window.crypto, indexedDB: undefined, JSZip: undefined,
};
new Function("module", "exports", "require", "globalThis", ...Object.keys(sandbox), `${bundle}\n`)(mod, mod.exports, require, window, ...Object.values(sandbox));
const store = mod.exports;
const settle = (ms = 5) => new Promise((r) => window.setTimeout(r, ms));
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "ocr", name));
const pdfFile = (name) => new window.File([fixture(name)], name, { type: "application/pdf" });

const SIDECAR = (over = {}) => ({
  originalName: "scanned.pdf", originalSha: "abc",
  engine: "paddle", backend: "PP-OCRv5 via ONNX Runtime (bundled weights, offline)", verifyEngine: "tesseract",
  chain: ["paddle", "tesseract"], mode: "auto", source: "service", at: "2026-09-14T12:00:00.000Z",
  verdict: "scanned", ocrPages: [1],
  pages: [{
    page: 1, status: "ocr", engine: "paddle", confMean: 0.97,
    words: [{ text: "Cash", bbox: [72, 90, 100, 101], conf: 0.99, engine: "paddle" },
            { text: "30,257.06", bbox: [480, 90, 540, 101], conf: 0.985, engine: "paddle" },
            { text: "(305.92)", bbox: [488, 200, 540, 211], conf: 0.93, engine: "paddle" }],
    flags: [{ page: 1, kind: "engines-disagree", level: "warn", text: "30,257.06", bbox: [480, 90, 540, 101], conf: 0.985, engine: "paddle",
              message: "paddle read '30,257.06' but tesseract read '30.257.06' at the same position. The paddle reading is kept; confirm against the scan.",
              alt: "30.257.06", alt_engine: "tesseract", alt_conf: 0.9 },
            { page: 1, kind: "low-confidence", level: "info", text: "Cash", bbox: [72, 90, 100, 101], conf: 0.7, engine: "paddle", message: "'Cash' was read at 70% confidence.", alt: null }],
  }],
  stats: { words: 3 },
  ...over,
});

(async () => {
  await settle();
  const A = window.__WPACT;
  const S = () => window.__WPGET();
  const ent = () => S().entities[0];
  // events are prepended (newest first)
  const since = (n) => S().events.slice(0, Math.max(0, S().events.length - n));

  await t("the bridge carries the two OCR actions the layer needs", async () => {
    assert.strictEqual(typeof A.EN9_probePdf, "function", "EN9_probePdf missing");
    assert.strictEqual(typeof A.EN9_replaceFile, "function", "EN9_replaceFile missing");
  });

  await t("EN9_probePdf tells a digital PDF from a scan, page by page, with the app's own reader", async () => {
    const dig = await A.EN9_probePdf(pdfFile("digital.pdf"));
    assert.deepStrictEqual(dig, { pageCount: 2, textPages: [1, 2], scanPages: [] });
    const scan = await A.EN9_probePdf(pdfFile("scanned.pdf"));
    assert.deepStrictEqual(scan, { pageCount: 2, textPages: [], scanPages: [1, 2] });
    const mixed = await A.EN9_probePdf(pdfFile("mixed.pdf"));
    assert.deepStrictEqual(mixed, { pageCount: 3, textPages: [1, 3], scanPages: [2] }, "a mixed PDF must name exactly the pages without text");
  });

  await t("EN9_probePdf answers null, never throws, for something that is not a PDF", async () => {
    const junk = new window.File([new Uint8Array([1, 2, 3, 4])], "notes.pdf", { type: "application/pdf" });
    assert.strictEqual(await A.EN9_probePdf(junk), null);
  });

  await t("EN9_replaceFile swaps the scan for its OCR copy in place, with a new id and the sidecar", async () => {
    await A.addFiles(ent().id, [pdfFile("scanned.pdf"), pdfFile("digital.pdf")]);
    await settle();
    const before = ent();
    assert.strictEqual(before.files.length, 2);
    const scan = before.files[0];
    A.setDocKind(before.id, scan.id, "fs-balance-sheet");
    const storage0 = S().usage.storage;
    const copy = new window.File([fixture("digital.pdf")], "scanned (OCR).pdf", { type: "application/pdf" });
    const newId = await A.EN9_replaceFile(before.id, scan.id, copy, SIDECAR());
    await settle();
    const after = ent();
    assert.ok(newId && newId !== scan.id, "a new id must be issued (persistence keys blobs by id)");
    assert.strictEqual(after.files.length, 2, "one file replaced, not added");
    assert.strictEqual(after.files[0].id, newId, "the copy keeps the scan's position in the list");
    assert.strictEqual(after.files[0].name, "scanned (OCR).pdf");
    assert.strictEqual(after.files[1].name, "digital.pdf", "the other file is untouched");
    assert.ok(after.files[0].ocr, "the sidecar travels with the file");
    assert.strictEqual(after.files[0].ocr.originalName, "scanned.pdf", "the replaced scan's name is recorded");
    assert.strictEqual(after.files[0].ocr.originalSha, scan.sha, "…and its hash, so the figure can be traced to the image");
    assert.ok(after.docKindOverrides[newId] && !after.docKindOverrides[scan.id], "the document-type override follows the file");
    assert.strictEqual(S().usage.storage, storage0 - scan.size + copy.size, "storage accounting follows the swap");
    assert.ok(S().events.some((e) => e.action === "Document replaced by OCR copy"), "the swap is on the audit trail");
  });

  await t("EN9_replaceFile refuses quietly when the file is gone", async () => {
    assert.strictEqual(await A.EN9_replaceFile(ent().id, "no-such-file", pdfFile("digital.pdf"), SIDECAR()), null);
  });

  await t("ocrReviewItems: a notice per document, a warning per disputed reading, nothing applied", async () => {
    const f = { id: "f9", name: "scan (OCR).pdf", ocr: SIDECAR() };
    const items = store.ocrReviewItems(f);
    const notice = items.find((i) => i.id === "ocr-doc-f9");
    assert.ok(notice && notice.level === "info", "the notice is informational");
    assert.match(notice.message, /PP-OCRv5 via ONNX Runtime/);
    assert.match(notice.message, /cross-checked by tesseract/);
    assert.match(notice.message, /page\(s\) 1/);
    assert.match(notice.message, /mean confidence 97%/);
    assert.match(notice.message, /verify each against the original scan \(scanned\.pdf\)/);
    const disputes = items.filter((i) => i.id.startsWith("ocr-flag-"));
    assert.strictEqual(disputes.length, 1, "info-level flags are not review items; warn-level ones are");
    assert.strictEqual(disputes[0].level, "warn");
    assert.strictEqual(disputes[0].category, "source-gap");
    assert.strictEqual(disputes[0].suggestedValue, "30.257.06", "the other engine's reading is offered…");
    assert.strictEqual(disputes[0].sourceLabel, "30,257.06", "…and the kept reading is named — nothing is overwritten");
    assert.ok(!items.some((i) => i.level === "block"), "no page failed, so nothing blocks");
  });

  await t("ocrReviewItems: a page no engine could read blocks generation", async () => {
    const f = { id: "f8", name: "bad (OCR).pdf", ocr: SIDECAR({ pages: [{ page: 1, status: "failed", engine: null, confMean: null, words: [], flags: [] }], ocrPages: [1] }) };
    const items = store.ocrReviewItems(f);
    const block = items.find((i) => i.id === "ocr-failed-f8");
    assert.ok(block && block.level === "block", "an unread page must block — silence would hide a missing statement");
    assert.match(block.message, /page\(s\) 1 could not be read by any OCR engine/);
  });

  await t("ocrProvenance: OCR'd figures cite engine, confidence and position; documents are listed with the scan they replaced", async () => {
    const e = { ...ent(), files: [{ id: "x", name: "scan (OCR).pdf", ocr: SIDECAR() }] };
    const rows = [
      ["FORM 5471 WORK PAPER — PROVENANCE (machine-assisted entries)"],
      ["Kind", "Line / field", "Source caption", "Document", "Page", "Value", "Confidence", "Note"],
      ["Keyword rule", "Sch F · Cash (eoy)", "Cash", "scan (OCR).pdf", 1, 30257.06, "", "matched"],
      ["Keyword rule", "Sch C · Less returns", "Sales returns", "scan (OCR).pdf", 1, 305.92, "", "matched"],
      ["Keyword rule", "Sch C · Gross receipts", "Sales", "scan (OCR).pdf", 1, 999, "", "matched"],
      ["Keyword rule", "Sch C · Other", "Rent", "digital.pdf", 1, 12, "", "matched"],
    ];
    store.ocrProvenance(rows, e);
    assert.deepStrictEqual(rows[1].slice(8), ["OCR engine", "OCR confidence", "OCR position (x0, y0, x1, y1 pt)"]);
    assert.strictEqual(rows[2][8], "paddle · PP-OCRv5 via ONNX Runtime (bundled weights, offline)");
    assert.strictEqual(rows[2][9], "98.5%");
    assert.strictEqual(rows[2][10], "480, 90, 540, 101");
    assert.strictEqual(rows[3][10], "488, 200, 540, 211", "a parenthesised negative matches the booked figure by absolute value");
    assert.match(String(rows[4][9]), /not located/, "a value with no word behind it says so instead of inventing a position");
    assert.strictEqual(rows[5].length, 8, "a digital document's row is untouched");
    const head = rows.findIndex((r) => String(r[0]).startsWith("OCR DOCUMENTS"));
    assert.ok(head > 0, "the OCR documents section is appended");
    const doc = rows[head + 2];
    assert.strictEqual(doc[0], "scan (OCR).pdf");
    assert.strictEqual(doc[1], "scanned.pdf");
    assert.strictEqual(doc[3], "PP-OCRv5 via ONNX Runtime (bundled weights, offline)");
    assert.strictEqual(doc[4], "tesseract");
    assert.strictEqual(doc[7], 1, "one disputed reading counted (info flags excluded)");
  });

  await t("processEntity WAITS on the OCR gate and only then starts — the run reads the OCR'd bytes", async () => {
    // Fresh entity with a document that processes quickly.
    A.addEntity(); await settle();
    const e2 = S().entities[S().entities.length - 1];
    await A.addFiles(e2.id, [new window.File(["Account,Amount\nCash,100\nSales,200\n"], "tb.csv", { type: "text/csv" })]);
    await settle();
    let release;
    const gateP = new Promise((res) => { release = res; });
    let asked = 0;
    window.EN9OCRGATE = { pending: (id) => { asked++; return id === e2.id; }, wait: () => gateP };
    const events0 = S().events.length;
    const run = A.processEntity(e2.id);
    await settle(30);
    const during = S().entities.find((x) => x.id === e2.id);
    assert.strictEqual(during.status, "processing", "the entity shows as busy while OCR runs");
    assert.strictEqual(during.progress, -1, "…but no processing step is active yet");
    assert.ok(!since(events0).some((ev) => ev.action === "Processing started"), "processing must not start before the gate opens");
    // Simulate the layer finishing OCR: swap the file, then open the gate.
    release();
    await run;
    const after = S().entities.find((x) => x.id === e2.id);
    assert.ok(since(events0).some((ev) => ev.action === "Processing started"), "processing started once the gate opened");
    assert.ok(after.status === "ready" || after.status === "error", "the run completed: " + after.status);
    assert.ok(asked >= 1, "the gate was consulted");
    delete window.EN9OCRGATE;
  });

  await t("a failed OCR releases the gate with an error and processing does NOT start", async () => {
    const e2 = S().entities[S().entities.length - 1];
    window.EN9OCRGATE = { pending: (id) => id === e2.id, wait: () => Promise.reject(new Error("OCR of “scan.pdf” failed: too poor")) };
    const events0 = S().events.length;
    await A.processEntity(e2.id);
    const after = S().entities.find((x) => x.id === e2.id);
    assert.strictEqual(after.status, "idle", "the entity is idle again, not stuck busy");
    assert.ok(!since(events0).some((ev) => ev.action === "Processing started"), "no run on un-OCR'd bytes");
    assert.match(S().toast.text, /OCR did not finish/);
    delete window.EN9OCRGATE;
  });

  await t("without a gate (no layer), processEntity behaves exactly as before", async () => {
    const e2 = S().entities[S().entities.length - 1];
    const events0 = S().events.length;
    await A.processEntity(e2.id);
    assert.ok(since(events0).some((ev) => ev.action === "Processing started"));
  });

  await t("processing turns an attached sidecar into review items and keeps the OCR read status", async () => {
    const e2 = S().entities[S().entities.length - 1];
    const csv = new window.File(["Account,Amount\nCash,30257.06\n"], "scan (OCR).csv", { type: "text/csv" });
    await A.addFiles(e2.id, [csv]); await settle();
    const f = S().entities.find((x) => x.id === e2.id).files.find((x) => x.name === "scan (OCR).csv");
    const sc = SIDECAR();
    const nid = await A.EN9_replaceFile(e2.id, f.id, csv, sc);
    await A.processEntity(e2.id);
    const after = S().entities.find((x) => x.id === e2.id);
    const items = after.reviewItems;
    assert.ok(items.some((i) => i.id === "ocr-doc-" + nid), "the OCR notice is a review item after processing");
    assert.ok(items.some((i) => i.id.startsWith("ocr-flag-" + nid) && i.suggestedValue === "30.257.06"), "the disputed reading is a review item with the alternative");
    const file = after.files.find((x) => x.id === nid);
    assert.strictEqual(store.readState(after, file), "text read (OCR)", "the intake table says the text was recognised, not printed");
  });

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
