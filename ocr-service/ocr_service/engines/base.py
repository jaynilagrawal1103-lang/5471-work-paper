"""The contract every engine adapter meets.

An engine turns one cleaned page image into readings: text, a box in image
pixels, a confidence in 0..1. Engines that only return text LINES split them
into words here, so the searchable PDF can place each word at its own box and
the work paper's column logic (which keys on gaps between runs) still works.
Availability is probed lazily and cached: an engine whose models cannot be
loaded reports itself unavailable with the reason, and the chain moves on.
"""
from __future__ import annotations

import re
import threading
from abc import ABC, abstractmethod
from typing import Optional

import numpy as np

from ..models import Word


class EngineUnavailable(Exception):
    pass


class Engine(ABC):
    name: str = "engine"
    #: Human-readable description of the model actually loaded.
    backend: str = ""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ready: Optional[bool] = None
        self._reason: str = ""

    def available(self) -> bool:
        if self._ready is None:
            with self._lock:
                if self._ready is None:
                    try:
                        self._load()
                        self._ready = True
                    except Exception as e:  # noqa: BLE001 — any load failure means "not available"
                        self._ready = False
                        self._reason = f"{type(e).__name__}: {str(e)[:300]}"
        return bool(self._ready)

    @property
    def reason(self) -> str:
        return self._reason

    @abstractmethod
    def _load(self) -> None: ...

    @abstractmethod
    def recognize(self, img_gray: np.ndarray, img_color: np.ndarray, img_bin: np.ndarray, langs: list[str]) -> list[Word]:
        """Readings in image-pixel boxes for one cleaned page."""

    def orientation(self, img_gray: np.ndarray) -> Optional[int]:
        """0/90/180/270 the page must be turned clockwise, or None if the
        engine has no document-orientation model."""
        return None

    def describe(self) -> dict:
        ok = self.available()
        return {"name": self.name, "available": ok, "backend": self.backend if ok else "", "reason": "" if ok else self._reason}


def split_line_into_words(text: str, bbox: list[float], conf: float, engine: str) -> list[Word]:
    """Give each whitespace-separated token of a text line its own box by
    allotting the line's width in proportion to character counts (a space
    counts as half a character). Approximate, but it keeps columns apart —
    which is what the parser downstream needs — and each token carries the
    line's confidence."""
    tokens = [t for t in re.split(r"\s+", text.strip()) if t]
    if not tokens:
        return []
    x0, y0, x1, y1 = bbox
    if len(tokens) == 1:
        return [Word(tokens[0], [x0, y0, x1, y1], conf, engine)]
    units = sum(len(t) for t in tokens) + 0.5 * (len(tokens) - 1)
    per = (x1 - x0) / max(units, 1e-6)
    out: list[Word] = []
    cur = x0
    for i, t in enumerate(tokens):
        w = len(t) * per
        out.append(Word(t, [cur, y0, cur + w, y1], conf, engine))
        cur += w + 0.5 * per
    return out


def poly_to_bbox(poly) -> list[float]:
    pts = np.asarray(poly, dtype=float).reshape(-1, 2)
    return [float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max())]
