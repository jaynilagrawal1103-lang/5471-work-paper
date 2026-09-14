"""Does this PDF need OCR, and on which pages?

A page is digital when it carries a real text layer, scanned when it is an
image with no (or only decorative) text, blank when it is neither. The
document verdict follows from the pages: digital, scanned, mixed or blank.
The thresholds are deliberately conservative in the OCR direction — a page
with a stamped header of ten characters over a full-page scan is a scan.
"""
from __future__ import annotations

import fitz  # PyMuPDF

from .models import PageProbe

MIN_CHARS = 25          # fewer than this and the page has no usable text layer
MIN_WORDS = 6
IMAGE_HEAVY = 0.55      # image covering this much of the page dominates it


def _image_coverage(page: fitz.Page) -> float:
    area = max(1e-6, page.rect.width * page.rect.height)
    covered = 0.0
    try:
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                rr = r & page.rect
                if not rr.is_empty:
                    covered += rr.width * rr.height
    except Exception:
        return 0.0
    return min(1.0, covered / area)


def probe_page(page: fitz.Page, number: int) -> PageProbe:
    text = page.get_text("text") or ""
    chars = len("".join(text.split()))
    words = len(page.get_text("words") or [])
    cov = _image_coverage(page)
    if chars >= MIN_CHARS and words >= MIN_WORDS and not (cov >= IMAGE_HEAVY and words < 15):
        kind = "digital"
    elif cov > 0.05 or page.get_images():
        kind = "scanned"
    elif chars > 0:
        kind = "digital"           # a few real characters and no image: sparse but digital
    else:
        kind = "blank"
    return PageProbe(number, kind, chars, words, cov, page.rect.width, page.rect.height)


def probe_pdf(data: bytes) -> dict:
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        pages = [probe_page(doc[i], i + 1) for i in range(doc.page_count)]
    finally:
        doc.close()
    kinds = {p.kind for p in pages}
    if not pages:
        verdict = "blank"
    elif kinds <= {"digital", "blank"} and "digital" in kinds:
        verdict = "digital"
    elif kinds <= {"scanned", "blank"} and "scanned" in kinds:
        verdict = "scanned"
    elif "scanned" in kinds and "digital" in kinds:
        verdict = "mixed"
    else:
        verdict = "blank"
    return {
        "verdict": verdict,
        "page_count": len(pages),
        "ocr_pages": [p.page for p in pages if p.kind == "scanned"],
        "pages": [p.to_dict() for p in pages],
    }


def is_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


def image_to_pdf(data: bytes) -> bytes:
    """Wrap a PNG/JPEG in a one-page PDF so the rest of the pipeline sees a PDF."""
    img = fitz.open(stream=data)
    rect = img[0].rect
    pdf = fitz.open()
    page = pdf.new_page(width=rect.width, height=rect.height)
    page.insert_image(rect, stream=data)
    out = pdf.tobytes()
    pdf.close()
    img.close()
    return out
