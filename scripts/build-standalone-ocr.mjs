#!/usr/bin/env node
/* Builds the OFFLINE single file: dist/index.html plus the OCR engine and its
   weights packed into the page, so a downloaded copy reads scanned PDFs with
   no network at all — nothing to install, no CDN, no model download.

     npm run build:standalone            -> dist/index.offline.html

   What goes in (gzipped, then base64; the page unpacks with
   DecompressionStream):
     ort.js     onnxruntime-web's loader          node_modules/onnxruntime-web
     ort.wasm   its WebAssembly binary            "
     ort.mjs    its module glue                   "
     pdflib.js  pdf-lib, to write the copy        node_modules/pdf-lib
     det/rec/cls.onnx + dict.txt  PP-OCRv5        .cache/ppocrv5 (see below)

   pdf.js is NOT packed: the app already bundles it, worker inlined.

   The models are the ones the Python service runs through ONNX — the
   `onnxocr` wheel's PP-OCRv5 weights. They are fetched once from the OnnxOCR
   project's GitHub LFS store at the commit the layer pins, and their sha256
   must match the hashes the layer pins; a mismatch fails the build. */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(root, "dist", "index.html");
const OUT = process.argv[2] || path.join(root, "dist", "index.offline.html");
const MODELS = path.join(root, ".cache", "ppocrv5");

const page = fs.readFileSync(DIST, "utf8");
const commit = /MODEL_COMMIT:"([0-9a-f]{40})"/.exec(page)?.[1];
const ortVersion = /ORT_VERSION:"([\d.]+)"/.exec(page)?.[1];
const sha = Object.fromEntries([...page.matchAll(/\b(det|rec|cls):"([0-9a-f]{64})"/g)].map((m) => [m[1], m[2]]));
if (!commit || !ortVersion || !sha.det) throw new Error("dist/index.html does not carry the OCR layer (no MODEL_COMMIT / ORT_VERSION / hashes)");

const digest = (buf) => createHash("sha256").update(buf).digest("hex");

async function model(name, rel) {
  const dst = path.join(MODELS, name);
  if (!fs.existsSync(dst)) {
    const url = `https://media.githubusercontent.com/media/jingsongliujing/OnnxOCR/${commit}/onnxocr/models/ppocrv5/${rel}`;
    process.stdout.write(`  fetching ${rel}\n`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`could not download ${rel}: ${r.status}`);
    fs.mkdirSync(MODELS, { recursive: true });
    fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
  }
  const buf = fs.readFileSync(dst);
  const key = name.replace(/\.onnx$/, "");
  if (sha[key] && digest(buf) !== sha[key]) throw new Error(`${name} does not match the hash the page pins — refusing to build`);
  return buf;
}

const ORT = path.join(root, "node_modules", "onnxruntime-web", "dist");
const local = (p) => { if (!fs.existsSync(p)) throw new Error(`missing ${p} — run npm install`); return fs.readFileSync(p); };

const files = {
  "ort.js": local(path.join(ORT, "ort.wasm.min.js")),
  "ort.wasm": local(path.join(ORT, "ort-wasm-simd-threaded.wasm")),
  "ort.mjs": local(path.join(ORT, "ort-wasm-simd-threaded.mjs")),
  "pdflib.js": local(path.join(root, "node_modules", "pdf-lib", "dist", "pdf-lib.min.js")),
  "det.onnx": await model("det.onnx", "det/det.onnx"),
  "rec.onnx": await model("rec.onnx", "rec/rec.onnx"),
  "cls.onnx": await model("cls.onnx", "cls/cls.onnx"),
  "dict.txt": await model("ppocrv5_dict.txt", "ppocrv5_dict.txt"),
};

/* Model weights are float32. Gzip barely dents them interleaved, because
   every fourth byte is a high-entropy mantissa; split into byte planes, the
   exponent plane compresses hard. The page weaves them back together. */
const TRANSPOSE = { "det.onnx": 4, "rec.onnx": 4, "cls.onnx": 4 };
const split = (buf, s) => {
  const body = Math.floor(buf.length / s) * s, m = body / s, out = Buffer.allocUnsafe(buf.length);
  let pos = 0;
  for (let k = 0; k < s; k++) { for (let i = 0; i < m; i++) out[pos + i] = buf[i * s + k]; pos += m; }
  buf.copy(out, body, body);
  return out;
};

const packed = {};
let raw = 0, packedBytes = 0;
for (const [name, buf] of Object.entries(files)) {
  const s = TRANSPOSE[name] || 0;
  const gz = gzipSync(s ? split(buf, s) : buf, { level: 9 });
  packed[name] = gz.toString("base64");
  raw += buf.length; packedBytes += packed[name].length;
  process.stdout.write(`  ${name.padEnd(12)} ${(buf.length / 1048576).toFixed(2).padStart(6)} MB -> ${(packed[name].length / 1048576).toFixed(2).padStart(6)} MB packed${s ? " (byte planes)" : ""}\n`);
}

/* One script block, before the layer, holding only data — the layer reads it
   lazily, so a page without this block downloads as it always did. */
const block = `<script id="en9-ocr-assets">window.EN9OCRASSETS=${JSON.stringify({ v: 1, gz: 1, tr: TRANSPOSE, ort: ortVersion, commit, files: packed })}</script>`;
const anchor = '<script id="en9-js">';
if (!page.includes(anchor)) throw new Error("no en9-js block to anchor the assets before");
const out = page.replace(/<script id="en9-ocr-assets">[\s\S]*?<\/script>\n?/, "").replace(anchor, block + "\n" + anchor);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`\n${path.relative(root, OUT)}  ${(out.length / 1048576).toFixed(1)} MB  (page ${(page.length / 1048576).toFixed(1)} MB + ${(raw / 1048576).toFixed(1)} MB of engine packed to ${(packedBytes / 1048576).toFixed(1)} MB)`);
