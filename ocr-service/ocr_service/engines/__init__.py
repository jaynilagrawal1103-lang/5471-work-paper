"""Engine registry and the fallback chain.

Order is fixed by policy: PaddleOCR first, Surya second, Tesseract last. The
chain can be narrowed with `OCR_ENGINES` (comma-separated names) — for a host
that must not run Tesseract, say — but never reordered: the primary is the
primary because it is the most accurate on printed financial documents, and
the others exist to catch what it gets wrong, not to replace it.
"""
from __future__ import annotations

import os
from typing import Optional

from .base import Engine
from .paddle import PaddleEngine
from .surya import SuryaEngine
from .tesseract import TesseractEngine

ORDER = ("paddle", "surya", "tesseract")
_instances: dict[str, Engine] = {}


def get(name: str) -> Engine:
    if name not in _instances:
        _instances[name] = {"paddle": PaddleEngine, "surya": SuryaEngine, "tesseract": TesseractEngine}[name]()
    return _instances[name]


def enabled_names() -> list[str]:
    want = os.environ.get("OCR_ENGINES", ",".join(ORDER))
    names = [n.strip() for n in want.split(",") if n.strip() in ORDER]
    return [n for n in ORDER if n in names] or list(ORDER)


def chain() -> list[Engine]:
    """Engines in policy order, available ones only."""
    return [get(n) for n in enabled_names() if get(n).available()]


def primary() -> Optional[Engine]:
    c = chain()
    return c[0] if c else None


def describe() -> dict:
    out = {n: get(n).describe() for n in ORDER}
    avail = [n for n in enabled_names() if get(n).available()]
    out["chain"] = avail
    out["primary"] = avail[0] if avail else None
    return out


def warm() -> None:
    for n in enabled_names():
        get(n).available()
