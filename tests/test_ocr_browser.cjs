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

  await t("model files come from the LFS store, the dictionary from the plain-file host (media.* answers 404 for it)", () => {
    const u = E.urls();
    for (const k of ["det", "rec", "cls"]) {
      assert.ok(Array.isArray(u[k]) && u[k].length >= 1, k + " has a list of places");
      assert.match(u[k][0], /^https:\/\/media\.githubusercontent\.com\/media\/jingsongliujing\/OnnxOCR\/[0-9a-f]{40}\/onnxocr\/models\/ppocrv5\/(det|rec|cls)\/\1\.onnx$/);
    }
    assert.match(u.dict[0], /^https:\/\/raw\.githubusercontent\.com\/jingsongliujing\/OnnxOCR\/[0-9a-f]{40}\/onnxocr\/models\/ppocrv5\/ppocrv5_dict\.txt$/, "raw.* first");
    assert.match(u.dict[1], /^https:\/\/cdn\.jsdelivr\.net\/gh\/jingsongliujing\/OnnxOCR@[0-9a-f]{40}\/onnxocr\/models\/ppocrv5\/ppocrv5_dict\.txt$/, "the jsDelivr GitHub mirror second");
    assert.ok(!u.dict.some((x) => /media\.githubusercontent/.test(x)), "never the LFS host for a plain file");
    assert.match(E.MODEL_SHA.dict, /^d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b$/, "the dictionary is pinned too");
    w.localStorage.setItem("en9OcrModelsUrl", "http://models.local/pp/");
    try { const o = E.urls(); same([o.det, o.dict], [["http://models.local/pp/det/det.onnx"], ["http://models.local/pp/ppocrv5_dict.txt"]], "an address set by hand serves all four"); }
    finally { w.localStorage.removeItem("en9OcrModelsUrl"); }
  });

  await t("an asset is used only when it is the pinned file: 404, LFS pointer, error page and wrong bytes are refused, the next place is tried", async () => {
    const { webcrypto, createHash } = require("node:crypto");
    Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true });
    const good = Buffer.from("line-a\nline-b\n"), sha = createHash("sha256").update(good).digest("hex");
    const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const store = new Map(), calls = [];
    const keep = [E._dbGet, E._dbPut, E._dbDel, w.fetch];
    E._dbGet = async (k) => store.get(k) || null; E._dbPut = async (k, v) => { store.set(k, v); return true; }; E._dbDel = async (k) => { store.delete(k); return true; };
    const answer = { "u:404": [404, ""], "u:ptr": [200, "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n"], "u:html": [200, "<!DOCTYPE html><title>err</title>"], "u:bad": [200, "other bytes"], "u:good": [200, good] };
    w.fetch = async (url) => { calls.push(url); const [st, body] = answer[url]; const b = Buffer.from(body);
      return { ok: st < 300, status: st, headers: { get: () => String(b.length) }, arrayBuffer: async () => ab(b) }; };
    try {
      assert.strictEqual(await E.check(ab(good), sha), null);
      assert.match(await E.check(ab(Buffer.from(answer["u:ptr"][1])), sha), /Git LFS pointer/);
      assert.match(await E.check(ab(Buffer.from(answer["u:html"][1])), sha), /web page/);
      assert.match(await E.check(ab(Buffer.from("other bytes")), sha), /sha256 .* not the pinned/);
      const got = await E.fetchFile(["u:404", "u:ptr", "u:html", "u:bad", "u:good"], "the test file", null, sha);
      assert.strictEqual(Buffer.from(got).toString(), good.toString(), "the first good place wins");
      same(calls, ["u:404", "u:ptr", "u:html", "u:bad", "u:good"], "a 404 or a wrong file is final for that place: no pointless retry");
      assert.ok(store.has("u:good") && store.size === 1, "only the verified file is stored");

      // a bad stored copy (e.g. an error page kept by an older build) is removed, never reused
      store.clear(); calls.length = 0; store.set("u:good", ab(Buffer.from("<html>404</html>")));
      const again = await E.fetchFile(["u:good"], "the test file", null, sha);
      assert.strictEqual(Buffer.from(again).toString(), good.toString());
      same(calls, ["u:good"], "downloaded again after the stored copy failed the check");

      // every place wrong: the real reasons are reported, not swallowed
      calls.length = 0;
      await assert.rejects(E.fetchFile(["u:404", "u:ptr"], "the test file", null, sha), (e) => /u:404 \(404\)/.test(e.message) && /Git LFS pointer/.test(e.message));
    } finally { [E._dbGet, E._dbPut, E._dbDel, w.fetch] = keep; }
  });

  await t("a dropped connection is retried once before the next place", async () => {
    const keep = [E._dbGet, E._dbPut, w.fetch, w.setTimeout]; let n = 0;
    E._dbGet = async () => null; E._dbPut = async () => true;
    w.setTimeout = (f) => { f(); return 0; };
    const b = Buffer.from("ok");
    w.fetch = async () => { if (++n === 1) throw new Error("network reset"); return { ok: true, status: 200, headers: { get: () => "2" }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + 2) }; };
    try { const got = await E.fetchFile(["u:flaky"], "x", null, null); assert.strictEqual(Buffer.from(got).toString(), "ok"); assert.strictEqual(n, 2, "second attempt at the same place"); }
    finally { [E._dbGet, E._dbPut, w.fetch, w.setTimeout] = keep; }
  });

  await t("the recogniser's class count must equal blank + dictionary + space", async () => {
    const keep = E.sessions;
    E.sessions = { rec: { outputNames: ["y"], outputMetadata: [{ name: "y", shape: ["b", "t", 18385] }] } };
    try { assert.strictEqual(await E.recClasses(), 18385, "read from the model's output shape"); }
    finally { E.sessions = keep; }
    assert.ok(DIST.includes("classes but the dictionary gives"), "a mismatch stops the engine with the reason");
  });

  await t("a read by the fallback engine says so on the row; the real reason stays in Details", () => {
    assert.ok(DIST.includes("Primary OCR unavailable \\u2014 fallback OCR used; review recommended.") || DIST.includes("Primary OCR unavailable \u2014 fallback OCR used; review recommended."));
  });

  await t("the engine line leads with the engine that reads; where a service was looked for and why a primary engine failed are Details", async () => {
    const svc = w.EN9OCR.service;
    svc.setUserUrl(""); await svc.health(true);
    const keep = [w.EN9OCR.browserEngine, w.EN9OCR.browserReason];
    try {
      w.EN9OCR.browserEngine = "ppocr"; w.EN9OCR.browserReason = "";
      let p = svc.statusParts();
      assert.match(p.main, /^PaddleOCR \(PP-OCRv5\) runs in this browser/, "no service is not an error: the reading engine comes first");
      assert.ok(!/No OCR service found|Failed to fetch|https?:\/\//.test(p.main), "no probe address or error in the main line: " + p.main);
      assert.ok(p.details.some((d) => /Service looked for at .* none running/.test(d)), "where it looked is kept, in Details");
      w.EN9OCR.browserEngine = "tesseract.js"; w.EN9OCR.browserReason = "Could not download https://example/det.onnx (404)";
      p = svc.statusParts();
      assert.match(p.main, /^Primary OCR unavailable \u2014 fallback OCR \(Tesseract\.js\) is reading instead; review recommended\./);
      assert.ok(p.details.includes("PaddleOCR could not be loaded here: Could not download https://example/det.onnx (404)"), "the real error is kept, not hidden");
      assert.ok(svc.statusText().includes("det.onnx (404)"), "statusText still carries everything");
    } finally { [w.EN9OCR.browserEngine, w.EN9OCR.browserReason] = keep; }
  });

  await t("the row counts uncertain WORDS, not flags: one word flagged twice is one reading to check", () => {
    assert.ok(DIST.includes("function en9OcrFlaggedWords(pages)"));
    assert.ok(DIST.includes("var flags = en9OcrFlaggedWords(res.sidecar.pages);") && DIST.includes("var flagged=en9OcrFlaggedWords(oc.pages);"));
  });

  /* A scanned statement that prints figures half a line off their captions
     (Romy Cuadras, Athletic Prime SARL, 2024 P&L): read as-is, the text layer
     put "Loyer" and 2,620.00 on different lines and gave "Frais de publicité"
     the communication line's 2,525.23. Coordinates are the real OCR boxes. */
  const W = (text, x0, y0, x1, y1) => ({ text, bbox: { x0, y0, x1, y1 } });
  const romyPnl = [
    W("Loyer", 87.1, 201.7, 107.9, 211.2), W("0.00", 455, 201.7, 470.4, 211.2), W("2620.00", 510, 206, 539.2, 215.5),
    W("Petit", 86.7, 208.8, 102.2, 221.2), W("materiel", 104, 208.8, 130, 221.2), W("549.54", 445.8, 212.9, 470.4, 222.9), W("1", 511.2, 213.8, 515, 223.8), W("032.09", 516.8, 213.8, 539.2, 223.8),
    W("Fournitures", 87.5, 217.1, 123.5, 228.3), W("de", 125, 217.1, 132, 228.3), W("bureau", 134, 217.1, 156, 228.3),
    W("1", 442.5, 221.7, 446.3, 231.7), W("085.28", 448.2, 221.7, 471.2, 231.7), W("594.36", 515.8, 222.9, 539.6, 230.8),
    W("Cotisations,", 87.5, 224.6, 123.5, 236.2), W("affiliations", 125, 224.6, 160, 236.2),
    W("Frais", 87, 232.9, 104, 245), W("de", 106, 232.9, 113, 245), W("communication", 115.1, 232.9, 161.2, 245), W("1300.50", 441.7, 237.5, 471.2, 247.1),
    W("Frais", 87, 238, 104, 249), W("de", 106, 238, 113, 249), W("publicité", 115, 238, 146, 249), W("2525.23", 510, 238.5, 539.6, 248),
    W("514.89", 446, 244, 471, 254), W("363.28", 515, 244, 539.6, 254),
    W("Frais", 87, 247, 104, 258), W("de", 106, 247, 113, 258), W("deplacements", 115, 247, 160, 258), W("2000.00", 440, 251, 471, 261), W("2006.25", 509, 251, 539.6, 261),
  ];
  const lineOf = (words, caption) => {
    const c = words.find((w) => w.text === caption); const yc = (c.bbox.y0 + c.bbox.y1) / 2;
    return words.filter((w) => /^[\d.]+$/.test(w.text) && Math.abs((w.bbox.y0 + w.bbox.y1) / 2 - yc) < 1.5).map((w) => w.text).join(" ");
  };

  await t("scanned rows: each figure is put on its own caption's line in the text layer, whatever the print offset", () => {
    const out = w.EN9ocrAlignRows(romyPnl);
    assert.strictEqual(lineOf(out, "Loyer"), "0.00 2620.00");
    assert.strictEqual(lineOf(out, "Petit"), "549.54 1 032.09");
    assert.strictEqual(lineOf(out, "Fournitures"), "1 085.28 594.36", "the row between two captions goes to the one it belongs to");
    assert.strictEqual(lineOf(out, "Cotisations,"), "", "a caption with no figure stays without one");
    assert.strictEqual(lineOf(out, "communication"), "1300.50 2525.23");
    assert.strictEqual(lineOf(out, "publicité"), "514.89 363.28");
    assert.strictEqual(lineOf(out, "deplacements"), "2000.00 2006.25");
  });

  await t("scanned rows: only the text layer moves — the words as read are not changed in place", () => {
    const before = JSON.stringify(romyPnl);
    w.EN9ocrAlignRows(romyPnl);
    assert.strictEqual(JSON.stringify(romyPnl), before, "the sidecar keeps every word where it was read");
  });

  await t("scanned rows: a page whose figures already sit on their captions is returned untouched", () => {
    const aligned = [
      W("Cash", 80, 100, 100, 110), W("1,000.00", 400, 100, 440, 110), W("900.00", 470, 100, 500, 110),
      W("Debtors", 80, 115, 110, 125), W("2,000.00", 400, 115, 440, 125), W("1,800.00", 470, 115, 500, 125),
      W("Stock", 80, 130, 100, 140), W("3,000.00", 400, 130, 440, 140), W("2,700.00", 470, 130, 500, 140),
      W("Total", 80, 145, 100, 155), W("6,000.00", 400, 145, 440, 155), W("5,400.00", 470, 145, 500, 155),
    ];
    assert.strictEqual(w.EN9ocrAlignRows(aligned), aligned);
  });

  await t("text runs: the words of one caption are written as one string with real spaces; columns stay apart", () => {
    const runs = w.EN9ocrRuns([W("Total", 90, 100, 110, 110), W("des", 112, 100, 124, 110), W("produits", 126, 100, 156, 110),
      W("1540.00", 440, 100, 470, 110), W("16", 505, 100, 512, 110), W("837.90", 514, 100, 539, 110)]).map((r) => r.text);
    same(runs, ["Total des produits", "1540.00", "16 837.90"]);
  });

  await t("health() is always a promise — with the service off, an expired check no longer leaves an OCR job 'running' for ever", async () => {
    const svc = w.EN9OCR.service;
    svc.setUserUrl("off");
    try {
      const r = svc.health(true);
      assert.ok(r && typeof r.then === "function", "forced check, nothing to probe");
      svc._healthAt = 0;                                   // the 60-second cache has expired
      const r2 = svc.health();
      assert.ok(r2 && typeof r2.then === "function", "expired cache, nothing to probe");
      assert.strictEqual((await r2).available, false);
    } finally { svc.setUserUrl(""); }
    assert.ok(DIST.includes("job.p = Promise.resolve().then(function () { return EN9ocrRunAny("), "a throw before the engine starts fails the job visibly");
  });

  await t("the OCR card offers the address box with the off hint, and the Settings card describes the in-browser engine", () => {
    assert.ok(DIST.includes("off = read in this browser"), "placeholder names the switch");
    assert.ok(DIST.includes("PaddleOCR PP-OCRv5 through ONNX Runtime Web"), "settings row");
    assert.ok(DIST.includes("used only when neither a service nor the in-browser PaddleOCR can be loaded"), "Tesseract.js is the last resort");
  });

  /* PaddleOCR first; Tesseract.js reads a page again when PaddleOCR failed
     on it or was unsure, and the more confident reading is kept. */
  const PW = (conf, n = 10) => ({ words: Array.from({ length: n }, (_, i) => ({ text: "w" + i, bbox: { x0: i, y0: 0, x1: i + 1, y1: 1 }, confidence: conf })) });
  const noteOf = async (paddle, tess) => {
    const pg = {}, io = { fallbackRecognize: () => (tess instanceof Error ? Promise.reject(tess) : Promise.resolve(tess)) };
    const out = await w.en9OcrSecondOpinion(io, { ppocr: true }, pg, paddle, "eng", () => {}, 1, 1);
    return { out, pg };
  };
  await t("a confident PaddleOCR page is kept as read, with no second engine", async () => {
    assert.strictEqual(w.EN9ocrUnsure({ data: PW(97) }), null);
    let asked = false;
    const out = await w.en9OcrSecondOpinion({ fallbackRecognize: () => { asked = true; return Promise.resolve(PW(99)); } }, { ppocr: true }, {}, { data: PW(97) }, "eng", () => {}, 1, 1);
    assert.ok(!asked, "Tesseract.js is not even loaded");
    assert.strictEqual(out.words[0].confidence, 97);
  });
  await t("unsure means: an error, no text, a low average, or many weak words", () => {
    assert.match(w.EN9ocrUnsure({ err: new Error("boom") }), /failed on this page \(boom\)/);
    assert.match(w.EN9ocrUnsure({ data: { words: [] } }), /no text/);
    assert.match(w.EN9ocrUnsure({ data: PW(70) }), /average confidence 70%/);
    const mix = { words: [...PW(99, 6).words, ...PW(70, 3).words] };
    assert.match(w.EN9ocrUnsure({ data: mix }), /unsure of 33% of the words/);
  });
  await t("a PaddleOCR crash on a page is read by Tesseract.js instead", async () => {
    const { out, pg } = await noteOf({ err: new Error("session lost") }, PW(91));
    assert.strictEqual(out.words[0].confidence, 91);
    assert.strictEqual(pg.fallback.engine, "tesseract.js");
    assert.match(pg.fallback.outcome, /its reading is used/);
  });
  await t("an unsure page takes Tesseract.js only when it is surer and reads as much", async () => {
    let r = await noteOf({ data: PW(70) }, PW(92));
    assert.strictEqual(r.pg.fallback.engine, "tesseract.js");
    r = await noteOf({ data: PW(70) }, PW(65));
    assert.strictEqual(r.pg.fallback.engine, "paddle", "Tesseract.js no surer");
    r = await noteOf({ data: PW(70, 10) }, PW(95, 3));
    assert.strictEqual(r.pg.fallback.engine, "paddle", "Tesseract.js read far less of the page");
  });
  await t("when Tesseract.js cannot be loaded, PaddleOCR's reading stays; a crash with no second engine fails visibly", async () => {
    const r = await noteOf({ data: PW(70) }, new Error("offline"));
    assert.strictEqual(r.pg.fallback.engine, "paddle");
    assert.match(r.pg.fallback.outcome, /could not be loaded \(offline\)/);
    await assert.rejects(noteOf({ err: new Error("session lost") }, new Error("offline")), /could not read it either/);
  });
  await t("the sidecar names the pages Tesseract.js read and says why", () => {
    w.EN9OCR.browserEngine = "ppocr";
    const pages = [{ n: 1, scale: 1, w: 100, h: 100, words: PW(96).words, fallback: { engine: "tesseract.js", why: "PaddleOCR failed on this page (x)", outcome: "Tesseract.js read it more confidently" } },
                   { n: 2, scale: 1, w: 100, h: 100, words: PW(98).words }];
    const sc = w.EN9OCR.sidecarFromLocal(pages, [1, 2], "manual", "eng");
    assert.match(sc.backend, /Tesseract\.js 5 on page 1 \(PaddleOCR failed or was unsure there\)/);
    same(sc.chain, ["paddle", "tesseract.js"]);
    assert.strictEqual(sc.pages[0].engine, "tesseract.js");
    assert.strictEqual(sc.pages[1].engine, "paddle");
    assert.ok(sc.pages[0].flags.some((f) => f.kind === "engine-fallback" && f.level === "info"));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
