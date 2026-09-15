/* End-to-end for the IN-BROWSER PaddleOCR path: the shipped dist/index.html
   opened straight from disk (file://), no OCR service anywhere, PP-OCRv5
   running through ONNX Runtime Web inside Chromium.

     node tests/e2e/ocr_browser_e2e.mjs              dist/index.html
     node tests/e2e/ocr_browser_e2e.mjs --offline    dist/index.offline.html

   With --offline the page is the standalone build and EVERY network request
   is aborted, so the run proves the engine needs no internet whatsoever.
   Otherwise the CDN and GitHub downloads the page makes on first use are
   answered from local files here (the sandbox that runs this cannot reach
   them):
     cdn.jsdelivr.net/npm/onnxruntime-web@<v>/dist/*  -> node_modules/onnxruntime-web/dist
     cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/*  -> .cache/pdfjs-3.11.174/package/build
     cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/*        -> node_modules/pdf-lib/dist
     media.githubusercontent.com/.../ppocrv5/*         -> .cache/ppocrv5 (downloaded once if absent)
   Everything else about the run is the real thing: upload → auto-detect →
   OCR in the browser → Process entity waits → mapping → generated work paper.

   Run: node tests/e2e/ocr_browser_e2e.mjs   (needs Chromium; see EXEC) */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import JSZip from "jszip";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const FIX = path.join(root, "tests", "fixtures", "ocr");
