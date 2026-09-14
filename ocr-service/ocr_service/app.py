"""HTTP surface of the OCR service.

    GET  /health          engine availability, chain and versions
    POST /detect          multipart `file` -> per-page digital/scanned/blank
    POST /ocr             multipart `file` + form fields -> sidecar JSON with
                          the searchable PDF (base64) inside

Form fields for /ocr (all optional):
    pages    "auto" (default: the pages detection says need it), "all", or "2,4-6"
    langs    "eng" or "eng+fra" (tesseract-style codes)
    force    "1" to OCR the named pages even when they already carry text
    dpi      render resolution, default 300
    verify   "1" (default) to cross-check with a second engine
    structure "1" (default) to run table recognition where available
    pdf      "1" (default) to include the searchable PDF in the response
"""
from __future__ import annotations

import os
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__, engines, pipeline
from .detect import image_to_pdf, is_pdf, probe_pdf

MAX_MB = int(os.environ.get("OCR_MAX_UPLOAD_MB", "60"))

app = FastAPI(title="5471 Work Paper OCR service", version=__version__)
_origins = [o.strip() for o in os.environ.get("OCR_CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["*"], allow_credentials=False)


@app.on_event("startup")
def _warm() -> None:
    # Load the engines off the request path so the first /health already
    # tells the truth and the first /ocr does not pay for model loading.
    if os.environ.get("OCR_WARM", "1") == "1":
        threading.Thread(target=engines.warm, name="ocr-warm", daemon=True).start()


@app.get("/")
def root() -> dict:
    return {"service": "5471 Work Paper OCR", "version": __version__, "endpoints": ["/health", "/detect", "/ocr"]}


@app.get("/health")
def health() -> dict:
    d = engines.describe()
    return {"ok": d["primary"] is not None, "version": __version__, "primary": d["primary"], "chain": d["chain"],
            "engines": {n: d[n] for n in ("paddle", "surya", "tesseract")}}


async def _read(request: Request) -> tuple[bytes, dict[str, str]]:
    """The document and its options, from either shape of request:

    - multipart/form-data with a `file` part and option fields (curl, scripts)
    - a raw body (application/pdf or octet-stream) with options in the query
      string — what the browser sends, and what the app's own server proxies
      through unchanged.
    Query parameters win over form fields either way."""
    ctype = (request.headers.get("content-type") or "").lower()
    opts: dict[str, str] = {}
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        up = form.get("file")
        if up is None or not hasattr(up, "read"):
            raise HTTPException(400, "multipart field 'file' required")
        data = await up.read()
        for k, v in form.items():
            if k != "file" and isinstance(v, str):
                opts[k] = v
        if getattr(up, "filename", None):
            opts.setdefault("filename", up.filename)
    else:
        data = await request.body()
    for k, v in request.query_params.items():
        opts[k] = v
    if not data:
        raise HTTPException(400, "empty upload")
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, f"file exceeds {MAX_MB} MB")
    return data, opts


@app.post("/detect")
async def detect(request: Request) -> JSONResponse:
    data, _opts = await _read(request)
    if not is_pdf(data):
        try:
            data = image_to_pdf(data)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(415, f"not a PDF or a readable image: {e}") from e
    try:
        return JSONResponse(probe_pdf(data))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not open the PDF: {e}") from e


def _flag(v: str | None, default: bool) -> bool:
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


@app.post("/ocr")
async def ocr(request: Request) -> JSONResponse:
    data, o = await _read(request)
    if not engines.chain():
        d = engines.describe()
        raise HTTPException(503, {"error": "no OCR engine available", "engines": {n: d[n] for n in ("paddle", "surya", "tesseract")}})
    try:
        dpi = int(o.get("dpi") or pipeline.DEFAULT_DPI)
    except ValueError as e:
        raise HTTPException(400, "dpi must be an integer") from e
    try:
        out = pipeline.run(
            data, filename=o.get("filename") or "", pages=o.get("pages") or "auto",
            langs=[l for l in (o.get("langs") or "eng").replace(",", "+").split("+") if l],
            force=_flag(o.get("force"), False), dpi=max(72, min(600, dpi)),
            verify=_flag(o.get("verify"), True), structure=_flag(o.get("structure"), True), want_pdf=_flag(o.get("pdf"), True),
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"OCR failed: {type(e).__name__}: {e}") from e
    return JSONResponse(out)
