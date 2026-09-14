"""PaddleOCR — the primary engine.

Two backends, tried in order:

1. Native PaddleOCR 3.x. The pipeline version is PP-OCRv6 when the installed
   release supports it and the model store can supply it, stepping down to
   PP-OCRv5. Models come from the local store (`OCR_PADDLE_MODEL_DIR`, or the
   PaddleX cache after a first online run); the service never needs the
   network at request time. PP-StructureV3 is loaded alongside for table
   pages when `OCR_PADDLE_STRUCTURE=1` (default) and its models are present.
2. PP-OCRv5 through ONNX Runtime (the `onnxocr` package ships the det/rec/cls
   weights inside the wheel), for hosts that cannot reach a model hoster at
   all. Same model family, no download step.

Word boxes: the native pipeline returns them (`return_word_box=True`); the
ONNX backend returns text lines, which are split proportionally.
"""
from __future__ import annotations

import os
from typing import Optional

import numpy as np

from ..models import Word
from .base import Engine, poly_to_bbox, split_line_into_words

LANG_MAP = {
    # tesseract-style code -> PaddleOCR lang
    "eng": "en", "fra": "fr", "deu": "german", "ita": "it", "spa": "es", "por": "pt", "nld": "nl",
    "chi_sim": "ch", "chi_tra": "chinese_cht", "jpn": "japan", "kor": "korean", "rus": "ru",
}


def paddle_lang(langs: list[str]) -> str:
    codes = [LANG_MAP.get(l, l) for l in langs]
    latin = [c for c in codes if c not in ("en", "ch", "chinese_cht", "japan", "korean", "ru")]
    if len(codes) == 1:
        return codes[0]
    if latin:
        return "latin"          # one multilingual Latin model covers fr/de/it/es/pt/nl
    return codes[0] if codes else "en"