const OFFLINE = process.argv.includes("--offline");
const DIST = path.join(root, "dist", OFFLINE ? "index.offline.html" : "index.html");
const EXEC = process.env.CHROME_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => fs.existsSync(p));
const MODEL_DIR = path.join(root, ".cache", "ppocrv5");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("ok:", m); } else { fail++; console.log("FAILED:", m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (arr, v) => arr.some((x) => typeof x === "number" && Math.abs(x - v) < 0.011);

const CASES = [
  { file: "digital.pdf", verdict: "digital", ocrPages: [], amounts: [30257.06, 154523.24] },
  { file: "scanned.pdf", verdict: "scanned", ocrPages: [1, 2], amounts: [30257.06, 21250.66, 154523.24, 72067.4] },
  { file: "mixed.pdf", verdict: "mixed", ocrPages: [2], amounts: [30257.06, 154523.24] },
  { file: "table.pdf", verdict: "scanned", ocrPages: [1], amounts: [], words: ["30,257.06", "72,067.40", "(61,139.37)", "154,523.24", "1000", "Cash"] },
  { file: "multipage.pdf", verdict: "scanned", ocrPages: [1, 2, 3, 4, 5, 6], amounts: [30257.06, 154523.24] },
  // the noisy, faded, skewed and turned scan: no deskew in the browser, so
  // the bar is "most figures still come through", as in the service's test
  { file: "difficult.pdf", verdict: "scanned", ocrPages: [1, 2], amounts: [30257.06, 154523.24], lenient: true },
];

/* The model files, from the pinned commit's LFS store, kept beside the repo. */
async function ensureModels(commit) {
  const base = `https://media.githubusercontent.com/media/jingsongliujing/OnnxOCR/${commit}/onnxocr/models/ppocrv5/`;
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  for (const [name, rel] of [["det.onnx", "det/det.onnx"], ["rec.onnx", "rec/rec.onnx"], ["cls.onnx", "cls/cls.onnx"], ["ppocrv5_dict.txt", "ppocrv5_dict.txt"]]) {
    const dst = path.join(MODEL_DIR, name);
    if (fs.existsSync(dst) && fs.statSync(dst).size > 1000) continue;
    console.log("downloading", rel);
    const r = await fetch(base + rel);
    if (!r.ok) throw new Error(`could not download ${rel}: ${r.status}`);
    fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
  }
}

async function main() {
  const layer = fs.readFileSync(DIST, "utf8");
  const commit = /MODEL_COMMIT:"([0-9a-f]{40})"/.exec(layer)?.[1];
  const ortVersion = /ORT_VERSION:"([\d.]+)"/.exec(layer)?.[1];
  ok(!!commit && !!ortVersion, `the shipped page pins the runtime (${ortVersion}) and the model commit (${commit && commit.slice(0, 7)})`);
  if (OFFLINE) {
    ok(/<script id="en9-ocr-assets">/.test(layer), `the offline build carries the packed engine (${(layer.length / 1048576).toFixed(1)} MB page)`);
  } else {
    await ensureModels(commit);
  }

  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--allow-file-access-from-files"] });
  const ctx = await browser.newContext({ acceptDownloads: true });
  // no service anywhere: the address is "off" before the app boots
  await ctx.addInitScript(() => { try { localStorage.setItem("en9OcrUrl", "off"); } catch (e) {} });
  const served = { ort: 0, models: 0, pdfjs: 0, pdflib: 0 };
  const serve = async (route, file, kind) => {
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "missing " + file });
    served[kind]++;
    const ext = path.extname(file);
    const type = ext === ".js" || ext === ".mjs" ? "text/javascript" : ext === ".wasm" ? "application/wasm" : ext === ".txt" ? "text/plain" : "application/octet-stream";
    return route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { "content-type": type, "access-control-allow-origin": "*" } });
  };
  const blocked = [];
  if (OFFLINE) {
    // nothing may leave the machine: every non-file request dies
    await ctx.route(/^(?!file:)/, (route) => { blocked.push(route.request().url()); return route.abort(); });
  } else {
    await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@[\d.]+\/dist\/(.+)$/, (route) => serve(route, path.join(root, "node_modules", "onnxruntime-web", "dist", /dist\/(.+?)(\?|$)/.exec(route.request().url())[1]), "ort"));
    await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@3\.11\.174\/build\/(.+)$/, (route) => serve(route, path.join(root, ".cache", "pdfjs-3.11.174", "package", "build", /build\/(.+?)(\?|$)/.exec(route.request().url())[1]), "pdfjs"));
    await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/pdf-lib@1\.17\.1\/dist\/(.+)$/, (route) => serve(route, path.join(root, "node_modules", "pdf-lib", "dist", /dist\/(.+?)(\?|$)/.exec(route.request().url())[1]), "pdflib"));
    await ctx.route(/^https:\/\/media\.githubusercontent\.com\/media\/jingsongliujing\/OnnxOCR\/[0-9a-f]+\/onnxocr\/models\/ppocrv5\/(.+)$/, (route) => serve(route, path.join(MODEL_DIR, path.basename(/ppocrv5\/(.+?)(\?|$)/.exec(route.request().url())[1])), "models"));
    await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js/, (route) => route.fulfill({ status: 404, body: "Tesseract.js must not be needed" }));
  }

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + DIST, { waitUntil: "load" });
  await page.waitForFunction(() => window.__WPACT && window.__WPGET && window.EN9OCRGATE && window.EN9PPOCR, null, { timeout: 30000 });
  ok(true, "app booted from file:// with the bridge, the gate and the in-browser PaddleOCR engine");
  await page.evaluate(() => { const b = [...document.querySelectorAll(".nav-item")].find((n) => /entit/i.test(n.textContent)); b && b.click(); });
  await page.waitForSelector(".en9-ocr-engine", { timeout: 15000 });
  await page.waitForFunction(() => !/Checking/.test(document.querySelector(".en9-ocr-engine").textContent), null, { timeout: 30000 });
  const card = await page.evaluate(() => document.querySelector(".en9-ocr-engine").textContent);
  ok(/turned off/.test(card) && /PaddleOCR \(PP-OCRv5\) runs in this browser/.test(card), "the card says the service is off and PaddleOCR reads in this browser");
  if (OFFLINE) ok(/built into this file/.test(card) && /no internet/.test(card), "the offline build says the engine is built in and needs no internet");

  let first = true;
  for (const c of CASES) {
    console.log(`\n--- ${c.file} ---`);
    const t0 = Date.now();
    const eid = await page.evaluate(() => { window.__WPACT.addEntity(); const s = window.__WPGET(); const e = s.entities[s.entities.length - 1]; window.__WPACT.setActiveEntity(e.id); return e.id; });
    await page.evaluate(() => { const b = [...document.querySelectorAll(".nav-item")].find((n) => /entit/i.test(n.textContent)); b && b.click(); });
    await page.waitForSelector("input[type=file]", { state: "attached", timeout: 15000 });
    const inputs = await page.$$("input[type=file][multiple]");
    await inputs[inputs.length - 1].setInputFiles(path.join(FIX, c.file));
    await page.waitForFunction((id) => window.__WPGET().entities.find((e) => e.id === id).files.length === 1, eid, { timeout: 15000 });
    // the probe runs on the next wp:state tick; give a scan up to 8 s to be
    // picked up, and a digital PDF 1.5 s to prove it is left alone
    let started = false;
    for (let i = 0; i < (c.ocrPages.length ? 16 : 3) && !started; i++) { await sleep(500); started = await page.evaluate((id) => window.EN9OCRGATE.pending(id) || Object.values(window.EN9OCR.jobs).some((j) => j.entityId === id), eid); }
    if (c.ocrPages.length) ok(started, `${c.file}: an OCR job started automatically at upload`);
    else ok(!started, `${c.file}: no OCR job for a digital PDF`);

    const btn = page.locator("button", { hasText: /^Process entity$/ }).last();
    await btn.click();
    if (c.ocrPages.length) {
      const busy = await page.evaluate((id) => window.__WPGET().entities.find((e) => e.id === id).status, eid);
      ok(busy === "processing", `${c.file}: the button went busy while OCR runs (status ${busy})`);
    }
    await page.waitForFunction((id) => { const e = window.__WPGET().entities.find((x) => x.id === id); return e && e.processedAt && e.status !== "processing"; }, eid, { timeout: 900000 });
    const ent = await page.evaluate((id) => {
      const e = window.__WPGET().entities.find((x) => x.id === id);
      const f = e.files[0];
      return { status: e.status, files: e.files.map((x) => x.name), ocr: f.ocr ? { engine: f.ocr.engine, backend: f.ocr.backend, ocrPages: f.ocr.ocrPages, verdict: f.ocr.verdict, source: f.ocr.source, originalName: f.ocr.originalName, pages: f.ocr.pages.map((p) => ({ page: p.page, status: p.status, conf: p.confMean, words: p.words.length, flags: p.flags.map((fl) => fl.kind) })) } : null,
        values: Object.values(e.contributions || {}).flat().map((x) => x.value),
        words: f.ocr ? f.ocr.pages.flatMap((p) => p.words.map((w) => w.text)) : [],
        items: (e.reviewItems || []).map((i) => ({ id: i.id, level: i.level })),
        jobs: Object.values(window.EN9OCR.jobs).filter((j) => j.entityId === id).map((j) => ({ name: j.name, status: j.status, error: j.error })),
        engine: window.EN9OCR.browserEngine, reason: window.EN9OCR.browserReason || null };
    }, eid);
    console.log(`  files: ${ent.files.join(", ")} | status: ${ent.status} | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (c.ocrPages.length) {
      if (first) { ok(ent.engine === "ppocr", `the in-browser engine is PaddleOCR, not Tesseract.js (${ent.engine}${ent.reason ? ": " + ent.reason : ""})`); first = false; }
      ok(ent.files.length === 1 && /\(OCR\)\.pdf$/.test(ent.files[0]), `${c.file}: replaced by its (OCR).pdf copy, nothing duplicated`);
      ok(ent.ocr && ent.ocr.source === "browser" && ent.ocr.engine === "paddle" && /ONNX Runtime Web/.test(ent.ocr.backend), `${c.file}: sidecar names PaddleOCR in the browser (${ent.ocr && ent.ocr.backend})`);
      ok(ent.ocr && JSON.stringify(ent.ocr.ocrPages) === JSON.stringify(c.ocrPages), `${c.file}: exactly pages ${c.ocrPages.join(",")} were OCR'd (got ${ent.ocr && ent.ocr.ocrPages})`);
      ok(ent.ocr && ent.ocr.verdict === c.verdict, `${c.file}: verdict ${c.verdict}`);
      ok(ent.ocr && ent.ocr.pages.filter((p) => p.status === "ocr").every((p) => p.words > 10 && p.conf > (c.lenient ? 0.6 : 0.9)), `${c.file}: every OCR'd page has words and confidence (${ent.ocr && ent.ocr.pages.map((p) => p.status + ":" + p.words + "@" + (p.conf == null ? "-" : p.conf.toFixed(2))).join(" ")})`);
      ok(ent.items.some((i) => i.id.startsWith("ocr-doc-")), `${c.file}: the review has the OCR notice`);
      ok(ent.jobs.length === 1 && ent.jobs[0].status === "done", `${c.file}: one job, done (${JSON.stringify(ent.jobs)})`);
    } else {
      ok(ent.files[0] === c.file && !ent.ocr, `${c.file}: left exactly as uploaded`);
    }
    ok(ent.status === "ready", `${c.file}: processing finished (${ent.status})`);
    if (c.lenient) {
      const got = c.amounts.filter((v) => near(ent.values, v)).length;
      ok(got >= 1, `${c.file}: ${got} of ${c.amounts.length} key figures booked from the difficult scan`);
    } else {
      for (const v of c.amounts) ok(near(ent.values, v), `${c.file}: ${v} was booked from the ${c.ocrPages.length ? "OCR'd" : "digital"} text`);
    }
    for (const wd of c.words || []) ok(ent.words.includes(wd), `${c.file}: OCR read '${wd}' exactly`);

    if (!c.amounts.length || c.lenient) { console.log("  (generation not attempted for this case)"); continue; }
    await page.evaluate((id) => {
      const A = window.__WPACT;
      for (const k of ["avgRate", "cyRate", "pyRate"]) A.setField(id, "fx", k, "1");
      A.confirmCurrency(id);
      const e = window.__WPGET().entities.find((x) => x.id === id);
      for (const it of e.reviewItems || []) if (it.level === "block" && !it.dismissed) A.dismissReviewItem(id, it.id, "e2e: acknowledged");
      for (const tid of ["EN9-tie-bs-eoy", "EN9-tie-bs-boy"]) A.dismissReviewItem(id, tid, "e2e: fixture balance sheet acknowledged");
    }, eid);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      page.evaluate((id) => window.__WPACT.generateOne(id), eid),
    ]);
    const out = path.join(os.tmpdir(), `e2e_browser_${c.file}.xlsx`);
    await download.saveAs(out);
    const zip = await JSZip.loadAsync(fs.readFileSync(out));
    const wbXml = await zip.file("xl/workbook.xml").async("string");
    const sheets = [...wbXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    const prov = sheets.find(([n]) => n === "Provenance");
    ok(!!prov, `${c.file}: generated workbook has a Provenance sheet`);
    if (prov) {
      const target = new RegExp(`Id="${prov[1]}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] || /Target="([^"]+)"[^>]*Id="PROV"/.exec(rels)?.[1];
      const xml = target ? await zip.file(target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\/?xl\//, "")).async("string") : "";
      const text = xml.replace(/<[^>]+>/g, " ");
      if (c.ocrPages.length) {
        ok(/OCR engine/.test(text) && /paddle/.test(text) && /ONNX Runtime Web/.test(text), `${c.file}: Provenance cites PaddleOCR in the browser for OCR'd figures`);
        ok(/OCR DOCUMENTS/.test(text) && new RegExp(c.file.replace(".", "\\.")).test(text), `${c.file}: Provenance lists the OCR'd document and the scan it replaced`);
      } else {
        ok(!/OCR DOCUMENTS/.test(text), `${c.file}: no OCR section for a digital-only entity`);
      }
    }
  }

  if (OFFLINE) {
    ok(blocked.length === 0, `not one network request was made in the whole run${blocked.length ? ": " + [...new Set(blocked)].slice(0, 5).join(", ") : ""}`);
    /* What the preparer actually does: double-click the downloaded file, with
       nothing set up — no service address, no store, no internet. */
    const plain = await browser.newContext({ acceptDownloads: true });
    await plain.route(/^(?!file:)/, (route) => { blocked.push(route.request().url()); return route.abort(); });
    const p2 = await plain.newPage();
    const err2 = [];
    p2.on("pageerror", (e) => err2.push(String(e)));
    await p2.goto("file://" + DIST, { waitUntil: "load" });
    await p2.waitForFunction(() => window.__WPACT && window.EN9OCRGATE, null, { timeout: 30000 });
    const id2 = await p2.evaluate(() => { window.__WPACT.addEntity(); const s = window.__WPGET(); const e = s.entities[s.entities.length - 1]; window.__WPACT.setActiveEntity(e.id); return e.id; });
    await p2.evaluate(() => { const b = [...document.querySelectorAll(".nav-item")].find((n) => /entit/i.test(n.textContent)); b && b.click(); });
    await p2.waitForSelector("input[type=file][multiple]", { state: "attached", timeout: 15000 });
    const ins2 = await p2.$$("input[type=file][multiple]");
    await ins2[ins2.length - 1].setInputFiles(path.join(FIX, "scanned.pdf"));
    await p2.waitForFunction((id) => { const e = window.__WPGET().entities.find((x) => x.id === id); return e && e.files[0] && e.files[0].ocr; }, id2, { timeout: 300000 });
    const f2 = await p2.evaluate((id) => { const f = window.__WPGET().entities.find((x) => x.id === id).files[0]; return { name: f.name, engine: f.ocr.engine, source: f.ocr.source, pages: f.ocr.ocrPages, conf: f.ocr.pages.map((p) => p.confMean) }; }, id2);
    ok(/\(OCR\)\.pdf$/.test(f2.name) && f2.engine === "paddle" && f2.source === "browser" && JSON.stringify(f2.pages) === "[1,2]",
      `a plain double-click with nothing configured OCRs the scan automatically (${JSON.stringify(f2)})`);
    ok(err2.length === 0, `no page errors on that plain run (${err2.slice(0, 2).join(" | ")})`);
    await plain.close();
  } else {
    // the models were fetched once and are served from IndexedDB afterwards
    ok(served.models === 4, `the four model files were downloaded exactly once (${served.models}) — later pages read them from the browser's store`);
    ok(served.ort >= 1, `ONNX Runtime came from the CDN (${served.ort} file(s))`);
    const second = await ctx.newPage();
    await second.goto("file://" + DIST, { waitUntil: "load" });
    await second.waitForFunction(() => window.EN9PPOCR, null, { timeout: 30000 });
    const cached = await second.evaluate(async () => { const u = window.EN9PPOCR.urls(); const b = await window.EN9PPOCR._dbGet(u.rec); return b ? b.byteLength : 0; });
    ok(cached === 16631306, `a fresh page finds the recognition model in IndexedDB (${cached} bytes)`);
  }
  ok(errors.length === 0, `no uncaught page errors (${errors.slice(0, 3).join(" | ")})`);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
