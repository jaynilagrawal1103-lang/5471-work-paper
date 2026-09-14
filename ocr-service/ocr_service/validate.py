"""Validation of OCR readings that matter on a tax work paper.

Numbers, dates, percentages and currency amounts are where a single misread
glyph changes a filed figure, so every token that looks like one is checked
against the grammar of such tokens, and every one below the confidence floor
is flagged. A second engine's reading of the same token, when one exists, is
compared here too. Nothing is corrected in place — the flag carries the
alternative and the preparer decides.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

from .models import Flag, Word

# Confidence floors. Numeric tokens are held to a higher bar than prose:
# a low-confidence caption is still readable, a low-confidence amount is not.
NUMERIC_CONF_FLOOR = 0.90
TEXT_CONF_FLOOR = 0.75

CURRENCY = r"(?:[$€£¥₹]|USD|EUR|GBP|CHF|KYD|CAD|AUD|JPY|CNY|HKD|SGD|MXN|BRL|INR)"
# A well-formed amount: optional sign/paren/currency, digit groups either
# unseparated or consistently separated by "," or "." or a thin/plain space,
# optional decimals, optional trailing sign/paren/CR/DR/%.
#   US:    1,234,567.89   EU: 1.234.567,89   spaced: 1 234 567.89 / 1'234'567.89   plain: 1234567.89
# The grouping separator decides the decimal separator: comma groups take a
# period decimal and vice versa, so "$72.882.56" is malformed, not European.
_AMOUNT_CORE = (r"(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?"
                r"|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?"
                r"|\d{1,3}(?:[ \u00a0\u202f']\d{3})+(?:[.,]\d{1,2})?"
                r"|\d+(?:\.\d{1,4}|,\d{1,2})?)")
_AMOUNT = re.compile(
    rf"^\(?[-+−–]?\s?{CURRENCY}?\s?[-+−–]?\s?{_AMOUNT_CORE}\s?(?:%|{CURRENCY}|CR|DR)?\s?\)?[-+−–]?$",
    re.IGNORECASE,
)
# Something that is trying to be a number: mostly digits with number-ish
# punctuation, and possibly a glyph OCR confuses with a digit.
_NUMERIC_LIKE = re.compile(r"^[\s()\[\]$€£¥₹%,.\-+−–'  A-Za-z]*[\dOoIlSsB|][\s()\[\]$€£¥₹%,.\-+−–'  \dOoIlSsB|A-Za-z]*$")
_HAS_DIGIT = re.compile(r"\d")
_DATE = re.compile(
    r"^(?:\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4})|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}|"
    r"(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(?:\d{1,2},?\s+)?\d{2,4})$",
    re.IGNORECASE,
)
_DATE_LIKE = re.compile(r"^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$|^\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}$")

# Glyphs OCR engines swap for digits, and what they were probably meant to be.
_GLYPH_SWAPS = {"O": "0", "o": "0", "I": "1", "l": "1", "|": "1", "S": "5", "s": "5", "B": "8", "Z": "2", "z": "2"}


_DATE_PART = re.compile(r"^\d{1,2}[,.]$|^\d{4}[,.;:]?$")
_NUM_TOKEN = re.compile(r"^[\d()\[\],.\-+−–'OoIlSsB|]+$")
_STRIP_UNITS = re.compile(rf"^\(?[-+−–]?\s?{CURRENCY}?\s?|\s?(?:%|{CURRENCY}|CR|DR)?\s?\)?[-+−–]?$", re.IGNORECASE)


def looks_numeric(text: str) -> bool:
    """A token a preparer would read as a figure: digits (or the letters OCR
    swaps for digits) with number punctuation, optionally wrapped in a
    currency mark, parentheses or CR/DR. A day-of-month with its comma
    ("11,") or a bare year is a date part, not an amount, and is left to the
    date checks; a caption that merely contains a digit ("Note 3") is not a
    figure at all."""
    t = text.strip()
    if not t or _DATE_PART.match(t):
        return False
    if not _HAS_DIGIT.search(t):
        return False
    core = _STRIP_UNITS.sub("", t).strip()
    if not core:
        return False
    parts = core.split()
    return all(_NUM_TOKEN.match(p) for p in parts)


def is_well_formed_amount(text: str) -> bool:
    return bool(_AMOUNT.match(text.strip()))


def is_well_formed_date(text: str) -> bool:
    return bool(_DATE.match(text.strip()))


def suspicious_glyphs(text: str) -> Optional[str]:
    """If a digit run contains a letter OCR commonly swaps for a digit, return
    the text with the swap undone; else None. `1,OOO.5O` -> `1,000.50`."""
    t = text.strip()
    if not _HAS_DIGIT.search(t):
        return None
    if not any(ch in _GLYPH_SWAPS for ch in t):
        return None
    # Only inside a run that is otherwise digits/number punctuation.
    fixed = "".join(_GLYPH_SWAPS.get(ch, ch) for ch in t)
    return fixed if fixed != t and is_well_formed_amount(fixed) else None


def normalise_number(text: str) -> Optional[float]:
    """Parse an amount as the work paper would. Parentheses, a leading or
    trailing minus, and a trailing CR mean negative. Returns None when the
    token is not a parseable amount."""
    t = text.strip()
    if not t:
        return None
    neg = False
    if t.startswith("(") and t.endswith(")"):
        neg, t = True, t[1:-1].strip()
    if re.search(r"(?:^[-−–]|[-−–]$|\bCR$)", t, re.IGNORECASE):
        neg = True
    t = re.sub(r"(?i)\bCR$|\bDR$|%$", "", t)
    t = re.sub(rf"{CURRENCY}", "", t, flags=re.IGNORECASE)
    t = t.replace("−", "").replace("–", "").replace("-", "").replace("+", "").strip()
    t = re.sub(r"[\s  ']", "", t)
    if not t:
        return None
    # Decide the decimal separator: the LAST separator, if followed by 1-2
    # digits and not by a group of exactly three earlier, is decimal.
    if "," in t and "." in t:
        if t.rfind(",") > t.rfind("."):
            t = t.replace(".", "").replace(",", ".")
        else:
            t = t.replace(",", "")
    elif "," in t:
        parts = t.split(",")
        if len(parts) == 2 and len(parts[1]) in (1, 2):
            t = parts[0] + "." + parts[1]
        else:
            t = t.replace(",", "")
    elif "." in t:
        parts = t.split(".")
        if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3 and len(parts[0]) <= 3):
            # 1.234.567 or 1.234 — European grouping
            t = t.replace(".", "")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def _same_reading(a: str, b: str) -> bool:
    """Two engines agree when the parsed value agrees; for non-numeric text,
    when the text agrees ignoring case and spacing."""
    na, nb = normalise_number(a), normalise_number(b)
    if na is not None and nb is not None:
        return abs(na - nb) < 1e-9
    return re.sub(r"\s+", "", a).lower() == re.sub(r"\s+", "", b).lower()


def validate_words(page: int, words: list[Word]) -> list[Flag]:
    """Grammar and confidence checks on one page's readings."""
    flags: list[Flag] = []
    for w in words:
        t = w.text.strip()
        if not t:
            continue
        numeric = looks_numeric(t)
        datey = bool(_DATE_LIKE.match(t)) or is_well_formed_date(t)
        if numeric or datey:
            if w.conf < NUMERIC_CONF_FLOOR:
                flags.append(Flag(page, "low-confidence", "warn", t, w.bbox, w.conf, w.engine,
                                  f"'{t}' was read at {w.conf:.0%} confidence, below the {NUMERIC_CONF_FLOOR:.0%} floor for figures — verify against the scan."))
            swap = suspicious_glyphs(t)
            if swap:
                flags.append(Flag(page, "suspicious-glyph", "warn", t, w.bbox, w.conf, w.engine,
                                  f"'{t}' contains a letter where a digit is expected; it may be '{swap}'. The original reading is kept — confirm which is right.",
                                  alt=swap, alt_engine="validator"))
            elif numeric and not datey and not is_well_formed_amount(t):
                flags.append(Flag(page, "numeric-grammar", "warn", t, w.bbox, w.conf, w.engine,
                                  f"'{t}' does not read as a well-formed amount (check the thousands separator, decimal point, sign or currency symbol)."))
            elif datey and not is_well_formed_date(t):
                flags.append(Flag(page, "date-grammar", "warn", t, w.bbox, w.conf, w.engine,
                                  f"'{t}' looks like a date but is not well formed — verify the day, month and year."))
        elif w.conf < TEXT_CONF_FLOOR and len(t) > 2:
            flags.append(Flag(page, "low-confidence", "info", t, w.bbox, w.conf, w.engine,
                              f"'{t}' was read at {w.conf:.0%} confidence."))
    return flags