class PaddleEngine(Engine):
    name = "paddle"

    def __init__(self) -> None:
        super().__init__()
        self._native = None
        self._native_lang: Optional[str] = None
        self._structure = None
        self._onnx = None
        self.version = ""
        self.structure_available = False

    # ---------------------------------------------------------------- load
    def _load(self) -> None:
        if os.environ.get("OCR_DISABLE_PADDLE") == "1":
            raise RuntimeError("disabled by OCR_DISABLE_PADDLE=1")
        errors = []
        backend = os.environ.get("OCR_PADDLE_BACKEND", "auto")
        if backend == "native" or (backend == "auto" and _native_models_present()):
            try:
                self._load_native("en")
                return
            except Exception as e:  # noqa: BLE001
                errors.append(f"native: {type(e).__name__}: {str(e)[:200]}")
        elif backend == "auto":
            errors.append("native: no PP-OCR models in the local store (set OCR_PADDLE_MODEL_DIR, or run once online to fill ~/.paddlex)")
        if os.environ.get("OCR_PADDLE_BACKEND", "auto") in ("auto", "onnx"):
            try:
                self._load_onnx()
                return
            except Exception as e:  # noqa: BLE001
                errors.append(f"onnx: {type(e).__name__}: {str(e)[:200]}")
        raise RuntimeError(" | ".join(errors) or "no Paddle backend")

    def _native_kwargs(self, lang: str) -> dict:
        kw: dict = dict(
            lang=lang,
            use_doc_orientation_classify=os.environ.get("OCR_PADDLE_DOC_ORIENT", "1") == "1",
            use_doc_unwarping=os.environ.get("OCR_PADDLE_UNWARP", "0") == "1",
            use_textline_orientation=True,
            return_word_box=True,
            text_det_limit_side_len=int(os.environ.get("OCR_PADDLE_DET_SIDE", "1920")),
            text_det_limit_type="max",
        )
        mdir = os.environ.get("OCR_PADDLE_MODEL_DIR")
        if mdir:
            # <dir>/det, <dir>/rec, <dir>/cls, <dir>/doc_orient — whichever exist
            for key, sub in (("text_detection_model_dir", "det"), ("text_recognition_model_dir", "rec"),
                             ("textline_orientation_model_dir", "cls"), ("doc_orientation_classify_model_dir", "doc_orient")):
                p = os.path.join(mdir, sub)
                if os.path.isdir(p):
                    kw[key] = p
        return kw

    def _load_native(self, lang: str) -> None:
        # Never let a request wait on a connectivity probe to a model hoster.
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        from paddleocr import PaddleOCR  # noqa: PLC0415

        wanted = os.environ.get("OCR_PADDLE_VERSION", "PP-OCRv6")
        order = [wanted] + [v for v in ("PP-OCRv6", "PP-OCRv5") if v != wanted]
        last: Optional[Exception] = None
        for ver in order:
            try:
                self._native = PaddleOCR(ocr_version=ver, **self._native_kwargs(lang))
                self._native_lang = lang
                self.version = ver
                self.backend = f"PaddleOCR {_paddleocr_version()} native {ver} ({lang})"
                break
            except Exception as e:  # noqa: BLE001
                last = e
                self._native = None
        if self._native is None:
            raise RuntimeError(f"no native model available: {last}")
        if os.environ.get("OCR_PADDLE_STRUCTURE", "1") == "1":
            try:
                from paddleocr import PPStructureV3  # noqa: PLC0415
                self._structure = PPStructureV3(use_doc_orientation_classify=False, use_doc_unwarping=False,
                                                use_table_recognition=True, use_seal_recognition=False,
                                                use_formula_recognition=False, use_chart_recognition=False)
                self.structure_available = True
                self.backend += " + PP-StructureV3"
            except Exception:  # noqa: BLE001 — tables fall back to geometry
                self._structure = None

    def _load_onnx(self) -> None:
        from onnxocr.onnx_paddleocr import ONNXPaddleOcr  # noqa: PLC0415
        import logging  # noqa: PLC0415
        logging.getLogger("onnxocr").setLevel(logging.WARNING)
        try:
            from loguru import logger as _lg  # noqa: PLC0415
            _lg.disable("onnxocr")
        except Exception:  # noqa: BLE001
            pass
        self._onnx = ONNXPaddleOcr(use_angle_cls=True, use_gpu=False)
        self.version = "PP-OCRv5"
        self.backend = "PP-OCRv5 via ONNX Runtime (bundled weights, offline)"

    # ------------------------------------------------------------ recognise
    def recognize(self, img_gray: np.ndarray, img_color: np.ndarray, img_bin: np.ndarray, langs: list[str]) -> list[Word]:
        if self._native is not None:
            return self._recognize_native(img_color, langs)
        return self._recognize_onnx(img_color)

    def _recognize_native(self, img_color: np.ndarray, langs: list[str]) -> list[Word]:
        lang = paddle_lang(langs)
        if lang != self._native_lang:
            try:
                self._load_native(lang)
            except Exception:  # noqa: BLE001 — keep the loaded model rather than fail the page
                pass
        out: list[Word] = []
        for res in self._native.predict(img_color):
            texts = list(res.get("rec_texts", []) or [])
            scores = list(res.get("rec_scores", []) or [])
            boxes = res.get("rec_boxes", None)
            polys = res.get("rec_polys", None)
            words_per_line = res.get("text_word", None)
            wboxes_per_line = res.get("text_word_boxes", None)
            for i, text in enumerate(texts):
                conf = float(scores[i]) if i < len(scores) else 0.0
                if boxes is not None and len(boxes) > i:
                    bb = [float(v) for v in np.asarray(boxes[i]).reshape(-1)[:4]]
                elif polys is not None and len(polys) > i:
                    bb = poly_to_bbox(polys[i])
                else:
                    continue
                if words_per_line and wboxes_per_line and i < len(words_per_line) and words_per_line[i] \
                        and len(words_per_line[i]) == len(wboxes_per_line[i]):
                    for wtxt, wbox in zip(words_per_line[i], wboxes_per_line[i]):
                        t = str(wtxt).strip()
                        if t:
                            out.append(Word(t, [float(v) for v in np.asarray(wbox).reshape(-1)[:4]], conf, self.name))
                else:
                    out.extend(split_line_into_words(str(text), bb, conf, self.name))
        return out

    def _recognize_onnx(self, img_color: np.ndarray) -> list[Word]:
        result = self._onnx.ocr(img_color)
        out: list[Word] = []
        for page in result or []:
            for item in page or []:
                try:
                    poly, (text, conf) = item[0], item[1]
                except Exception:  # noqa: BLE001
                    continue
                out.extend(split_line_into_words(str(text), poly_to_bbox(poly), float(conf), self.name))
        return out

    # --------------------------------------------------------------- tables
    def tables(self, img_color: np.ndarray) -> list[dict]:
        """PP-StructureV3 table recognition, as rows of cell text. Empty when
        the structure pipeline is not loaded."""
        if self._structure is None:
            return []
        out: list[dict] = []
        try:
            for res in self._structure.predict(img_color):
                for t in (res.get("table_res_list", []) or []):
                    html = t.get("pred_html") or ""
                    rows = _html_table_rows(html)
                    if rows:
                        bb = t.get("table_region_bbox") or t.get("bbox") or [0, 0, 0, 0]
                        out.append({"engine": "pp-structurev3", "bbox": [float(v) for v in bb][:4], "rows": rows})
        except Exception:  # noqa: BLE001
            return []
        return out

    def orientation(self, img_gray: np.ndarray) -> Optional[int]:
        # The native pipeline applies its own document-orientation model
        # inside predict(); ONNX has none of its own that we call here.
        return None


def _native_models_present() -> bool:
    """True when the native pipeline can be built without a download: either
    an explicit model directory, or a PaddleX cache that already holds a
    PP-OCR detection model. Checked up front so an offline host does not sit
    through four hoster timeouts on every start."""
    mdir = os.environ.get("OCR_PADDLE_MODEL_DIR")
    if mdir and os.path.isdir(os.path.join(mdir, "det")) and os.path.isdir(os.path.join(mdir, "rec")):
        return True
    cache = os.environ.get("PADDLE_PDX_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".paddlex")
    official = os.path.join(cache, "official_models")
    try:
        names = os.listdir(official)
    except OSError:
        return False
    return any(n.startswith("PP-OCRv") and n.endswith("_det") for n in names)


def _html_table_rows(html: str) -> list[list[dict]]:
    import re  # noqa: PLC0415
    rows: list[list[dict]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S | re.I):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)
        cleaned = [{"text": re.sub(r"<[^>]+>", "", c).strip()} for c in cells]
        if any(c["text"] for c in cleaned):
            rows.append(cleaned)
    return rows


def _paddleocr_version() -> str:
    try:
        import paddleocr  # noqa: PLC0415
        return getattr(paddleocr, "__version__", "3.x")
    except Exception:  # noqa: BLE001
        return "3.x"
