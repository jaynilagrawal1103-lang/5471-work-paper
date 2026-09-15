/* The in-browser PaddleOCR engine, without a browser: the geometry that
   replaces OpenCV in the DB post-processing, the grammar flags the local
   engines apply, the sidecar naming, and the "off" switch of the service
   client — all read from the SHIPPED dist/index.html booted under jsdom.
   The models themselves run only in Chromium: tests/e2e/ocr_browser_e2e.mjs. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert");
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.join(__dirname, "..");
const DIST = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
let pass = 0, fail = 0;
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);   // cross-realm arrays
const t = async (name, fn) => { try { await fn(); pass++; console.log("ok:", name); } catch (e) { fail++; console.log("FAILED:", name, "\n   ", e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n    ") : e); } };

(async () => {
  await t("the shipped page pins the runtime version, the model commit and the model hashes", () => {
    assert.match(DIST, /ORT_VERSION:"\d+\.\d+\.\d+"/);
    assert.match(DIST, /MODEL_COMMIT:"[0-9a-f]{40}"/);
    assert.ok(DIST.includes('det:"4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae"'), "det.onnx sha256 (the onnxocr 3.1.0 wheel's file)");
    assert.ok(DIST.includes('rec:"5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5"'), "rec.onnx sha256");
    assert.ok(DIST.includes("media.githubusercontent.com/media/jingsongliujing/OnnxOCR/"), "models come from the project's LFS store at the pinned commit");
  });

  const vc = new VirtualConsole();
  const dom = new JSDOM(DIST, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc,
    beforeParse(win) { if (!win.structuredClone) win.structuredClone = structuredClone; if (!win.TextDecoder) win.TextDecoder = TextDecoder; if (!win.TextEncoder) win.TextEncoder = TextEncoder; } });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error("offline"));
  await new Promise((r) => setTimeout(r, 2500));
  const E = w.EN9PPOCR;

  await t("the engine object is on the page with its parameters", () => {
    assert.ok(E && typeof E.page === "function" && typeof E.load === "function");
    same([E.params.detSide, E.params.detThresh, E.params.boxThresh, E.params.unclip, E.params.recH, E.params.recW, E.params.dropScore], [960, 0.3, 0.6, 1.5, 48, 320, 0.5], "the reference PP-OCR parameters");
    assert.strictEqual(E.dict, null, "nothing is loaded until a scan needs it");
  });

  await t("convex hull and minimum-area rectangle of a tilted rectangle of points", () => {
    // a 200×20 rectangle turned by 10°, sampled on a grid
    const ang = (10 * Math.PI) / 180, c = Math.cos(ang), s = Math.sin(ang), pts = [];
    for (let x = 0; x <= 200; x += 2) for (let y = 0; y <= 20; y += 2) pts.push([300 + x * c - y * s, 300 + x * s + y * c]);
    const h = E.hull(pts);
    // grid points along a turned edge are not exactly collinear, so a few
    // survive on the hull; what matters is that the interior is gone
    assert.ok(h.length >= 4 && h.length < pts.length / 20, `hull keeps only the boundary (got ${h.length} of ${pts.length} points)`);
    const r = E.minAreaRect(pts);
    assert.ok(Math.abs(Math.max(r.w, r.h) - 200) < 1.5 && Math.abs(Math.min(r.w, r.h) - 20) < 1.5, `sides 200×20 (got ${r.w.toFixed(1)}×${r.h.toFixed(1)})`);
    const deg = ((r.angle * 180) / Math.PI + 180) % 180;
    assert.ok(Math.abs(deg - 10) < 0.6 || Math.abs(deg - 100) < 0.6, `angle 10° (got ${deg.toFixed(2)})`);
    const q = E.rectPoints(r, 0);
    assert.strictEqual(q.length, 4);
    assert.ok(q[0][0] < q[1][0] && q[3][0] < q[2][0], "left corners before right corners");
    assert.ok(q[0][1] < q[3][1] && q[1][1] < q[2][1], "top corners above bottom corners");
    const grown = E.rectPoints(r, 5);
    assert.ok(Math.hypot(grown[0][0] - grown[1][0], grown[0][1] - grown[1][1]) > 209, "unclip grows the box on every side");
  });

  await t("boxes from a probability map: two text-like blobs become two scored, unclipped boxes; noise is dropped", () => {
    const W = 160, H = 64, prob = new Float32Array(W * H);
    const blob = (x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) prob[y * W + x] = v; };
    blob(10, 10, 70, 22, 0.95);          // a strong line
    blob(90, 30, 150, 44, 0.9);          // another
    blob(20, 50, 24, 52, 0.4);           // a 4×2 speck: above the threshold but below min size
    blob(100, 52, 140, 60, 0.35);        // a faint smear: found, but scores under the box threshold
    const boxes = E.boxesFromMap(prob, W, H);
    assert.strictEqual(boxes.length, 2, `two boxes (got ${boxes.length})`);
    for (const b of boxes) {
      assert.ok(b.score >= 0.6, "box score is the mean probability inside");
      const xs = b.quad.map((p) => p[0]), ys = b.quad.map((p) => p[1]);
      assert.ok(Math.max(...xs) - Math.min(...xs) > 60 && Math.max(...ys) - Math.min(...ys) > 12, "unclipped beyond the blob");
    }
    const tidy = E.tidyBoxes(boxes.map((b) => ({ quad: b.quad.map((p) => [p[0] * 4, p[1] * 4]), score: b.score })), W * 4, H * 4);
    assert.strictEqual(tidy.length, 2);
    assert.ok(tidy[0].quad[0][1] < tidy[1].quad[0][1], "sorted top to bottom");
    for (const b of tidy) for (const p of b.quad) assert.ok(p[0] >= 0 && p[0] <= W * 4 - 1 && p[1] >= 0 && p[1] <= H * 4 - 1, "clipped to the image");
    // reading order on one line: left before right even when the left box starts a few pixels lower
    const line = E.tidyBoxes([{ quad: [[300, 102], [400, 102], [400, 130], [300, 130]], score: 1 }, { quad: [[10, 108], [100, 108], [100, 136], [10, 136]], score: 1 }], 640, 256);
    assert.ok(line[0].quad[0][0] === 10, "same line: the left box comes first");
  });

  await t("grammar flags: glyph swaps, malformed separators, low confidence, and nothing for dates or captions", () => {
    const F = w.EN9OCR.localFlags;
    const kinds = (text, conf) => F(1, text, [0, 0, 1, 1], conf, "paddle").map((f) => f.kind + (f.alt ? "→" + f.alt : ""));
    same(kinds("1,OOO.5O", 0.99), ["suspicious-glyph→1,000.50"]);
    same(kinds("$72.882.56", 0.99), ["numeric-grammar"]);
    same(kinds("30,257.06", 0.85), ["low-confidence"]);
    same(kinds("(61,139.37)", 0.99), []);
    same(kinds("1.234.567,89", 0.99), []);
    same(kinds("12/31/2024", 0.99), []);
    same(kinds("Note 3", 0.5), [], "a caption with a digit is not a figure");
    same(kinds("11,", 0.5), [], "a day-of-month is a date part");
    const f = F(2, "..6,074.99", [1, 2, 3, 4], 0.94, "paddle")[0];
    assert.strictEqual(f.kind, "numeric-grammar"); assert.strictEqual(f.page, 2); assert.strictEqual(f.engine, "paddle"); assert.match(f.message, /verify against the scan/);
  });

  await t("the sidecar names the engine that read: PaddleOCR in the browser, else Tesseract.js with the reason", () => {
    const S = w.EN9OCR.sidecarFromLocal;
    const pages = [{ n: 1, copy: true }, { n: 2, scale: 2, w: 612, h: 792, words: [{ text: "Cash", bbox: { x0: 100, y0: 100, x1: 200, y1: 130 }, confidence: 99 }, { text: "1,234", bbox: { x0: 1000, y0: 100, x1: 1100, y1: 130 }, confidence: 60 }] }];
    w.EN9OCR.browserEngine = "ppocr";
    let sc = S(pages, [2], "auto", "eng");
    assert.strictEqual(sc.engine, "paddle"); assert.match(sc.backend, /PP-OCRv5 via ONNX Runtime Web/); assert.strictEqual(sc.source, "browser"); assert.strictEqual(sc.verdict, "mixed");
    same(sc.pages.map((p) => p.status), ["digital", "ocr"]);
    same(sc.pages[1].words[0].bbox, [50, 50, 100, 65], "boxes back to page points");
    assert.strictEqual(sc.pages[1].words[1].engine, "paddle");
    assert.ok(sc.pages[1].flags.some((f) => f.kind === "low-confidence" && f.text === "1,234"));
    w.EN9OCR.browserEngine = "tesseract.js"; w.EN9OCR.browserReason = "Could not download ort.wasm.min.js";
    sc = S(pages, [1, 2], "manual", "eng");
    assert.strictEqual(sc.engine, "tesseract.js"); assert.match(sc.backend, /PaddleOCR could not load: Could not download/); assert.strictEqual(sc.verdict, "scanned");
    w.EN9OCR.browserEngine = null; w.EN9OCR.browserReason = null;
  });

  await t("the service client's off switch: no address is tried, the card explains, clearing it restores discovery", async () => {
    const svc = w.EN9OCR.service;
    svc.setUserUrl("off");
    assert.strictEqual(svc.userUrl(), "off"); same(svc.candidates(), []); assert.strictEqual(svc.base(), "/api/ocr");
    const h = await svc.health(true);
    assert.strictEqual(h.available, false);
    assert.match(svc.statusText(), /turned off/); assert.match(svc.statusText(), /PaddleOCR \(PP-OCRv5\) runs in this browser/);
    svc.setUserUrl("browser"); assert.strictEqual(svc.userUrl(), "off", "'browser' and 'none' mean the same");
    svc.setUserUrl("");
    assert.ok(svc.candidates().length >= 3 && svc.candidates()[0] === "/api/ocr", "automatic again: this server first, then the local ports");
    svc.setUserUrl("127.0.0.1:9000"); assert.strictEqual(svc.candidates()[0], "http://127.0.0.1:9000", "a bare host:port gets its scheme");
    svc.setUserUrl("");
  });

  await t("without a packed engine every asset accessor says 'not here', so the page downloads as before", async () => {
    const A = w.EN9OCRASSET;
    assert.ok(A && typeof A.has === "function" && typeof A.bytes === "function" && typeof A.dataUrl === "function");
    for (const n of ["ort.js", "ort.wasm", "ort.mjs", "pdflib.js", "det.onnx", "rec.onnx", "cls.onnx", "dict.txt"]) assert.strictEqual(A.has(n), false, n);
    await w.EN9OCR.service.health(true);
    assert.match(w.EN9OCR.service.statusText(), /download once from cdn\.jsdelivr\.net/, "the card promises the download when nothing is packed");
  });

  await t("a packed asset is unzipped and handed over as bytes, text and a data: URL", async () => {
    const { gzipSync } = require("node:zlib");
    const body = "PP-OCRv5 dictionary line\n€ ± ¥\n";
    const bytes = Buffer.from(body, "utf8");
    const A = w.EN9OCRASSET;

    // stored raw
    w.EN9OCRASSETS = { v: 1, gz: 0, files: { "dict.txt": bytes.toString("base64") } };
    assert.strictEqual(A.has("dict.txt"), true);
    assert.strictEqual(A.has("rec.onnx"), false, "only what is packed counts as packed");
    assert.strictEqual(await A.text("dict.txt"), body);
    const url = await A.dataUrl("dict.txt", "text/javascript");
    assert.ok(url.startsWith("data:text/javascript;base64,"), "a data: URL, which a file:// page may import (a blob: URL it may not)");
    assert.strictEqual(Buffer.from(url.split(",")[1], "base64").toString("utf8"), body);

    // stored gzipped, as the offline build does. jsdom has no
    // DecompressionStream/streaming Blob; the browser does, so lend it ours.
    w.EN9OCRASSETS = { v: 1, gz: 1, files: { "dict.txt": gzipSync(bytes).toString("base64") } };
    const keep = [w.DecompressionStream, w.Blob, w.Response];
    w.DecompressionStream = DecompressionStream; w.Blob = Blob; w.Response = Response;
    try {
      assert.strictEqual(await A.text("dict.txt"), body, "gzip is undone and utf-8 decoded");
      assert.strictEqual((await A.bytes("dict.txt")).byteLength, bytes.length);
    } finally { [w.DecompressionStream, w.Blob, w.Response] = keep; }

    // float32 weights are stored byte-plane by byte-plane and woven back
    const floats = Buffer.from(new Float32Array([1.5, -2.25, 3.125, 1e-8, 6.0221e23, -0.0]).buffer);
    const s = 4, m = floats.length / s, planes = Buffer.alloc(floats.length);
    for (let k = 0, pos = 0; k < s; k++, pos += m) for (let i = 0; i < m; i++) planes[pos + i] = floats[i * s + k];
    w.EN9OCRASSETS = { v: 1, gz: 0, tr: { "det.onnx": 4 }, files: { "det.onnx": planes.toString("base64") } };
    assert.deepStrictEqual(Buffer.from(await A.bytes("det.onnx")), floats, "the byte planes weave back to the original weights");
    assert.strictEqual(A.weave(new Uint8Array([1, 4, 7, 2, 5, 8, 3, 6, 9, 99]), 3).join(","), "1,2,3,4,5,6,7,8,9,99",
      "a tail that does not fill a group is carried through untouched");

    // and where a browser cannot unzip, the reason is said plainly
    w.EN9OCRASSETS = { v: 1, gz: 1, files: { "dict.txt": gzipSync(bytes).toString("base64") } };
    w.DecompressionStream = undefined;
    await assert.rejects(A.text("dict.txt"), /cannot unpack the built-in OCR engine/);
    w.DecompressionStream = keep[0];
    delete w.EN9OCRASSETS;
  });

  await t("the offline build's own wording: the engine is built in, no internet, nothing to install", async () => {
    w.EN9OCRASSETS = { v: 1, gz: 1, files: { "rec.onnx": require("node:zlib").gzipSync(Buffer.from("weights")).toString("base64") } };
    await w.EN9OCR.service.health(true);
    const s = w.EN9OCR.service.statusText();
    assert.match(s, /built into this file/);
    assert.match(s, /no internet, nothing to install/);
    assert.ok(!/cdn\.jsdelivr\.net/.test(s), "nothing is promised from a CDN");
    delete w.EN9OCRASSETS;
  });

  await t("the OCR card offers the address box with the off hint, and the Settings card describes the in-browser engine", () => {
    assert.ok(DIST.includes("off = read in this browser"), "placeholder names the switch");
    assert.ok(DIST.includes("PaddleOCR PP-OCRv5 through ONNX Runtime Web"), "settings row");
    assert.ok(DIST.includes("used only when neither a service nor the in-browser PaddleOCR can be loaded"), "Tesseract.js is the last resort");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
