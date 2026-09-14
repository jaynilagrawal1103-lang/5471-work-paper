"""Build the OCR test documents. Deterministic, dependency-light (PyMuPDF +
OpenCV), so the same files can be regenerated anywhere:

    digital.pdf     2 pages of real text: a balance sheet and a P&L table
    scanned.pdf     the same two pages rendered to images, no text layer
    mixed.pdf       page 1 digital, page 2 scanned, page 3 digital
    difficult.pdf   scanned pages: one skewed 2.5° with grain and low
                    contrast, one turned 90°
    multipage.pdf   six scanned pages
    table.pdf       one scanned page with a dense financial table

Run:  python tests/make_fixtures.py [out_dir]
"""
from __future__ import annotations

import os
import sys

import cv2
import fitz
import numpy as np

ENTITY = "Harbour Lights Trading Ltd."
BS = [
    ("BALANCE SHEET — 12/31/2024", None),
    ("Assets", None),
    ("Cash and cash equivalents", "30,257.06"),
    ("Trade notes and accounts receivable", "21,250.66"),
    ("Inventories", "1,500.23"),
    ("Prepaid expenses", "24,292.34"),
    ("Total assets", "77,300.29"),
    ("Liabilities and equity", None),
    ("Accounts payable", "61,139.37"),
    ("Deferred revenue", "6,074.99"),
    ("Retained earnings", "10,085.93"),
    ("Total liabilities and equity", "77,300.29"),
]
PL = [
    ("PROFIT AND LOSS — January 1 to December 31, 2024", None),
    ("Income", None),
    ("Sales", "154,523.24"),
    ("Sales returns", "(305.92)"),
    ("Other income", "12,875.74"),
    ("Total income", "167,093.06"),
    ("Expenses", None),
    ("Wages expense", "72,067.40"),
    ("Office expenses", "35,305.17"),
    ("Insurance", "9,779.29"),
    ("Bank charges", "665.65"),
    ("Total expenses", "117,817.51"),
    ("NET INCOME", "49,275.55"),
]


def _text_page(doc: fitz.Document, rows: list[tuple[str, str | None]]) -> fitz.Page:
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 60), ENTITY, fontsize=14, fontname="hebo")
    y = 100
    for label, amount in rows:
        bold = amount is None or label.isupper() or label.startswith("Total") or label.startswith("NET")
        page.insert_text((72, y), label, fontsize=11, fontname="hebo" if bold else "helv")
        if amount is not None:
            w = fitz.get_text_length(amount, fontname="helv", fontsize=11)
            page.insert_text((540 - w, y), amount, fontsize=11, fontname="helv")
        y += 22
    page.insert_text((72, 760), "Accrual Basis  Wednesday, June 11, 2025 09:58 PM GMTZ", fontsize=8, fontname="helv")
    return page


def digital() -> fitz.Document:
    d = fitz.open()
    _text_page(d, BS)
    _text_page(d, PL)
    return d


def _page_image(src: fitz.Document, index: int, dpi: int = 200) -> np.ndarray:
    pix = src[index].get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csRGB, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()


def _image_page(dst: fitz.Document, img: np.ndarray, width: float = 612, height: float = 792, jpeg: bool = False) -> None:
    # grainy pages are stored as JPEG: as PNG a noisy scan is several MB
    ok, buf = (cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 72]) if jpeg
               else cv2.imencode(".png", cv2.cvtColor(img, cv2.COLOR_RGB2BGR)))
    assert ok
    page = dst.new_page(width=width, height=height)
    page.insert_image(page.rect, stream=buf.tobytes())


def scanned(src: fitz.Document) -> fitz.Document:
    d = fitz.open()
    for i in range(src.page_count):
        _image_page(d, _page_image(src, i))
    return d


def mixed(src: fitz.Document) -> fitz.Document:
    d = fitz.open()
    d.insert_pdf(src, from_page=0, to_page=0)
    _image_page(d, _page_image(src, 1))
    d.insert_pdf(src, from_page=0, to_page=0)
    return d


def _degrade(img: np.ndarray, angle: float, noise: float, contrast: float, seed: int = 7) -> np.ndarray:
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    out = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    rng = np.random.default_rng(seed)
    out = out.astype(np.float32)
    out = 255 - (255 - out) * contrast          # fade the ink
    out += rng.normal(0, noise, out.shape)       # grain
    out = np.clip(out, 0, 255).astype(np.uint8)
    # a few dark specks
    for _ in range(int(h * w * 0.0006)):
        y, x = rng.integers(0, h), rng.integers(0, w)
        out[y:y + 2, x:x + 2] = rng.integers(0, 80)
    return out


def difficult(src: fitz.Document) -> fitz.Document:
    d = fitz.open()
    _image_page(d, _degrade(_page_image(src, 0), angle=2.5, noise=18, contrast=0.62), jpeg=True)
    turned = cv2.rotate(_page_image(src, 1), cv2.ROTATE_90_CLOCKWISE)
    _image_page(d, turned, width=792, height=612)
    return d


def multipage(src: fitz.Document) -> fitz.Document:
    d = fitz.open()
    for i in range(6):
        _image_page(d, _page_image(src, i % 2))
    return d


def table() -> fitz.Document:
    d = fitz.open()
    page = d.new_page(width=612, height=792)
    page.insert_text((72, 60), ENTITY + " — TRIAL BALANCE 12/31/2024", fontsize=13, fontname="hebo")
    cols = [72, 300, 400, 500]
    heads = ["Account", "Debit", "Credit", "Balance"]
    for x, hd in zip(cols, heads):
        page.insert_text((x, 100), hd, fontsize=10, fontname="hebo")
    rows = [
        ("1000 Cash", "30,257.06", "", "30,257.06"), ("1100 Receivables", "21,250.66", "", "21,250.66"),
        ("1200 Inventory", "1,500.23", "", "1,500.23"), ("2000 Payables", "", "61,139.37", "(61,139.37)"),
        ("3000 Retained earnings", "", "10,085.93", "(10,085.93)"), ("4000 Sales", "", "154,523.24", "(154,523.24)"),
        ("4010 Sales returns", "305.92", "", "305.92"), ("5000 Wages", "72,067.40", "", "72,067.40"),
        ("5100 Office", "35,305.17", "", "35,305.17"), ("5200 Insurance", "9,779.29", "", "9,779.29"),
        ("5300 Bank charges", "665.65", "", "665.65"), ("TOTAL", "171,131.38", "225,748.54", "(54,617.16)"),
    ]
    y = 124
    for r in rows:
        for x, cell in zip(cols, r):
            if cell:
                page.insert_text((x, y), cell, fontsize=10, fontname="hebo" if r[0] == "TOTAL" else "helv")
        y += 20
    s = fitz.open()
    _image_page(s, _page_image(d, 0, dpi=220))
    d.close()
    return s


def main(out: str) -> None:
    os.makedirs(out, exist_ok=True)
    dig = digital()
    files = {
        "digital.pdf": dig, "scanned.pdf": scanned(dig), "mixed.pdf": mixed(dig),
        "difficult.pdf": difficult(dig), "multipage.pdf": multipage(dig), "table.pdf": table(),
    }
    for name, doc in files.items():
        doc.save(os.path.join(out, name), garbage=3, deflate=True)
        doc.close()
        print("wrote", os.path.join(out, name))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "ocr"))
