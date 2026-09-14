"""End-to-end through the real engines that are loadable on this host.

Skipped entirely when no engine can load. With the bundled PP-OCRv5 ONNX
weights and a Tesseract binary present these run for real; with the native
PaddleOCR models in the local store they run through PP-OCRv6/PP-OCRv5.
"""
import base64
import os
import re

import fitz
import pytest

from ocr_service import engines, pipeline
from ocr_service.validate import normalise_number

FIX = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "ocr")
EXPECT_BS = ["30,257.06", "21,250.66", "1,500.23", "24,292.34", "77,300.29", "61,139.37", "6,074.99", "10,085.93"]
EXPECT_PL = ["154,523.24", "(305.92)", "12,875.74", "167,093.06", "72,067.40", "35,305.17", "9,779.29", "665.65", "117,817.51", "49,275.55"]

pytestmark = pytest.mark.skipif(not engines.chain(), reason="no OCR engine available on this host")


def load(name):
    with open(os.path.join(FIX, name), "rb") as f:
        return f.read()


def amounts_in(page_dict):
    vals = set()
    for w in page_dict["words"]:
        n = normalise_number(w["text"])
        if n is not None and abs(n) >= 100:
            vals.add(round(n, 2))
    return vals


def expect_values(strings):
    return {round(normalise_number(s), 2) for s in strings}


def text_layer(pdf_b64, page):
    doc = fitz.open(stream=base64.b64decode(pdf_b64), filetype="pdf")
    try:
        return doc[page - 1].get_text("words")
    finally:
        doc.close()


def test_scanned_pages_are_read_and_get_a_text_layer():
    out = pipeline.run(load("scanned.pdf"), filename="scanned.pdf")
    assert out["doc"]["verdict"] == "scanned"
    assert out["doc"]["ocr_pages"] == [1, 2]
    assert out["stats"]["failed_pages"] == []
    p1, p2 = out["pages"]
    assert p1["engine"] == out["doc"]["primary"]
    assert p1["conf_mean"] > 0.9
    # every balance-sheet and P&L figure was read exactly
    missing_bs = expect_values(EXPECT_BS) - amounts_in(p1)
    missing_pl = expect_values(EXPECT_PL) - amounts_in(p2)
    assert not missing_bs, f"balance sheet figures not read: {missing_bs}"
    assert not missing_pl, f"P&L figures not read: {missing_pl}"
    # the searchable PDF carries the words at their positions
    words = text_layer(out["pdf_b64"], 1)
    texts = [w[4] for w in words]
    assert "30,257.06" in texts and "Cash" in texts
    # the amount sits in the right-hand column, the caption on the left
    cash = next(w for w in words if w[4] == "Cash")
    amt = next(w for w in words if w[4] == "30,257.06")
    assert amt[0] > cash[2] + 200
    # provenance survives: engine, confidence, box in page points
    wd = next(w for w in p1["words"] if w["text"] == "30,257.06")
    assert wd["engine"] and 0 < wd["conf"] <= 1 and 0 <= wd["bbox"][0] < 612 and wd["bbox"][2] <= 612


def test_mixed_pdf_ocrs_only_the_scanned_page_and_keeps_digital_text_intact():
    src = load("mixed.pdf")
    out = pipeline.run(src, filename="mixed.pdf")
    assert out["doc"]["verdict"] == "mixed"
    assert out["doc"]["ocr_pages"] == [2]
    assert [p["status"] for p in out["pages"]] == ["digital", "ocr", "digital"]
    before = fitz.open(stream=src, filetype="pdf")
    after = fitz.open(stream=base64.b64decode(out["pdf_b64"]), filetype="pdf")
    try:
        assert after.page_count == 3
        assert before[0].get_text("text") == after[0].get_text("text")
        assert before[2].get_text("text") == after[2].get_text("text")
        assert before[1].get_text("text").strip() == ""
        assert "154,523.24" in after[1].get_text("text")
    finally:
        before.close()
        after.close()


