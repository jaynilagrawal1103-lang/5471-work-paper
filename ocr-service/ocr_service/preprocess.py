"""Page rendering and image clean-up before recognition.

Rendered at 300 dpi by default (configurable). Then, in order: grayscale,
orientation (0/90/180/270, decided by the engine's orientation classifier
where one exists, else by trying the rotations and keeping the one with the
most text-like structure), deskew (small angles, from the minimum-area
rectangle round the ink), denoise when the page is noisy, and contrast
equalisation (CLAHE). A separately binarised copy is kept for Tesseract,
which prefers it; the neural engines get the cleaned grayscale.

Every geometric step records its inverse so a box found on the cleaned image
can be mapped back to the original page.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import cv2
import fitz
import numpy as np


@dataclass
class Rendered:
    page_no: int
    dpi: int
    width_pt: float
    height_pt: float
    rotation: int                    # the PDF page's own /Rotate
    img: np.ndarray                  # cleaned grayscale, engines read this
    img_bin: np.ndarray              # binarised copy for Tesseract
    img_color: np.ndarray            # cleaned BGR (for engines that want colour)
    steps: dict = field(default_factory=dict)
    # affine (3x3) mapping cleaned-image pixel -> rendered-image pixel
    inverse: np.ndarray = field(default_factory=lambda: np.eye(3))

    def to_page_points(self, bbox: list[float]) -> list[float]:
        """Cleaned-image box -> PDF points in the page's unrotated space."""
        x0, y0, x1, y1 = bbox
        pts = np.array([[x0, y0, 1], [x1, y0, 1], [x1, y1, 1], [x0, y1, 1]], dtype=float).T
        back = self.inverse @ pts
        xs, ys = back[0], back[1]
        s = 72.0 / self.dpi
        rect = fitz.Rect(float(xs.min()) * s, float(ys.min()) * s, float(xs.max()) * s, float(ys.max()) * s)
        if self.rotation:
            # The pixmap was rendered with the page's rotation applied; undo it
            # so the text layer lands where the unrotated page content is.
            rect = rect * self._derotation
        return [rect.x0, rect.y0, rect.x1, rect.y1]

    _derotation: Optional[fitz.Matrix] = None


def render_page(doc: fitz.Document, index: int, dpi: int = 300) -> tuple[np.ndarray, fitz.Page]:
    page = doc[index]
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csRGB, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), page


def _ink_mask(gray: np.ndarray) -> np.ndarray:
    thr = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    # join characters into words/lines so the rectangle follows text, not noise
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
    return cv2.morphologyEx(thr, cv2.MORPH_CLOSE, k)


