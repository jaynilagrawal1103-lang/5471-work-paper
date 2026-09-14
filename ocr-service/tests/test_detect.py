import os

import fitz
import pytest

from ocr_service.detect import image_to_pdf, is_pdf, probe_pdf
from ocr_service.pipeline import parse_pages

FIX = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "ocr")


def load(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


@pytest.mark.parametrize("name,verdict,ocr_pages", [
    ("digital.pdf", "digital", []),
    ("scanned.pdf", "scanned", [1, 2]),
    ("mixed.pdf", "mixed", [2]),
    ("difficult.pdf", "scanned", [1, 2]),
    ("multipage.pdf", "scanned", [1, 2, 3, 4, 5, 6]),
    ("table.pdf", "scanned", [1]),
])
def test_probe_verdicts(name, verdict, ocr_pages):
    p = probe_pdf(load(name))
    assert p["verdict"] == verdict
    assert p["ocr_pages"] == ocr_pages
    assert p["page_count"] == len(p["pages"])


def test_mixed_reports_each_page():
    p = probe_pdf(load("mixed.pdf"))
    kinds = [x["kind"] for x in p["pages"]]
    assert kinds == ["digital", "scanned", "digital"]
    assert p["pages"][0]["chars"] > 100 and p["pages"][1]["chars"] == 0
    assert p["pages"][1]["image_coverage"] > 0.9


def test_stamped_scan_is_still_a_scan():
    """A full-page image with a few characters of real text over it (a
    stamp, a fax header) must not pass as digital."""
    doc = fitz.open(stream=load("scanned.pdf"), filetype="pdf")
    doc[0].insert_text((72, 30), "RECEIVED 06/11/25", fontsize=9)
    data = doc.tobytes()
    doc.close()
    p = probe_pdf(data)
    assert p["pages"][0]["kind"] == "scanned"


def test_image_upload_becomes_pdf():
    doc = fitz.open(stream=load("table.pdf"), filetype="pdf")
    png = doc[0].get_pixmap(matrix=fitz.Matrix(1, 1)).tobytes("png")
    doc.close()
    assert not is_pdf(png)
    pdf = image_to_pdf(png)
    assert is_pdf(pdf)
    assert probe_pdf(pdf)["verdict"] == "scanned"


def test_parse_pages():
    assert parse_pages(None, 5) is None
    assert parse_pages("auto", 5) is None
    assert parse_pages("all", 3) == [1, 2, 3]
    assert parse_pages("2,4-6", 10) == [2, 4, 5, 6]
    assert parse_pages("4-6", 5) == [4, 5]
    with pytest.raises(ValueError):
        parse_pages("x", 5)
