"""Write the recognised words back into the PDF as an invisible text layer.

The original bytes are the starting point, so a digital page keeps its own
text and images untouched; only the OCR'd pages gain a text layer, drawn
with render mode 3 (invisible) the way OCRmyPDF does it. Each word is
placed at its own box, sized to the box height and scaled to its width, so
a PDF text extractor returns the words at the positions the engine saw
them — including the gaps between columns that the work paper's parser keys
on.
"""
from __future__ import annotations

import fitz

from .models import PageResult

_FONT = "helv"


def _fit_fontsize(text: str, width: float, height: float) -> float:
    size = max(3.0, min(48.0, height * 0.85))
    if not text:
        return size
    w = fitz.get_text_length(text, fontname=_FONT, fontsize=size)
    if w > width > 0 and w > 0:
        size = max(2.5, size * width / w)
    return size


def add_text_layer(pdf_bytes: bytes, pages: list[PageResult]) -> bytes:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for pr in pages:
            if pr.status != "ocr" or not pr.words:
                continue
            rebuild = getattr(pr, "_rebuild", None)
            if rebuild is not None:
                # The page was turned or straightened: replace it with the
                # cleaned, upright image so the copy reads the way the words
                # were recognised (and the way a reviewer will look at it).
                import cv2  # noqa: PLC0415
                img, _dpi = rebuild
                ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
                if not ok:
                    continue
                doc.delete_page(pr.page - 1)
                page = doc.new_page(pno=pr.page - 1, width=pr.width, height=pr.height)
                page.insert_image(page.rect, stream=buf.tobytes())
            else:
                page = doc[pr.page - 1]
            for w in pr.words:
                x0, y0, x1, y1 = w.bbox
                width, height = max(0.5, x1 - x0), max(0.5, y1 - y0)
                size = _fit_fontsize(w.text, width, height)
                # baseline sits a little above the bottom of the box
                point = fitz.Point(x0, y1 - height * 0.2)
                try:
                    page.insert_text(point, w.text, fontsize=size, fontname=_FONT,
                                     render_mode=3, overlay=True)
                except Exception:  # noqa: BLE001 — a glyph the base font lacks; skip the word, keep the page
                    try:
                        page.insert_text(point, w.text.encode("latin-1", "replace").decode("latin-1"),
                                         fontsize=size, fontname=_FONT, render_mode=3, overlay=True)
                    except Exception:  # noqa: BLE001
                        pass
        return doc.tobytes(garbage=1, deflate=True)
    finally:
        doc.close()