def _row_profile_score(mask: np.ndarray, angle: float) -> float:
    h, w = mask.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
    rot = cv2.warpAffine(mask, M, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    proj = rot.sum(axis=1).astype(np.float64)
    # upright text: ink rows and white gaps alternate sharply, so the
    # projection's variance peaks at the true angle
    return float(proj.var())


def estimate_skew(gray: np.ndarray) -> float:
    """Skew in degrees (the angle to rotate by, counter-clockwise positive),
    limited to ±8°. Projection-profile search: the angle at which the row
    projection of the ink is sharpest is the angle at which the lines of
    text lie flat. Coarse pass at 0.25°, fine pass at 0.05° around the best."""
    mask = _ink_mask(gray)
    if cv2.countNonZero(mask) < 500:
        return 0.0
    # work on a reduced copy: the profile is a global statistic and does not
    # need full resolution
    scale = 900.0 / max(mask.shape)
    if scale < 1.0:
        mask = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    mask = (mask > 0).astype(np.uint8)
    coarse = np.arange(-8.0, 8.01, 0.25)
    scores = [_row_profile_score(mask, a) for a in coarse]
    best = float(coarse[int(np.argmax(scores))])
    fine = np.arange(best - 0.5, best + 0.501, 0.05)
    fscores = [_row_profile_score(mask, a) for a in fine]
    best = float(fine[int(np.argmax(fscores))])
    # a flat page scores about the same everywhere; only act on a clear peak
    base = _row_profile_score(mask, 0.0)
    peak = max(fscores)
    if base > 0 and peak / base < 1.08:
        return 0.0
    # `best` is the rotation that flattened the text — exactly the angle to
    # apply (cv2.getRotationMatrix2D takes counter-clockwise degrees).
    return best if abs(best) >= 0.3 else 0.0


def _noise_level(gray: np.ndarray) -> float:
    """Grain estimate: the standard deviation of the high-frequency residue
    on the paper (non-ink) area. Clean scans sit around 1-3; film grain,
    JPEG mosquito noise and photocopier speckle push it past 5."""
    resid = gray.astype(np.float32) - cv2.medianBlur(gray, 3).astype(np.float32)
    ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    paper = cv2.dilate(ink, np.ones((5, 5), np.uint8)) == 0
    vals = resid[paper]
    return float(vals.std()) if vals.size > 1000 else 0.0


def text_score(gray: np.ndarray) -> float:
    """How text-like a page is in its current orientation. Lines of text
    running left-to-right give the ROW projection a strong periodic
    structure (ink rows separated by white gaps) while the COLUMN projection
    is comparatively flat; the ratio of their coefficients of variation is
    large for upright text and small for text on its side."""
    mask = _ink_mask(gray)
    rows = mask.sum(axis=1).astype(float)
    cols = mask.sum(axis=0).astype(float)
    if rows.sum() <= 0:
        return 0.0
    cv_rows = rows.std() / (rows.mean() + 1e-6)
    cv_cols = cols.std() / (cols.mean() + 1e-6)
    return float(cv_rows / (cv_cols + 1e-6))


def choose_orientation(gray: np.ndarray, classifier=None) -> int:
    """0/90/180/270 degrees the page must be rotated CLOCKWISE to read.
    A classifier (Tesseract's OSD, or an engine's document-orientation
    model) is trusted when it answers; otherwise the projection score picks
    between upright and its 90° turn, and 180° is left to the engines' own
    text-line orientation models."""
    if classifier is not None:
        try:
            ang = classifier(gray)
            if ang is not None:
                ang = int(ang) % 360
                if ang in (0, 90, 180, 270):
                    return ang
        except Exception:
            pass
    s0 = text_score(gray)
    s90 = text_score(cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE))
    return 90 if s90 > s0 * 2.0 else 0


def preprocess(bgr: np.ndarray, page_no: int, dpi: int, width_pt: float, height_pt: float,
               rotation: int, derotation: fitz.Matrix, orientation_classifier=None,
               deskew: bool = True, denoise: bool = True, contrast: bool = True) -> Rendered:
    steps: dict = {}
    H, W = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # cumulative forward transform cleaned <- rendered, kept as 3x3
    fwd = np.eye(3)

    # 1. orientation
    turn = choose_orientation(gray, orientation_classifier)
    if turn:
        rot = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[turn]
        gray = cv2.rotate(gray, rot)
        bgr = cv2.rotate(bgr, rot)
        # rotation matrices in pixel space for the three cases
        if turn == 90:
            m = np.array([[0, -1, H - 1], [1, 0, 0], [0, 0, 1]], dtype=float)
        elif turn == 180:
            m = np.array([[-1, 0, W - 1], [0, -1, H - 1], [0, 0, 1]], dtype=float)
        else:
            m = np.array([[0, 1, 0], [-1, 0, W - 1], [0, 0, 1]], dtype=float)
        fwd = m @ fwd
        steps["orientation"] = turn
    else:
        steps["orientation"] = 0

    # 2. deskew
    if deskew:
        angle = estimate_skew(gray)
        if abs(angle) >= 0.3:
            h, w = gray.shape[:2]
            M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), angle, 1.0)
            gray = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            bgr = cv2.warpAffine(bgr, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            fwd = np.vstack([M, [0, 0, 1]]) @ fwd
            steps["deskew_deg"] = round(angle, 2)
        else:
            steps["deskew_deg"] = 0.0

    # 3. denoise, only when the page is actually noisy — the filter softens
    #    thin strokes on a clean scan and costs accuracy there.
    if denoise:
        nl = _noise_level(gray)
        steps["noise"] = round(nl, 2)
        if nl > 5.0:
            gray = cv2.fastNlMeansDenoising(gray, None, h=12, templateWindowSize=7, searchWindowSize=21)
            bgr = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
            steps["denoised"] = True

    # 4. contrast
    if contrast:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        bgr = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        steps["clahe"] = True

    # binarised copy for Tesseract
    img_bin = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]

    r = Rendered(page_no, dpi, width_pt, height_pt, rotation, gray, img_bin, bgr, steps, np.linalg.inv(fwd))
    r._derotation = derotation
    return r
