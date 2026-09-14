#!/usr/bin/env node
// Zero-dependency static server for the 5471 Work Paper.
// Serves the committed dist/ with no network access and no install step.
// Usage: node scripts/serve-local.mjs [port]     (default 8080)
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Works both from scripts/ in the repo and from the root of the unzipped bundle.
const here = dirname(fileURLToPath(import.meta.url));
const root = [join(here, '..', 'dist'), join(here, 'dist')].find((d) =>
  existsSync(join(d, 'index.html')),
);
if (!root) {
  console.error('Could not find dist/index.html next to this script.');
  process.exit(1);
}
const port = Number(process.argv[2] || process.env.PORT || 8080);
// The OCR service (ocr-service/, PaddleOCR) is a separate local process. Its
// /health, /detect and /ocr are reachable through /api/ocr/* here, so the app
// on this origin needs no CORS and no second address. When it is not
// running, the app is told so plainly and falls back to in-browser OCR.
const ocrUrl = new URL((process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8472').replace(/\/+$/, '') + '/');
const ocrTimeoutMs = Number(process.env.OCR_TIMEOUT_MS || 10 * 60 * 1000);

function proxyOcr(req, res, path) {
  const target = new URL(path.replace(/^\/api\/ocr\//, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), ocrUrl);
  const mk = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const up = mk(target, {
    method: req.method,
    headers: { 'content-type': req.headers['content-type'] || 'application/octet-stream' },
    timeout: ocrTimeoutMs,
  }, (r) => {
    res.writeHead(r.statusCode || 502, { 'content-type': r.headers['content-type'] || 'application/json', 'cache-control': 'no-store' });
    r.pipe(res);
  });
  const fail = (msg) => {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, reachable: false, url: ocrUrl.origin, error: msg }));
  };
  up.on('timeout', () => { up.destroy(new Error(`OCR service timed out after ${Math.round(ocrTimeoutMs / 1000)} s`)); });
  up.on('error', (err) => fail(`OCR service not reachable at ${ocrUrl.origin}: ${err.message}`));
  if (req.method === 'GET' || req.method === 'HEAD') up.end();
  else req.pipe(up);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.startsWith('/api/ocr/')) return proxyOcr(req, res, path);
  // Single-page app: everything falls back to index.html.
  const file = path === '/' || !path.includes('.') ? 'index.html' : path.replace(/^\/+/, '');
  const ext = file.slice(file.lastIndexOf('.'));
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, {
      'content-type': types[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    // Unknown path: fall back to the single-page app rather than 404-ing.
    try {
      const body = await readFile(join(root, 'index.html'));
      res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err && err.message ? err.message : err));
    }
  }
}).listen(port, () => {
  console.log(`5471 Work Paper running at http://localhost:${port}`);
  console.log(`OCR service expected at ${ocrUrl.origin} (proxied as /api/ocr/*; set OCR_SERVICE_URL to change)`);
  console.log('Press Ctrl+C to stop.');
});
