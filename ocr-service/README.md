# OCR service for the 5471 Work Paper

A small Python service that reads scanned pages for the app. **PaddleOCR 3.x
is the primary engine**, **Surya** the second reading, **Tesseract** the last
fallback. The app finds it on its own: through the app's own server first
(`/api/ocr/*`), then directly at `http://127.0.0.1:8472` — so a page opened
from disk or from a static host still uses a service started on the same
computer (the service answers cross-origin; `OCR_CORS_ORIGINS` narrows it).
A service elsewhere is entered in the **Service address** box of the OCR
card (kept in the browser's localStorage as `en9OcrUrl`). Without any
service the app still runs PP-OCRv5 — the same `onnxocr` weights, through
ONNX Runtime Web inside the browser (no second reading, no table model), and
the offline build (`npm run build:standalone`) packs those weights into the
page so no download is needed either; the service is the faster,
cross-checked path.

```
Upload → auto-detect (per page) → OCR → Process entity → mapping → work paper
```

Every reading keeps its page, box, engine and confidence. Nothing the
engines disagree on is resolved silently: the primary reading is kept and
the alternative is flagged for the preparer.

## Run

```bash
cd ocr-service
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m ocr_service              # http://127.0.0.1:8472
```

Then open the app — from disk, a static host, or the app server
(`npm run start:local`, or the Fastify server; both proxy `/api/ocr/*` to
`OCR_SERVICE_URL`, default `http://127.0.0.1:8472`). The OCR card on the
Documents tab reports "OCR service online at …" once it has found the
service; `GET http://127.0.0.1:8472/health` names the engines that loaded.

Tesseract needs its binary: `apt install tesseract-ocr` (plus
`tesseract-ocr-<lang>` for other languages). Surya is optional and heavy
(PyTorch): `pip install surya-ocr`.

## Engines and models

| Engine | Role | Models |
|---|---|---|
| PaddleOCR 3.x (native) | primary | PP-OCRv6 when the installed release and the model store provide it, else PP-OCRv5; PP-StructureV3 for table pages |
| PP-OCRv5 via ONNX Runtime | primary, offline | weights ship inside the `onnxocr` wheel — no download step |
| Surya | second reading | Hugging Face checkpoints (first use online, or `MODEL_CACHE_DIR`) |
| Tesseract | last fallback; cheap second opinion on figures when Surya is absent | installed traineddata |

The native PaddleOCR pipeline downloads its models from a model hoster on
first use. On a host without that access the service **does not wait on
hoster timeouts**: it uses the native pipeline only when the models are
already in the local store (`~/.paddlex/official_models`, or
`OCR_PADDLE_MODEL_DIR` with `det/`, `rec/`, `cls/` subfolders), and
otherwise runs PP-OCRv5 through ONNX Runtime. Fill the store once on a
machine with access (run the service there and OCR any PDF), then copy
`~/.paddlex` across.

## Endpoints

- `GET /health` — engines, chain, primary, model backends.
- `POST /detect` — per-page `digital | scanned | blank` and a document verdict.
- `POST /ocr` — the sidecar (pages → words, lines, tables, flags) plus the
  searchable PDF (base64, `pdf_b64`). Digital pages are left untouched; only
  pages without a text layer gain an invisible one.

Both accept either `multipart/form-data` with a `file` part, or the document
as a raw body (`application/pdf`) with options in the query string. Options:
`pages` (`auto` | `all` | `2,4-6`), `langs` (`eng+fra`), `force` (OCR pages
that already have text — readings kept for comparison, text layer not
replaced), `dpi` (default 300), `verify` (second engine, default on),
`structure` (table recognition, default on), `pdf` (include the PDF).

```bash
curl -s -X POST -H 'content-type: application/pdf' --data-binary @scan.pdf \
  'http://127.0.0.1:8472/ocr?pages=auto&langs=eng' | jq '.stats, .flags[0]'
```

## What the pipeline does per page

1. Render at 300 dpi (PyMuPDF).
2. Orientation (Tesseract OSD or a projection heuristic), deskew up to ±8°,
   denoise when the page is grainy, contrast equalisation (CLAHE).
3. Recognise with the primary engine; if the page comes back empty or weak,
   try the next engine.
4. Second reading: Surya on the whole page, or Tesseract on the crops of
   numeric tokens. Compare by box overlap; report disagreements with both
   readings.
5. Validate every figure-like token: amount/date/percentage/currency
   grammar, separators, negatives, letter-for-digit swaps (`1,OOO.5O`),
   confidence floor 90 % on figures.
6. Table structure from PP-StructureV3 when loaded, else from word geometry.
7. Write the words back as an invisible text layer at their boxes.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `OCR_HOST` / `OCR_PORT` | `127.0.0.1` / `8472` | bind address |
| `OCR_ENGINES` | `paddle,surya,tesseract` | narrow the chain (never reordered) |
| `OCR_PADDLE_VERSION` | `PP-OCRv6` | steps down to PP-OCRv5 automatically |
| `OCR_PADDLE_BACKEND` | `auto` | `native` \| `onnx` |
| `OCR_PADDLE_MODEL_DIR` | — | local model store for offline hosts |
| `OCR_PADDLE_STRUCTURE` | `1` | load PP-StructureV3 with the native pipeline |
| `OCR_TESSERACT_CMD` | from PATH | tesseract binary |
| `OCR_MAX_UPLOAD_MB` | `60` | upload cap |
| `OCR_CORS_ORIGINS` | `*` | only matters when the browser calls the service directly |
| `OCR_DISABLE_PADDLE` / `_SURYA` / `_TESSERACT` | — | `1` to skip an engine |

## Tests

```bash
python -m pytest -q tests            # unit + real-engine pipeline tests
python tests/make_fixtures.py        # regenerate tests/fixtures/ocr/*.pdf
```

The pipeline tests run through whichever engines load on the host; they are
skipped when none does.
