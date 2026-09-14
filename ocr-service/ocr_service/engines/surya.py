"""Surya — the secondary engine.

Consulted when the primary's page is weak (few words, low mean confidence)
or, when `verify` is on, to give a second reading of every page so numeric
tokens can be cross-checked. Optional: the package pulls PyTorch and its
checkpoints come from the Hugging Face hub on first use (set
`MODEL_CACHE_DIR`/`SURYA_MODEL_CHECKPOINT` for an offline copy). When it is
not installed or its models cannot load, the chain simply skips it.

Surya 0.22 returns page BLOCKS (paragraph-sized, with a polygon and a
confidence); blocks are split into lines and words proportionally.
"""
from __future__ import annotations

import os
import re
from typing import Optional

import numpy as np

from ..models import Word
from .base import Engine, poly_to_bbox, split_line_into_words


class SuryaEngine(Engine):
    name = "surya"

    def __init__(self) -> None:
        super().__init__()
        self._rec = None
        self._manager = None

    def _load(self) -> None:
        if os.environ.get("OCR_DISABLE_SURYA") == "1":
            raise RuntimeError("disabled by OCR_DISABLE_SURYA=1")
        # Never block a request on a model download: only a checkpoint that is
        # already on disk (or a local path) may be used.
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        from surya.inference import SuryaInferenceManager  # noqa: PLC0415
        from surya.recognition import RecognitionPredictor  # noqa: PLC0415

        self._manager = SuryaInferenceManager(lazy=False)
        self._rec = RecognitionPredictor(self._manager)
        # A dry run proves the weights are really present; a lazy backend can
        # construct fine and fail on first use.
        from PIL import Image  # noqa: PLC0415
        probe = Image.new("RGB", (64, 32), "white")
        self._rec([probe], full_page=True)
        ver = ""
        try:
            from importlib.metadata import version  # noqa: PLC0415
            ver = version("surya-ocr")
        except Exception:  # noqa: BLE001
            pass
        self.backend = f"Surya {ver}".strip()

    def recognize(self, img_gray: np.ndarray, img_color: np.ndarray, img_bin: np.ndarray, langs: list[str]) -> list[Word]:
        from PIL import Image  # noqa: PLC0415
        import cv2  # noqa: PLC0415
        pil = Image.fromarray(cv2.cvtColor(img_color, cv2.COLOR_BGR2RGB))
        pages = self._rec([pil], full_page=True)
        out: list[Word] = []
        if not pages:
            return out
        for block in getattr(pages[0], "blocks", []) or []:
            if getattr(block, "skipped", False) or getattr(block, "error", None):
                continue
            text = _block_text(block)
            if not text:
                continue
            poly = getattr(block, "polygon", None)
            if poly is None:
                continue
            bb = poly_to_bbox(poly)
            conf = float(getattr(block, "confidence", 0.0) or 0.0)
            lines = [l for l in text.split("\n") if l.strip()]
            if len(lines) <= 1:
                out.extend(split_line_into_words(text, bb, conf, self.name))
                continue
            lh = (bb[3] - bb[1]) / len(lines)
            for i, line in enumerate(lines):
                lb = [bb[0], bb[1] + i * lh, bb[2], bb[1] + (i + 1) * lh]
                out.extend(split_line_into_words(line, lb, conf, self.name))
        return out


def _block_text(block) -> str:
    label = getattr(block, "label", None)
    if isinstance(label, str) and label.strip() and not _looks_like_type_label(label):
        return label.strip()
    html: Optional[str] = getattr(block, "html", None)
    if html:
        t = re.sub(r"</(?:tr|p|div|br|li|h\d)>", "\n", html, flags=re.I)
        t = re.sub(r"<[^>]+>", " ", t)
        t = re.sub(r"[ \t]+", " ", t)
        return "\n".join(l.strip() for l in t.split("\n") if l.strip())
    raw = getattr(block, "raw_label", None)
    return raw.strip() if isinstance(raw, str) else ""


def _looks_like_type_label(s: str) -> bool:
    # In some Surya versions `label` is the block TYPE ("Text", "Table"), not its text.
    return s.strip().lower() in {"text", "table", "figure", "title", "section-header", "list-item",
                                 "page-header", "page-footer", "caption", "footnote", "formula", "picture"}
