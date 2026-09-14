"""The OCR pipeline: detect → render → clean → recognise → verify → validate →
searchable PDF.

One call handles one document. Pages that already carry text are left alone
(unless `force` names them); pages that do not are recognised with the
primary engine, checked by a second one where the chain has one, validated,
and written back as an invisible text layer. Everything the engines saw
travels out in the sidecar — page, box, engine, confidence, alternatives —
so the work paper can show a reviewer exactly where a figure came from.
"""
from __future__ import annotations

import base64
import re
import threading
import time
from typing import Optional

import fitz
import numpy as np

from . import engines
from .detect import image_to_pdf, is_pdf, probe_pdf
from .engines.base import Engine
from .engines.tesseract import TesseractEngine
from .models import Flag, Line, PageResult, Table, Word
from .preprocess import preprocess, render_page
from .searchable import add_text_layer
from .validate import compare_engines, dedupe_flags, looks_numeric, validate_words

# Paddle's predictor is not re-entrant; one page at a time through the engines.
_ENGINE_LOCK = threading.Lock()

PAGE_FAILED_CONF = 0.35     # below this mean confidence the page is treated as unread
PAGE_WEAK_CONF = 0.80       # below this the secondary engine is asked for a second reading
DEFAULT_DPI = 300


def parse_pages(spec: Optional[str], page_count: int) -> Optional[list[int]]:
    """'2,4-6' -> [2,4,5,6] (1-based, clipped). None/'auto'/'' -> None."""
    if not spec or spec.strip().lower() in ("auto", "detect"):
        return None
    if spec.strip().lower() == "all":
        return list(range(1, page_count + 1))
    out: set[int] = set()
    for part in re.split(r"[,\s]+", spec.strip()):
        if not part:
            continue
        m = re.match(r"^(\d+)(?:-(\d+))?$", part)
        if not m:
            raise ValueError(f"bad page spec '{part}'")
        a = int(m.group(1))
        b = int(m.group(2) or a)
        for p in range(min(a, b), max(a, b) + 1):
            if 1 <= p <= page_count:
                out.add(p)
    return sorted(out)


def _mean_conf(words: list[Word]) -> float:
    return float(np.mean([w.conf for w in words])) if words else 0.0


