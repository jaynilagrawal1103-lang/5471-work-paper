/* OCR before processing — the SHIPPED bundle and its layer.
 *
 * Four things must all be true of dist/index.html, and each has been wrong
 * on its own before: the store patches are present and balanced; the helper
 * functions in dist agree with their source counterparts on the same input;
 * the layer's gate really holds and really releases; and the layer's
 * orchestration prefers the OCR service, falls back to the in-browser engine
 * when the service is silent, and replaces the file through the bridge
 * either way. The source-level counterpart is tests/test_ocr_src.cjs.
 */
require("fake-indexeddb/auto");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM, VirtualConsole } = require("jsdom");

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const root = path.join(__dirname, "..");
const DIST = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", "ocr", name));

const SIDECAR = () => ({
  engine: "paddle", backend: "PP-OCRv5 via ONNX Runtime (bundled weights, offline)", verifyEngine: "tesseract",
  chain: ["paddle", "tesseract"], mode: "auto", source: "service", at: "2026-09-14T12:00:00.000Z", verdict: "scanned", ocrPages: [1],
  pages: [{ page: 1, status: "ocr", engine: "paddle", confMean: 0.97,
    words: [{ text: "Cash", bbox: [72, 90, 100, 101], conf: 0.99, engine: "paddle" }, { text: "30,257.06", bbox: [480, 90, 540, 101], conf: 0.985, engine: "paddle" }],
    flags: [{ page: 1, kind: "engines-disagree", level: "warn", text: "30,257.06", bbox: [480, 90, 540, 101], conf: 0.985, engine: "paddle", message: "paddle read '30,257.06' but tesseract read '30.257.06' at the same position.", alt: "30.257.06", alt_engine: "tesseract", alt_conf: 0.9 },
            { page: 1, kind: "low-confidence", level: "info", text: "Cash", bbox: [72, 90, 100, 101], conf: 0.7, engine: "paddle", message: "'Cash' was read at 70% confidence.", alt: null }] }],
  stats: { words: 2 },
});

