/* The OCR service is a separate Python process (ocr-service/, PaddleOCR
   primary). The browser never talks to it directly: it posts the document to
   /api/ocr/* on this server, which forwards the raw body and query string
   to the service and streams the answer back. One origin, no CORS, and the
   service can stay bound to localhost.

   Availability is reported on /api/health (`ocr`) so the app can decide up
   front whether to use the service or fall back to in-browser OCR. */

import type { FastifyInstance } from "fastify";

export type OcrProxyConfig = { url: string; timeoutMs: number };

export function readOcrConfig(): OcrProxyConfig {
  return {
    url: (process.env.OCR_SERVICE_URL || "http://127.0.0.1:8472").replace(/\/+$/, ""),
    // A six-page scan at 300 dpi through two engines takes tens of seconds;
    // the default leaves room for a long document on a slow CPU.
    timeoutMs: Number(process.env.OCR_TIMEOUT_MS || 10 * 60 * 1000),
  };
}

/** GET <service>/health, or an honest "not reachable" — never a throw. */
export async function ocrHealth(cfg: OcrProxyConfig): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(4000) });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { reachable: r.ok, url: cfg.url, ...body };
  } catch (e) {
    return { reachable: false, ok: false, url: cfg.url, error: (e as Error).message };
  }
}

export function registerOcrProxy(app: FastifyInstance, cfg: OcrProxyConfig) {
  // The document arrives as a raw body; Fastify must not try to parse it.
  for (const type of ["application/pdf", "application/octet-stream", "image/png", "image/jpeg"]) {
    if (!app.hasContentTypeParser(type)) {
      app.addContentTypeParser(type, { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    }
  }

  app.get("/api/ocr/health", async () => ocrHealth(cfg));

  for (const route of ["detect", "ocr"] as const) {
    app.post(`/api/ocr/${route}`, async (req, reply) => {
      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body) || !body.length) {
        return reply.code(400).send({ error: "send the document as the raw request body (application/pdf)" });
      }
      const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      try {
        const r = await fetch(`${cfg.url}/${route}${qs}`, {
          method: "POST",
          headers: { "content-type": (req.headers["content-type"] as string) || "application/octet-stream" },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        const text = await r.text();
        reply.code(r.status).header("content-type", r.headers.get("content-type") || "application/json");
        return reply.send(text);
      } catch (e) {
        const msg = (e as Error).name === "TimeoutError"
          ? `OCR service timed out after ${Math.round(cfg.timeoutMs / 1000)} s`
          : `OCR service not reachable at ${cfg.url}: ${(e as Error).message}`;
        return reply.code(503).send({ ok: false, error: msg });
      }
    });
  }
}