def _overlap(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    area_a = max(1e-6, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1e-6, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / min(area_a, area_b)


def compare_engines(page: int, primary: list[Word], other: list[Word], other_engine: str) -> list[Flag]:
    """Cross-check numeric/date tokens between two engines' readings of the
    same page. A token is matched to the other engine's token by box overlap
    (the text can differ — that is the point). A disagreement is reported with
    both readings; the primary's is kept."""
    flags: list[Flag] = []
    if not other:
        return flags
    for w in primary:
        t = w.text.strip()
        if not (looks_numeric(t) or _DATE_LIKE.match(t)):
            continue
        best, best_ov = None, 0.0
        for o in other:
            ov = _overlap(w.bbox, o.bbox)
            if ov > best_ov:
                best, best_ov = o, ov
        if best is None or best_ov < 0.4:
            continue
        # The other engine may split or join tokens; compare against the
        # concatenation of every other-engine token overlapping this box.
        joined = "".join(o.text for o in sorted((o for o in other if _overlap(w.bbox, o.bbox) >= 0.4),
                                                key=lambda o: o.bbox[0])).strip()
        cand = best.text.strip()
        if _same_reading(t, cand) or _same_reading(t, joined):
            continue
        alt = cand if looks_numeric(cand) else joined
        # A second reading that is not itself a number ("11, aC", "r3t,") is
        # the other engine failing on the crop, not a disagreement about the
        # figure; only a parseable alternative is worth a reviewer's time.
        if normalise_number(alt) is None:
            continue
        flags.append(Flag(page, "engines-disagree", "warn", t, w.bbox, w.conf, w.engine,
                          f"{w.engine} read '{t}' but {other_engine} read '{alt}' at the same position. The {w.engine} reading is kept; confirm against the scan.",
                          alt=alt, alt_engine=other_engine, alt_conf=best.conf))
    return flags


def dedupe_flags(flags: Iterable[Flag]) -> list[Flag]:
    seen: set[tuple] = set()
    out: list[Flag] = []
    for f in flags:
        key = (f.page, f.kind, f.text, tuple(round(v) for v in f.bbox))
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out