(async () => {
  /* ---- 1. the store patches are in dist ---- */
  await t("every OCR patch is present and its sentinels balance", () => {
    for (const s of ["EN9OCRHELPERS", "EN9OCRACT", "EN9OCRGATE", "EN9OCRFLAGS", "EN9OCRPROV"]) {
      assert.ok(DIST.includes(`/*${s}-BEGIN*/`) && DIST.includes(`/*${s}-END*/`), `${s} missing or unbalanced`);
    }
    assert.ok(/async processEntity\(t\)\{\/\*EN9OCRGATE-BEGIN\*\/\{const EN9g=globalThis\.EN9OCRGATE;/.test(DIST), "the gate is the FIRST thing processEntity does");
    assert.ok(DIST.includes("try{await EN9g.wait(t)}catch(EN9e){rt(t,{status:\"idle\"})"), "a failed gate returns the entity to idle");
    assert.ok(DIST.includes("for(const EN9it of EN9ocrReviewItems(y))C(EN9it)"), "sidecar flags become review items in step 1");
    assert.ok(DIST.includes('"OCR engine","OCR confidence","OCR position (x0, y0, x1, y1 pt)"'), "the Provenance header gained the OCR columns");
    assert.ok(DIST.includes("EN9ocrCols([{rule:\"Keyword rule\""), "every contribution row passes through EN9ocrCols");
    assert.ok(DIST.includes('return file.ocr?"text read (OCR)":"text read"'), "the read-status column distinguishes OCR'd text");
  });

  /* ---- 2. the dist helpers agree with src on the same input ---- */
  const helpers = /\/\*EN9OCRHELPERS-BEGIN\*\/([\s\S]*?)\/\*EN9OCRHELPERS-END\*\//.exec(DIST)[1];
  const H = new Function(`${helpers}\nreturn { EN9ocrReviewItems, EN9ocrCols, EN9ocrDocRows, EN9ocrNum };`)();

  await t("EN9ocrReviewItems (dist) matches ocrReviewItems (src): notice + warn per dispute, info flags dropped", () => {
    const items = H.EN9ocrReviewItems({ id: "f9", name: "scan (OCR).pdf", ocr: SIDECAR() });
    const notice = items.find((i) => i.id === "ocr-doc-f9");
    assert.ok(notice && notice.level === "info" && notice.category === "process");
    assert.match(notice.message, /PP-OCRv5 via ONNX Runtime/);
    assert.match(notice.message, /cross-checked by tesseract/);
    assert.match(notice.message, /mean confidence 97%/);
    const flags = items.filter((i) => i.id.startsWith("ocr-flag-"));
    assert.strictEqual(flags.length, 1);
    assert.strictEqual(flags[0].level, "warn");
    assert.strictEqual(flags[0].suggestedValue, "30.257.06");
    assert.strictEqual(flags[0].sourceLabel, "30,257.06");
    const failed = H.EN9ocrReviewItems({ id: "f8", name: "bad.pdf", ocr: { ...SIDECAR(), pages: [{ page: 1, status: "failed", words: [], flags: [] }] } });
    assert.ok(failed.some((i) => i.id === "ocr-failed-f8" && i.level === "block"), "an unread page blocks");
  });

  await t("EN9ocrCols / EN9ocrDocRows (dist) cite engine, confidence and position like ocrProvenance (src)", () => {
    const ent = { files: [{ id: "x", name: "scan (OCR).pdf", ocr: SIDECAR() }] };
    const row = H.EN9ocrCols(["Keyword rule", "Sch F · Cash (eoy)", "Cash", "scan (OCR).pdf", 1, 30257.06, "", "matched"], { docName: "scan (OCR).pdf", page: 1, value: 30257.06 }, ent);
    assert.deepStrictEqual(row.slice(8), ["paddle · PP-OCRv5 via ONNX Runtime (bundled weights, offline)", "98.5%", "480, 90, 540, 101"]);
    const miss = H.EN9ocrCols(["Keyword rule", "x", "Sales", "scan (OCR).pdf", 1, 999, "", ""], { docName: "scan (OCR).pdf", page: 1, value: 999 }, ent);
    assert.match(String(miss[9]), /not located/);
    const plain = H.EN9ocrCols(["Keyword rule", "x", "Rent", "digital.pdf", 1, 12, "", ""], { docName: "digital.pdf", page: 1, value: 12 }, ent);
    assert.strictEqual(plain.length, 8, "a digital document's row is untouched");
    const docs = H.EN9ocrDocRows(ent);
    assert.strictEqual(docs.length, 3);
    assert.match(String(docs[0][0]), /^OCR DOCUMENTS/);
    assert.deepStrictEqual(docs[2].slice(0, 5), ["scan (OCR).pdf", "", "", "PP-OCRv5 via ONNX Runtime (bundled weights, offline)", "tesseract"]);
    assert.strictEqual(docs[2][7], 1);
    assert.strictEqual(H.EN9ocrNum("(523,743.76)"), -523743.76);
    assert.strictEqual(H.EN9ocrNum("1.234.567,89"), 1234567.89);
  });

  /* ---- 3. boot the shipped app and drive the layer ---- */
  const vc = new VirtualConsole();
  /* jsdom has no structuredClone/TextDecoder; without them the bundled pdf.js
     gives up and the probe would report every page as a scan. Browsers have
     both — this is the test DOM catching up, not the app being helped. */
  const dom = new JSDOM(DIST, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc,
    beforeParse(win) {
      if (!win.structuredClone) win.structuredClone = structuredClone;
      if (!win.TextDecoder) win.TextDecoder = TextDecoder;
      if (!win.TextEncoder) win.TextEncoder = TextEncoder;
    },
  });
  const w = dom.window;
  if (!w.Blob.prototype.arrayBuffer) {
    w.Blob.prototype.arrayBuffer = function () { return new Promise((res, rej) => { const r = new w.FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(this); }); };
  }
  let fetchImpl = () => Promise.reject(new Error("offline"));
  w.fetch = (...a) => fetchImpl(...a);
  await new Promise((r) => setTimeout(r, 2500));
  const A = w.__WPACT, S = () => w.__WPGET();
  const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
  const since = (n) => S().events.slice(0, Math.max(0, S().events.length - n));   // newest first
  const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);   // cross-realm arrays
  const pdfFile = (name) => new w.File([fixture(name)], name, { type: "application/pdf" });

  await t("the shipped bundle exposes the probe and replace actions and the gate", () => {
    assert.strictEqual(typeof A.EN9_probePdf, "function");
    assert.strictEqual(typeof A.EN9_replaceFile, "function");
    assert.ok(w.EN9OCRGATE && typeof w.EN9OCRGATE.wait === "function" && typeof w.EN9OCRGATE.pending === "function", "EN9OCRGATE not on the page");
    assert.ok(w.EN9OCR && w.EN9OCR.service && typeof w.EN9OCR.service.health === "function", "the service client is missing");
  });

  /* The bundled pdf.js text layer does not run under jsdom (no font pipeline),
     so the shipped reader's probe is verified in a real browser by
     tests/e2e/ocr_e2e.mjs. Here the probe is checked when it works and
     otherwise stubbed by file name, so the ORCHESTRATION below is still
     exercised against the shipped layer. */
  const probeWorks = !!(await A.EN9_probePdf(pdfFile("digital.pdf")))?.textPages?.length;
  await t("the shipped reader probes a mixed PDF to exactly its scanned pages" + (probeWorks ? "" : " (jsdom: reader cannot see text — covered by the browser e2e)"), async () => {
    if (!probeWorks) return;
    const p = await A.EN9_probePdf(pdfFile("mixed.pdf"));
    same(p, { pageCount: 3, textPages: [1, 3], scanPages: [2] });
  });
  if (!probeWorks) {
    const PROBES = { "digital.pdf": { pageCount: 2, textPages: [1, 2], scanPages: [] }, "scanned.pdf": { pageCount: 2, textPages: [], scanPages: [1, 2] },
                     "mixed.pdf": { pageCount: 3, textPages: [1, 3], scanPages: [2] }, "second scan.pdf": { pageCount: 2, textPages: [], scanPages: [1, 2] } };
    A.EN9_probePdf = async (blob) => PROBES[blob.name] || { pageCount: 1, textPages: [1], scanPages: [] };
  }

  await t("the gate holds while a job is marked and releases (or rejects) when it is done", async () => {
    const G = w.EN9OCRGATE;
    assert.strictEqual(G.pending("E"), false);
    G.mark("E", "f1"); G.mark("E", "f2");
    assert.strictEqual(G.pending("E"), true);
    let opened = false;
    const p = G.wait("E").then(() => { opened = true; });
    G.done("E", "f1"); await settle(5);
    assert.strictEqual(opened, false, "one of two jobs finishing must not open the gate");
    G.done("E", "f2"); await p;
    assert.strictEqual(opened, true);
    assert.strictEqual(G.pending("E"), false);
    G.mark("E", "f3");
    const p2 = G.wait("E");
    G.done("E", "f3", new Error("too poor"));
    await assert.rejects(p2, /too poor/, "a failed job rejects the waiter");
  });

  await t("with the service silent, an upload-time job falls back to the in-browser engine and replaces the file through the bridge", async () => {
    const eid = S().entities[0].id;
    // The in-browser engine, stubbed at the seam the shipped layer reads.
    w.EN9OCR.io = {
      loadEngines: () => Promise.resolve(),
      openPdf: () => Promise.resolve({ numPages: 2 }),
      renderPage: (pdf, n) => Promise.resolve({ png: "data:image/png;base64,AAAA", scale: 2.4, w: 612, h: 792, canvas: {} }),
      makeWorker: (langs) => { w.__langs = langs; return Promise.resolve({ terminate() {} }); },
      // slow enough that Process Entity can be pressed while the job is still running
      recognize: () => new Promise((res) => setTimeout(() => res({ words: [{ text: "Cash", bbox: { x0: 100, y0: 100, x1: 200, y1: 130 }, confidence: 95 }, { text: "1,234", bbox: { x0: 1000, y0: 100, x1: 1100, y1: 130 }, confidence: 60 }] }), 400)),
      buildPdf: (pages) => Promise.resolve(new Uint8Array([37, 80, 68, 70])),
    };
    await A.addFiles(eid, [pdfFile("scanned.pdf")]); await settle(50);
    const f = S().entities[0].files.find((x) => x.name === "scanned.pdf");
    assert.ok(f, "file attached");
    // The intake watcher probes on wp:state; give it a tick, then it starts the job.
    await settle(400);
    assert.ok(w.EN9OCRGATE.pending(eid) || Object.keys(w.EN9OCR.jobs).length, "the upload-time watcher did not start a job");
    // The store's processEntity must now wait on the gate rather than read the scan.
    const events0 = S().events.length;
    const run = A.processEntity(eid);
    await settle(50);
    assert.ok(!since(events0).some((e) => e.action === "Processing started"), "processing started before OCR finished");
    await w.EN9OCRGATE.wait(eid).catch(() => {});
    await run; await settle(100);
    const ent = S().entities[0];
    const copy = ent.files.find((x) => /\(OCR\)\.pdf$/.test(x.name));
    assert.ok(copy, "the scan was replaced by an (OCR).pdf copy");
    assert.ok(!ent.files.some((x) => x.name === "scanned.pdf"), "the original scan is no longer in intake (no double booking)");
    assert.strictEqual(copy.ocr.engine, "tesseract.js", "the fallback engine is named honestly");
    assert.strictEqual(copy.ocr.source, "browser");
    same(copy.ocr.ocrPages, [1, 2]);
    assert.ok(copy.ocr.pages[0].flags.some((fl) => fl.kind === "low-confidence" && fl.text === "1,234"), "a low-confidence figure is flagged even by the fallback");
    assert.ok(since(events0).some((e) => e.action === "Processing started"), "processing ran after the gate opened");
    assert.ok(S().events.some((e) => e.action === "Document replaced by OCR copy"));
    assert.ok(ent.reviewItems.some((i) => i.id === "ocr-doc-" + copy.id), "the OCR notice is a review item");
  });

  await t("with the service online, the job uses it: the searchable PDF and sidecar come from the response, and Tesseract.js is never touched", async () => {
    const eid = S().entities[0].id;
    let posted = null;
    const resp = { doc: { name: "mixed.pdf", verdict: "mixed", page_count: 3, ocr_pages: [2], engines_used: ["paddle"], engine_chain: ["paddle", "tesseract"], primary: "paddle", backends: { paddle: "PaddleOCR 3.7.0 native PP-OCRv6 (en) + PP-StructureV3", tesseract: "Tesseract 5.3.4 (eng)" } },
      pages: [{ page: 1, status: "digital", words: [], flags: [] }, { page: 2, status: "ocr", engine: "paddle", verify_engine: "tesseract", conf_mean: 0.98, words: [{ text: "Sales", bbox: [72, 100, 110, 111], conf: 0.99, engine: "paddle" }], flags: [] }, { page: 3, status: "digital", words: [], flags: [] }],
      flags: [], stats: { words: 1, failed_pages: [] }, pdf_b64: Buffer.from(fixture("digital.pdf")).toString("base64") };
    fetchImpl = (url, init) => {
      if (/\/health$/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, primary: "paddle", chain: ["paddle", "tesseract"], engines: { paddle: { available: true, backend: "PaddleOCR 3.7.0 native PP-OCRv6 (en) + PP-StructureV3" }, tesseract: { available: true, backend: "Tesseract 5.3.4 (eng)" } } }) });
      if (/\/ocr\?/.test(url)) { posted = { url, type: init.headers["content-type"], size: init.body.size }; return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(resp)) }); }
      return Promise.reject(new Error("unexpected " + url));
    };
    w.EN9OCR.service._health = null;               // drop the cached "offline" answer
    w.EN9OCR.io = { loadEngines: () => Promise.reject(new Error("Tesseract.js must not be used when the service is up")) };
    await A.addFiles(eid, [pdfFile("mixed.pdf")]); await settle(600);
    await w.EN9OCRGATE.wait(eid); await settle(100);
    assert.ok(posted, "the document was posted to the service");
    assert.match(posted.url, /\/api\/ocr\/ocr\?/);
    assert.match(posted.url, /pages=2(&|$)/, "only the scanned page of the mixed PDF is requested");
    assert.match(posted.url, /langs=eng/);
    assert.strictEqual(posted.type, "application/pdf");
    assert.strictEqual(posted.size, fixture("mixed.pdf").length, "the raw PDF bytes go in the body");
    const ent = S().entities[0];
    const copy = ent.files.find((x) => x.name === "mixed (OCR).pdf");
    assert.ok(copy, "the mixed PDF was replaced by its OCR copy");
    assert.strictEqual(copy.ocr.engine, "paddle");
    assert.strictEqual(copy.ocr.backend, "PaddleOCR 3.7.0 native PP-OCRv6 (en) + PP-StructureV3");
    assert.strictEqual(copy.ocr.verifyEngine, "tesseract");
    same(copy.ocr.ocrPages, [2]);
    assert.strictEqual(copy.ocr.source, "service");
    assert.strictEqual(copy.size, fixture("digital.pdf").length, "the file bytes are the service's searchable PDF");
    const job = Object.values(w.EN9OCR.jobs).find((j) => j.name === "mixed.pdf");
    assert.ok(job && job.status === "done", "the mixed.pdf job finished: " + JSON.stringify(job && [job.name, job.status, job.error]));
  });

  await t("a document already OCR'd is never queued again (no loop on its own output)", async () => {
    const before = Object.keys(w.EN9OCR.jobs).length;
    w.dispatchEvent(new w.CustomEvent("wp:state")); await settle(400);
    assert.strictEqual(Object.keys(w.EN9OCR.jobs).length, before, "a second job appeared for an (OCR).pdf");
  });

  await t("a service failure while Process Entity is waiting: the gate rejects, the scan stays attached unread, processing does not start", async () => {
    const eid = S().entities[0].id;
    let failOcr;
    const failing = new Promise((res) => { failOcr = res; });
    fetchImpl = (url) => {
      if (/\/health$/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, primary: "paddle", chain: ["paddle"], engines: { paddle: { available: true, backend: "x" } } }) });
      return failing.then(() => ({ ok: false, status: 500, text: () => Promise.resolve(JSON.stringify({ error: "OCR failed: engine crashed" })) }));
    };
    w.EN9OCR.service._health = null;
    const scan2 = new w.File([fixture("scanned.pdf")], "second scan.pdf", { type: "application/pdf" });
    await A.addFiles(eid, [scan2]);
    for (let i = 0; i < 40 && !w.EN9OCRGATE.pending(eid); i++) await settle(50);
    assert.ok(w.EN9OCRGATE.pending(eid), "the job did not start");
    const events0 = S().events.length;
    const run = A.processEntity(eid);                     // pressed while OCR is still running
    await settle(50);
    assert.strictEqual(S().entities[0].status, "processing", "the button shows busy while waiting on OCR");
    failOcr(); await run; await settle(50);
    const ent = S().entities[0];
    assert.ok(ent.files.some((x) => x.name === "second scan.pdf"), "the original stays attached");
    assert.ok(!ent.files.some((x) => x.name === "second scan (OCR).pdf"), "no copy was attached");
    assert.ok(!since(events0).some((e) => e.action === "Processing started"), "processing did not run on the unread scan");
    assert.strictEqual(ent.status, "idle", "the entity is idle again, not stuck busy");
    assert.ok(Object.values(w.EN9OCR.jobs).some((j) => j.name === "second scan.pdf" && j.status === "failed" && /engine crashed/.test(j.error)), "the failure is recorded with its reason");
    assert.match(S().toast.text, /OCR did not finish/);
  });

  await t("after a failed OCR the gate is clear: a later Process Entity runs and reports the scan as unread, honestly", async () => {
    const eid = S().entities[0].id;
    const events0 = S().events.length;
    await A.processEntity(eid); await settle(50);
    assert.ok(since(events0).some((e) => e.action === "Processing started"), "processing must not be stranded after a failed OCR");
    const ent = S().entities[0];
    assert.ok(ent.reviewItems.some((i) => i.source === "second scan.pdf" && /could not be read/.test(i.message)), "the unread scan is reported, not silently skipped");
  });

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