def _group_lines(words: list[Word]) -> list[Line]:
    if not words:
        return []
    order = sorted(range(len(words)), key=lambda i: ((words[i].bbox[1] + words[i].bbox[3]) / 2, words[i].bbox[0]))
    heights = sorted(max(1.0, w.bbox[3] - w.bbox[1]) for w in words)
    typical = heights[len(heights) // 2]
    lines: list[list[int]] = []
    centres: list[float] = []            # running mean y-centre per line
    for i in order:
        w = words[i]
        yc = (w.bbox[1] + w.bbox[3]) / 2
        h = max(1.0, w.bbox[3] - w.bbox[1])
        placed = False
        for k, ln in enumerate(lines):
            # tolerance from the taller of the word and a typical line, so a
            # tiny punctuation box does not open a line of its own
            if abs(yc - centres[k]) <= 0.45 * max(h, typical):
                ln.append(i)
                centres[k] = (centres[k] * (len(ln) - 1) + yc) / len(ln)
                placed = True
                break
        if not placed:
            lines.append([i])
            centres.append(yc)
    out: list[Line] = []
    for ln in lines:
        ln.sort(key=lambda i: words[i].bbox[0])
        xs0 = min(words[i].bbox[0] for i in ln)
        ys0 = min(words[i].bbox[1] for i in ln)
        xs1 = max(words[i].bbox[2] for i in ln)
        ys1 = max(words[i].bbox[3] for i in ln)
        out.append(Line(" ".join(words[i].text for i in ln), [xs0, ys0, xs1, ys1], ln))
    out.sort(key=lambda l: l.bbox[1])
    return out


def _geometric_table(words: list[Word], lines: list[Line]) -> list[Table]:
    """Rows of cells from word geometry: a cell boundary is a gap wider than
    ~1.2 em between neighbouring words on a line. Reported when at least
    three lines split into two or more cells, which is what a financial
    statement looks like."""
    rows: list[list[dict]] = []
    for ln in lines:
        cells: list[list[int]] = []
        cur: list[int] = []
        prev = None
        for i in ln.words:
            w = words[i]
            h = max(1.0, w.bbox[3] - w.bbox[1])
            if prev is not None and (w.bbox[0] - prev.bbox[2]) > max(8.0, 1.2 * h):
                cells.append(cur)
                cur = []
            cur.append(i)
            prev = w
        if cur:
            cells.append(cur)
        rows.append([{
            "text": " ".join(words[i].text for i in c),
            "bbox": [round(min(words[i].bbox[0] for i in c), 2), round(min(words[i].bbox[1] for i in c), 2),
                     round(max(words[i].bbox[2] for i in c), 2), round(max(words[i].bbox[3] for i in c), 2)],
            "conf": round(float(np.mean([words[i].conf for i in c])), 4),
        } for c in cells])
    if sum(1 for r in rows if len(r) >= 2) < 3:
        return []
    bb = [min(l.bbox[0] for l in lines), min(l.bbox[1] for l in lines), max(l.bbox[2] for l in lines), max(l.bbox[3] for l in lines)]
    return [Table("geometry", bb, rows)]


def _verify(page_no: int, used: Engine, words: list[Word], rendered, langs: list[str]) -> tuple[Optional[str], list[Flag]]:
    """Second reading from the next engine in the chain. A neural secondary
    reads the whole page; Tesseract, as the cheap last resort, reads only
    the crops of numeric tokens."""
    chain = engines.chain()
    others = [e for e in chain if e is not used]
    if not others:
        return None, []
    verifier = others[0]
    try:
        if isinstance(verifier, TesseractEngine):
            alt: list[Word] = []
            for w in words:
                if not looks_numeric(w.text):
                    continue
                r = verifier.recognize_crop(rendered.img_bin, w.bbox, langs)
                if r:
                    alt.append(Word(r[0], list(w.bbox), r[1], verifier.name))
        else:
            alt = verifier.recognize(rendered.img, rendered.img_color, rendered.img_bin, langs)
    except Exception:  # noqa: BLE001 — a verifier failure must not fail the page
        return None, []
    return verifier.name, compare_engines(page_no, words, alt, verifier.name)


def _recognize_page(doc: fitz.Document, index: int, langs: list[str], dpi: int, verify: bool, structure: bool,
                    had_text: bool) -> PageResult:
    page_no = index + 1
    t0 = time.time()
    timing: dict[str, int] = {}
    bgr, page = render_page(doc, index, dpi)
    timing["render"] = int((time.time() - t0) * 1000)
    pr = PageResult(page_no, "ocr", page.rect.width, page.rect.height)
    chain = engines.chain()
    if not chain:
        pr.status, pr.error = "failed", "no OCR engine available"
        return pr
    t1 = time.time()
    # Document orientation: Tesseract's OSD when the binary is present (it is
    # the one engine in the chain with a page-level orientation model that
    # runs without a download); otherwise the projection heuristic.
    classifier = None
    tess = engines.get("tesseract")
    if tess.available():
        classifier = tess.orientation
    rendered = preprocess(bgr, page_no, dpi, page.rect.width, page.rect.height, page.rotation,
                          page.derotation_matrix, orientation_classifier=classifier)
    pr.preprocess = rendered.steps
    timing["preprocess"] = int((time.time() - t1) * 1000)

    used: Optional[Engine] = None
    words: list[Word] = []
    attempts: list[str] = []
    with _ENGINE_LOCK:
        for eng in chain:
            t2 = time.time()
            try:
                got = eng.recognize(rendered.img, rendered.img_color, rendered.img_bin, langs)
            except Exception as e:  # noqa: BLE001
                attempts.append(f"{eng.name}: {type(e).__name__}: {str(e)[:120]}")
                continue
            timing[f"ocr_{eng.name}"] = int((time.time() - t2) * 1000)
            mc = _mean_conf(got)
            if got and mc >= PAGE_FAILED_CONF:
                used, words = eng, got
                break
            attempts.append(f"{eng.name}: {'no text' if not got else f'mean confidence {mc:.2f}'}")
            # keep the best of the weak readings in case every engine is weak
            if got and (not words or mc > _mean_conf(words)):
                used, words = eng, got
        if used is None or not words:
            pr.status, pr.error = "failed", "; ".join(attempts) or "no text recognised"
            pr.timing_ms = timing
            return pr
        pr.engine = used.name
        pr.conf_mean = _mean_conf(words)
        flags: list[Flag] = []
        if attempts and pr.conf_mean < PAGE_FAILED_CONF:
            flags.append(Flag(page_no, "page-failed", "block", "", [0, 0, pr.width, pr.height], pr.conf_mean, used.name,
                              f"Page {page_no} could not be read reliably ({'; '.join(attempts)}). Nothing on it should be trusted without checking the scan."))
        # second reading — always when the page is weak, and when asked for
        if verify or pr.conf_mean < PAGE_WEAK_CONF or attempts:
            t3 = time.time()
            vname, vflags = _verify(page_no, used, words, rendered, langs)
            pr.verify_engine = vname
            flags.extend(vflags)
            timing["verify"] = int((time.time() - t3) * 1000)
        tables_raw: list[dict] = []
        if structure and hasattr(used, "tables"):
            t4 = time.time()
            tables_raw = used.tables(rendered.img_color)  # type: ignore[attr-defined]
            timing["structure"] = int((time.time() - t4) * 1000)

    flags.extend(validate_words(page_no, words))
    # A page that had to be turned, or straightened by more than a hair, is
    # rebuilt UPRIGHT in the searchable copy: the cleaned image becomes the
    # page and the words sit on it in that frame. Writing the text back onto
    # the sideways original would put every line's words in a vertical run,
    # and a reader grouping by baseline would scramble them.
    turned = rendered.steps.get("orientation", 0) in (90, 180, 270)
    skewed = abs(float(rendered.steps.get("deskew_deg", 0.0) or 0.0)) >= 0.5
    if turned or skewed:
        s = 72.0 / dpi
        to_pts = lambda bb: [float(v) * s for v in bb]  # noqa: E731
        H, W = rendered.img_color.shape[:2]
        pr.width, pr.height = W * s, H * s
        pr.preprocess["rebuilt"] = True
        pr._rebuild = (rendered.img_color, dpi)          # consumed by searchable.add_text_layer
    else:
        to_pts = rendered.to_page_points
    for w in words:
        w.bbox = to_pts(w.bbox)
    for f in flags:
        if f.kind != "page-failed":
            f.bbox = to_pts(f.bbox)
    pr.words = words
    pr.lines = _group_lines(words)
    if tables_raw:
        pr.tables = [Table(t["engine"], to_pts(t["bbox"]) if any(t["bbox"]) else [0, 0, pr.width, pr.height], t["rows"])
                     for t in tables_raw]
    else:
        pr.tables = _geometric_table(words, pr.lines)
    if had_text:
        flags.append(Flag(page_no, "page-had-text", "info", "", [0, 0, pr.width, pr.height], pr.conf_mean or 0.0, used.name,
                          f"Page {page_no} already carried a text layer; it was OCR'd on request and the readings are kept for comparison, but no second text layer was written over the existing one."))
    pr.flags = dedupe_flags(flags)
    pr.timing_ms = timing
    return pr


def run(data: bytes, *, filename: str = "", pages: Optional[str] = None, langs: Optional[list[str]] = None,
        force: bool = False, dpi: int = DEFAULT_DPI, verify: bool = True, structure: bool = True,
        want_pdf: bool = True) -> dict:
    t0 = time.time()
    langs = [l for l in (langs or ["eng"]) if l]
    if not is_pdf(data):
        data = image_to_pdf(data)
        filename = re.sub(r"\.(png|jpe?g|tiff?|bmp|webp)$", ".pdf", filename, flags=re.I) or "image.pdf"
    probe = probe_pdf(data)
    page_count = probe["page_count"]
    kinds = {p["page"]: p["kind"] for p in probe["pages"]}
    wanted = parse_pages(pages, page_count)
    if wanted is None:
        targets = list(probe["ocr_pages"])
    elif force:
        targets = wanted
    else:
        targets = [p for p in wanted if kinds.get(p) != "digital"]
    results: list[PageResult] = []
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        for i in range(page_count):
            page_no = i + 1
            if page_no in targets:
                results.append(_recognize_page(doc, i, langs, dpi, verify, structure, had_text=kinds.get(page_no) == "digital"))
            else:
                pg = doc[i]
                results.append(PageResult(page_no, "digital" if kinds.get(page_no) == "digital" else "blank",
                                          pg.rect.width, pg.rect.height))
    finally:
        doc.close()
    # a page that already had text keeps it; the OCR readings stay in the sidecar only
    layer_pages = [r for r in results if r.status == "ocr" and kinds.get(r.page) != "digital"]
    pdf_out = add_text_layer(data, layer_pages) if want_pdf and layer_pages else data
    all_flags = [f for r in results for f in r.flags]
    ocr_pages = [r for r in results if r.status == "ocr"]
    used = sorted({r.engine for r in ocr_pages if r.engine})
    stats = {
        "pages": page_count,
        "ocr_pages": len(ocr_pages),
        "failed_pages": [r.page for r in results if r.status == "failed"],
        "words": sum(len(r.words) for r in results),
        "flags": len(all_flags),
        "flags_by_kind": _count(f.kind for f in all_flags),
        "conf_mean": round(float(np.mean([r.conf_mean for r in ocr_pages if r.conf_mean is not None])), 4) if ocr_pages else None,
        "elapsed_ms": int((time.time() - t0) * 1000),
    }
    eng = engines.describe()
    return {
        "doc": {
            "name": filename, "verdict": probe["verdict"], "page_count": page_count,
            "ocr_pages": [r.page for r in ocr_pages], "engines_used": used,
            "engine_chain": eng["chain"], "primary": eng["primary"],
            "backends": {n: eng[n]["backend"] for n in ("paddle", "surya", "tesseract") if eng[n]["available"]},
            "langs": langs, "dpi": dpi, "verify": verify, "force": force,
        },
        "detect": probe,
        "pages": [r.to_dict() for r in results],
        "flags": [f.to_dict() for f in all_flags],
        "stats": stats,
        "pdf_b64": base64.b64encode(pdf_out).decode("ascii") if want_pdf else None,
    }


def _count(items) -> dict[str, int]:
    out: dict[str, int] = {}
    for k in items:
        out[k] = out.get(k, 0) + 1
    return out
