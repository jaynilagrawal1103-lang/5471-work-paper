/* The complete OCR workflow in a real browser:
 *
 *   Upload → auto-detect → OCR (service) → Process entity → mapping → generate
 *
 * against the SHIPPED dist served by scripts/serve-local.mjs with the OCR
 * service behind /api/ocr/*. Six documents, each a different shape: digital,
 * scanned, mixed, a dense table, six pages, and a skewed/noisy/rotated scan.
 * For each one it checks what a preparer would check: the right pages were
 * OCR'd (and none that were not needed), the scan was replaced by a copy with
 * a sidecar, Process entity waited for OCR, the figures from the scan were
 * booked, the review items say the document was OCR'd, and the generated
 * work paper's Provenance sheet cites the engine.
 *
 * Needs: the OCR service (python -m ocr_service), the local server
 * (OCR_SERVICE_URL=http://127.0.0.1:8472 node scripts/serve-local.mjs 8090),
 * playwright-core and a Chromium. Not part of test:all — run it with
 *   npm run test:e2e-ocr [-- http://127.0.0.1:8090]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import JSZip from "jszip";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const BASE = process.argv[2] || process.env.E2E_BASE || "http://127.0.0.1:8090";
const FIX = path.join(root, "tests", "fixtures", "ocr");
const EXEC = process.env.CHROME_PATH || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("ok:", m); } else { fail++; console.log("FAILED:", m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (arr, v) => arr.some((x) => typeof x === "number" && Math.abs(x - v) < 0.011);

const CASES = [
  { file: "digital.pdf", verdict: "digital", ocrPages: [], amounts: [30257.06, 154523.24] },
  { file: "scanned.pdf", verdict: "scanned", ocrPages: [1, 2], amounts: [30257.06, 21250.66, 154523.24, 72067.4] },
  { file: "mixed.pdf", verdict: "mixed", ocrPages: [2], amounts: [30257.06, 154523.24] },
  // A bare four-column trial balance is "classified as unknown" by the mapping
  // rules in its DIGITAL form too (0 lines), so what OCR owes here is the words:
  // every figure readable in the sidecar and the text layer, not a booking.
  { file: "table.pdf", verdict: "scanned", ocrPages: [1], amounts: [], words: ["30,257.06", "72,067.40", "(61,139.37)", "154,523.24", "1000", "Cash"] },
  { file: "multipage.pdf", verdict: "scanned", ocrPages: [1, 2, 3, 4, 5, 6], amounts: [30257.06, 154523.24] },
  { file: "difficult.pdf", verdict: "scanned", ocrPages: [1, 2], amounts: [154523.24], lenient: true },
];

async function main() {
  const health = await fetch(`${BASE}/api/ocr/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  if (!health.ok) { console.error("OCR service not reachable through", BASE, health); process.exit(2); }
  console.log("OCR service:", health.primary, "chain", health.chain.join(" → "), "—", health.engines[health.primary].backend);

  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.__WPACT && window.__WPGET && window.EN9OCRGATE, null, { timeout: 30000 });
  ok(true, "app booted with the bridge and the OCR gate");

  for (const c of CASES) {
    console.log(`\n--- ${c.file} ---`);
    // a fresh entity per document, made active
    const eid = await page.evaluate(() => { window.__WPACT.addEntity(); const s = window.__WPGET(); const e = s.entities[s.entities.length - 1]; window.__WPACT.setActiveEntity(e.id); return e.id; });
    await page.evaluate(() => { const b = [...document.querySelectorAll(".nav-item")].find((n) => /entit/i.test(n.textContent)); b && b.click(); });
    await page.waitForSelector("input[type=file]", { state: "attached", timeout: 15000 });
    // upload through the real dropzone input of the active entity's card
    const inputs = await page.$$("input[type=file][multiple]");
    const input = inputs[inputs.length - 1];
    await input.setInputFiles(path.join(FIX, c.file));
    // the store attaches, the layer probes and (when needed) starts OCR
    await page.waitForFunction((id) => window.__WPGET().entities.find((e) => e.id === id).files.length === 1, eid, { timeout: 15000 });
    await sleep(1500);
    const started = await page.evaluate((id) => window.EN9OCRGATE.pending(id) || Object.values(window.EN9OCR.jobs).some((j) => j.entityId === id), eid);
    if (c.ocrPages.length) ok(started, `${c.file}: an OCR job started automatically at upload`);
    else ok(!started, `${c.file}: no OCR job for a digital PDF`);

    // Press Process entity NOW — it must wait for OCR rather than read the scan.
    // the newest entity's card is the last one on the page
    const btn = page.locator("button", { hasText: /^Process entity$/ }).last();
    await btn.click();
    if (c.ocrPages.length) {
      const busy = await page.evaluate((id) => window.__WPGET().entities.find((e) => e.id === id).status, eid);
      ok(busy === "processing", `${c.file}: the button went busy while OCR runs (status ${busy})`);
      const startedEarly = await page.evaluate((id) => { const s = window.__WPGET(); const e = s.entities.find((x) => x.id === id); return !!e.processedAt; }, eid);
      ok(!startedEarly, `${c.file}: processing had not completed before OCR finished`);
    }
    // wait for OCR + processing to complete
    await page.waitForFunction((id) => { const e = window.__WPGET().entities.find((x) => x.id === id); return e && e.processedAt && e.status !== "processing"; }, eid, { timeout: 600000 });
    const ent = await page.evaluate((id) => {
      const e = window.__WPGET().entities.find((x) => x.id === id);
      const f = e.files[0];
      return { status: e.status, files: e.files.map((x) => x.name), ocr: f.ocr ? { engine: f.ocr.engine, backend: f.ocr.backend, verify: f.ocr.verifyEngine, ocrPages: f.ocr.ocrPages, verdict: f.ocr.verdict, source: f.ocr.source, mode: f.ocr.mode, originalName: f.ocr.originalName, pages: f.ocr.pages.map((p) => ({ page: p.page, status: p.status, conf: p.confMean, words: p.words.length, flags: p.flags.length })) } : null,
        values: Object.values(e.contributions || {}).flat().map((x) => x.value),
        words: f.ocr ? f.ocr.pages.flatMap((p) => p.words.map((w) => w.text)) : [],
        pagesCited: Object.values(e.contributions || {}).flat().map((x) => x.page),
        items: (e.reviewItems || []).map((i) => ({ id: i.id, level: i.level, msg: i.message.slice(0, 120) })),
        jobs: Object.values(window.EN9OCR.jobs).filter((j) => j.entityId === id).map((j) => ({ name: j.name, status: j.status, error: j.error })) };
    }, eid);
    console.log("  files:", ent.files.join(", "), "| status:", ent.status);
    if (c.ocrPages.length) {
      ok(ent.files.length === 1 && /\(OCR\)\.pdf$/.test(ent.files[0]), `${c.file}: replaced by its (OCR).pdf copy, nothing duplicated`);
      ok(ent.ocr && ent.ocr.source === "service" && ent.ocr.engine === health.primary, `${c.file}: sidecar names the service's primary engine (${ent.ocr && ent.ocr.backend})`);
      ok(ent.ocr && JSON.stringify(ent.ocr.ocrPages) === JSON.stringify(c.ocrPages), `${c.file}: exactly pages ${c.ocrPages.join(",")} were OCR'd (got ${ent.ocr && ent.ocr.ocrPages})`);
      ok(ent.ocr && ent.ocr.verdict === c.verdict, `${c.file}: verdict ${c.verdict}`);
      ok(ent.ocr && ent.ocr.originalName === c.file, `${c.file}: the sidecar records the replaced scan`);
      ok(ent.ocr && ent.ocr.pages.filter((p) => p.status === "ocr").every((p) => p.words > 10 && p.conf > (c.lenient ? 0.6 : 0.9)), `${c.file}: every OCR'd page has words and confidence (${ent.ocr && ent.ocr.pages.map((p) => p.status + ":" + p.words + "@" + (p.conf == null ? "-" : p.conf.toFixed(2))).join(" ")})`);
      ok(ent.items.some((i) => i.id.startsWith("ocr-doc-")), `${c.file}: the review has the OCR notice`);
      ok(ent.jobs.length === 1 && ent.jobs[0].status === "done", `${c.file}: one job, done (${JSON.stringify(ent.jobs)})`);
      ok(!ent.pagesCited.some((p) => p != null && !c.ocrPages.includes(p) && c.verdict === "scanned"), `${c.file}: booked figures cite OCR'd pages`);
    } else {
      ok(ent.files[0] === c.file && !ent.ocr, `${c.file}: left exactly as uploaded`);
    }
    ok(ent.status === "ready", `${c.file}: processing finished (${ent.status})`);
    for (const v of c.amounts) ok(near(ent.values, v), `${c.file}: ${v} was booked from the ${c.ocrPages.length ? "OCR'd" : "digital"} text`);
    for (const wd of c.words || []) ok(ent.words.includes(wd), `${c.file}: OCR read '${wd}' exactly`);
    if (c.file === "mixed.pdf") ok(ent.pagesCited.includes(2), "mixed.pdf: figures were booked from the OCR'd page 2");

    if (!c.amounts.length) { console.log("  (nothing booked by design — generation not attempted)"); continue; }
    // Generation has its own gates (rates, currency confirmation, balance
    // blockers). Fill the preparer's part the way a preparer would, then
    // acknowledge whatever still blocks with a note, and generate.
    const blockers = await page.evaluate((id) => {
      const A = window.__WPACT;
      for (const k of ["avgRate", "cyRate", "pyRate"]) A.setField(id, "fx", k, "1");
      A.confirmCurrency(id);
      const e = window.__WPGET().entities.find((x) => x.id === id);
      const left = [];
      for (const it of e.reviewItems || []) if (it.level === "block" && !it.dismissed) { A.dismissReviewItem(id, it.id, "e2e: acknowledged"); left.push(it.id); }
      // The tie-out blockers are computed at read time, not stored; the
      // fixtures' balance sheet does not tie under the mapping rules, and
      // acknowledging with a note is the app's documented path past them.
      for (const tid of ["EN9-tie-bs-eoy", "EN9-tie-bs-boy"]) A.dismissReviewItem(id, tid, "e2e: fixture balance sheet acknowledged");
      return left;
    }, eid);
    if (blockers.length) console.log("  acknowledged blockers:", blockers.join(", "));
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      page.evaluate((id) => window.__WPACT.generateOne(id), eid),
    ]).catch(async (e) => {
      const why = await page.evaluate((id) => ({ toast: window.__WPGET().toast, blocks: (window.__WPGET().entities.find((x) => x.id === id).reviewItems || []).filter((i) => i.level === "block" && !i.dismissed).map((i) => i.id) }), eid);
      throw new Error(`generation produced no download: ${e.message}; toast=${JSON.stringify(why.toast)}; blocks=${why.blocks.join(",")}`);
    });
    const out = path.join(os.tmpdir(), `e2e_${c.file}.xlsx`);
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
        ok(/OCR engine/.test(text), `${c.file}: Provenance sheet carries the OCR engine column`);
        ok(new RegExp(health.primary).test(text), `${c.file}: Provenance cites ${health.primary} for OCR'd figures`);
        ok(/OCR DOCUMENTS/.test(text) && new RegExp(c.file.replace(".", "\\.")).test(text), `${c.file}: Provenance lists the OCR'd document and the scan it replaced`);
      } else {
        ok(!/OCR DOCUMENTS/.test(text), `${c.file}: no OCR section for a digital-only entity`);
      }
    }
  }

  ok(errors.length === 0, `no uncaught page errors (${errors.slice(0, 3).join(" | ")})`);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
