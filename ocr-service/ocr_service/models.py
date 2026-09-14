"""Plain data carried between the pipeline stages and out through the API."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

# Bounding boxes are [x0, y0, x1, y1]. Inside an engine they are image pixels;
# once a page result leaves the pipeline they are PDF points in the page's
# own (unrotated) coordinate space, so a reviewer can find the reading again.
BBox = list[float]


@dataclass
class Word:
    text: str
    bbox: BBox
    conf: float                     # 0..1, as the engine reported it
    engine: str                     # engine that produced this reading

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "bbox": [round(v, 2) for v in self.bbox],
                "conf": round(float(self.conf), 4), "engine": self.engine}


@dataclass
class Flag:
    """Something a reviewer must look at. The original reading is never
    replaced: `text` is what the primary engine read, `alt` is what another
    engine or the validator proposes, and the preparer decides."""
    page: int
    kind: str                       # low-confidence | engines-disagree | numeric-grammar | suspicious-glyph | date-grammar | page-failed
    level: str                      # block | warn | info
    text: str
    bbox: BBox
    conf: float
    engine: str
    message: str
    alt: Optional[str] = None
    alt_engine: Optional[str] = None
    alt_conf: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["bbox"] = [round(v, 2) for v in self.bbox]
        d["conf"] = round(float(self.conf), 4)
        if self.alt_conf is not None:
            d["alt_conf"] = round(float(self.alt_conf), 4)
        return d


@dataclass
class Line:
    text: str
    bbox: BBox
    words: list[int]                # indexes into PageResult.words

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "bbox": [round(v, 2) for v in self.bbox], "words": self.words}


@dataclass
class Table:
    """Rows of cells. Either PP-StructureV3's table recognition or the
    geometric fallback (row/column clustering of word boxes)."""
    engine: str
    bbox: BBox
    rows: list[list[dict[str, Any]]]

    def to_dict(self) -> dict[str, Any]:
        return {"engine": self.engine, "bbox": [round(v, 2) for v in self.bbox], "rows": self.rows}


@dataclass
class PageResult:
    page: int                       # 1-based
    status: str                     # digital | ocr | blank | failed
    width: float                    # page size in PDF points
    height: float
    engine: Optional[str] = None
    verify_engine: Optional[str] = None
    conf_mean: Optional[float] = None
    words: list[Word] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    flags: list[Flag] = field(default_factory=list)
    preprocess: dict[str, Any] = field(default_factory=dict)
    timing_ms: dict[str, int] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "page": self.page, "status": self.status,
            "width": round(self.width, 2), "height": round(self.height, 2),
            "engine": self.engine, "verify_engine": self.verify_engine,
            "conf_mean": None if self.conf_mean is None else round(self.conf_mean, 4),
            "words": [w.to_dict() for w in self.words],
            "lines": [l.to_dict() for l in self.lines],
            "tables": [t.to_dict() for t in self.tables],
            "flags": [f.to_dict() for f in self.flags],
            "preprocess": self.preprocess,
            "timing_ms": self.timing_ms,
            "error": self.error,
        }


@dataclass
class PageProbe:
    page: int
    kind: str                       # digital | scanned | blank
    chars: int
    words: int
    image_coverage: float           # 0..1 of the page area covered by images
    width: float
    height: float

    def to_dict(self) -> dict[str, Any]:
        return {"page": self.page, "kind": self.kind, "chars": self.chars, "words": self.words,
                "image_coverage": round(self.image_coverage, 3),
                "width": round(self.width, 2), "height": round(self.height, 2)}