def test_digital_pdf_is_left_alone_unless_forced():
    src = load("digital.pdf")
    out = pipeline.run(src, filename="digital.pdf")
    assert out["doc"]["ocr_pages"] == []
    assert base64.b64decode(out["pdf_b64"]) == src
    forced = pipeline.run(src, filename="digital.pdf", pages="1", force=True)
    assert forced["doc"]["ocr_pages"] == [1]
    # readings are kept for comparison, but no second text layer is written
    assert base64.b64decode(forced["pdf_b64"]) == src
    assert any(f["kind"] == "page-had-text" for f in forced["flags"])


def test_page_selection():
    out = pipeline.run(load("multipage.pdf"), filename="multipage.pdf", pages="2,5-6")
    assert out["doc"]["ocr_pages"] == [2, 5, 6]
    assert [p["status"] for p in out["pages"]] == ["blank", "ocr", "blank", "blank", "ocr", "ocr"]


def test_difficult_scan_is_deskewed_and_turned():
    out = pipeline.run(load("difficult.pdf"), filename="difficult.pdf")
    p1, p2 = out["pages"]
    assert p1["preprocess"]["orientation"] == 0, p1["preprocess"]
    assert abs(p1["preprocess"]["deskew_deg"]) >= 1.5, p1["preprocess"]
    assert "noise" in p1["preprocess"]
    assert p2["preprocess"]["orientation"] in (90, 270), p2["preprocess"]
    got1 = amounts_in(p1)
    got2 = amounts_in(p2)
    # a noisy, faded, skewed scan: most figures still come through exactly
    assert len(expect_values(EXPECT_BS) & got1) >= 6, got1
    assert len(expect_values(EXPECT_PL) & got2) >= 8, got2
    # both pages were rebuilt upright in the copy: the turned page is portrait
    # again, and a caption and its amount share a baseline on each page
    assert p1["preprocess"].get("rebuilt") and p2["preprocess"].get("rebuilt")
    doc = fitz.open(stream=base64.b64decode(out["pdf_b64"]), filetype="pdf")
    try:
        assert doc[1].rect.width < doc[1].rect.height, "the turned page must come back portrait"
        for pno, cap, amt in ((0, "Cash", "30,257.06"), (1, "Sales", "154,523.24")):
            words = doc[pno].get_text("words")
            c = next(w for w in words if w[4] == cap)
            a = next(w for w in words if w[4] == amt)
            assert abs(c[3] - a[3]) < 3.0, f"page {pno + 1}: '{cap}' and '{amt}' are not on one baseline ({c[3]:.1f} vs {a[3]:.1f})"
            assert a[0] > c[2] + 150, "the amount sits in the right-hand column"
    finally:
        doc.close()


def test_table_page_yields_rows_of_cells():
    out = pipeline.run(load("table.pdf"), filename="table.pdf")
    p = out["pages"][0]
    assert p["tables"], "no table structure recovered"
    rows = p["tables"][0]["rows"]
    multi = [r for r in rows if len(r) >= 3]
    assert len(multi) >= 8
    texts = [" ".join(c["text"] for c in r) for r in rows]
    assert any(re.search(r"1000 Cash.*30,257\.06", t) for t in texts), texts[:5]


def test_engine_disagreement_and_grammar_are_flagged_not_corrected():
    """A page engineered so the primary misreads a separator: the flag names
    both readings and the primary's text is what the words carry."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=300)
    page.insert_text((60, 80), "Total assets", fontsize=13)
    # a grouping separator drawn as a period trips a strict grammar reader
    page.insert_text((360, 80), "$72.882.56", fontsize=13)
    page.insert_text((60, 140), "Balance", fontsize=13)
    page.insert_text((360, 140), "1,OOO.5O", fontsize=13)
    pix = page.get_pixmap(matrix=fitz.Matrix(3, 3))
    img = fitz.open()
    ip = img.new_page(width=612, height=300)
    ip.insert_image(ip.rect, stream=pix.tobytes("png"))
    data = img.tobytes()
    out = pipeline.run(data, filename="odd.pdf")
    kinds = {f["kind"] for f in out["flags"]}
    assert kinds & {"numeric-grammar", "engines-disagree", "suspicious-glyph"}, out["flags"]
    for f in out["flags"]:
        if f["alt"]:
            # the original reading is kept on the word; the alternative lives on the flag only
            assert any(w["text"] == f["text"] for w in out["pages"][0]["words"])
