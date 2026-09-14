"""Tesseract — the last, optional fallback, and the cheap second opinion on
numeric tokens when no neural secondary engine is present.

Needs the `tesseract` binary on PATH (apt: tesseract-ocr) and pytesseract.
Only languages whose traineddata is installed are requested; asking for a
missing one makes the whole call fail.
"""
from __future__ import annotations

import os
import shutil
from typing import Optional

import numpy as np

from ..models import Word
from .base import Engine


class TesseractEngine(Engine):
    name = "tesseract"

    def __init__(self) -> None:
        super().__init__()
        self._langs: set[str] = set()
        self._pt = None

    def _load(self) -> None:
        if os.environ.get("OCR_DISABLE_TESSERACT") == "1":
            raise RuntimeError("disabled by OCR_DISABLE_TESSERACT=1")
        import pytesseract  # noqa: PLC0415

        cmd = os.environ.get("OCR_TESSERACT_CMD") or shutil.which("tesseract")
        if not cmd:
            raise RuntimeError("tesseract binary not found on PATH")
        pytesseract.pytesseract.tesseract_cmd = cmd
        self._pt = pytesseract
        self._langs = set(pytesseract.get_languages(config=""))
        ver = str(pytesseract.get_tesseract_version())
        self.backend = f"Tesseract {ver} ({', '.join(sorted(l for l in self._langs if l != 'osd')) or 'no languages'})"

    def _lang_arg(self, langs: list[str]) -> str:
        want = [l for l in langs if l in self._langs] or (["eng"] if "eng" in self._langs else [])
        return "+".join(want) if want else ""

    def recognize(self, img_gray: np.ndarray, img_color: np.ndarray, img_bin: np.ndarray, langs: list[str]) -> list[Word]:
        pt = self._pt
        lang = self._lang_arg(langs)
        data = pt.image_to_data(img_bin, lang=lang or None, config="--psm 6", output_type=pt.Output.DICT)
        out: list[Word] = []
        for i, txt in enumerate(data["text"]):
            t = (txt or "").strip()
            if not t:
                continue
            try:
                conf = float(data["conf"][i])
            except (TypeError, ValueError):
                conf = -1.0
            if conf < 0:
                continue
            x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
            out.append(Word(t, [float(x), float(y), float(x + w), float(y + h)], conf / 100.0, self.name))
        return out

    def recognize_crop(self, img_bin: np.ndarray, bbox: list[float], langs: list[str]) -> Optional[tuple[str, float]]:
        """Read one token's crop as a single line — the second opinion used
        on numeric tokens when no other engine is available."""
        x0, y0, x1, y1 = [int(round(v)) for v in bbox]
        pad = max(2, int((y1 - y0) * 0.25))
        H, W = img_bin.shape[:2]
        crop = img_bin[max(0, y0 - pad):min(H, y1 + pad), max(0, x0 - pad):min(W, x1 + pad)]
        if crop.size == 0:
            return None
        pt = self._pt
        lang = self._lang_arg(langs)
        data = pt.image_to_data(crop, lang=lang or None, config="--psm 7", output_type=pt.Output.DICT)
        toks, confs = [], []
        for i, txt in enumerate(data["text"]):
            t = (txt or "").strip()
            if not t:
                continue
            try:
                c = float(data["conf"][i])
            except (TypeError, ValueError):
                continue
            if c >= 0:
                toks.append(t)
                confs.append(c)
        if not toks:
            return None
        return " ".join(toks), (sum(confs) / len(confs)) / 100.0

    def orientation(self, img_gray: np.ndarray) -> Optional[int]:
        if "osd" not in self._langs:
            return None
        try:
            osd = self._pt.image_to_osd(img_gray, output_type=self._pt.Output.DICT)
            rot = int(osd.get("rotate", 0)) % 360
            return rot if rot in (0, 90, 180, 270) else None
        except Exception:
            return None
