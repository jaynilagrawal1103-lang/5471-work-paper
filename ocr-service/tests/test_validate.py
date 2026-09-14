from ocr_service.models import Word
from ocr_service.validate import (compare_engines, is_well_formed_amount, is_well_formed_date, looks_numeric,
                                  normalise_number, suspicious_glyphs, validate_words)


def w(text, conf=0.99, bbox=(0, 0, 50, 10), engine="paddle"):
    return Word(text, list(bbox), conf, engine)


def test_amount_grammar():
    for ok in ["30,257.06", "(523,743.76)", "-197.98", "$ 72,882.56", "1.234.567,89", "12%", "1,500", "0.833", "2024", "$72,882.56CR"]:
        assert is_well_formed_amount(ok), ok
    for bad in ["12,3456", "1,,000", "$72.882.56", "1.2.3.4", "30,257.0.6"]:
        assert not is_well_formed_amount(bad), bad


def test_normalise_number():
    assert normalise_number("30,257.06") == 30257.06
    assert normalise_number("(523,743.76)") == -523743.76
    assert normalise_number("-197.98") == -197.98
    assert normalise_number("197.98-") == -197.98
    assert normalise_number("$ 72,882.56") == 72882.56
    assert normalise_number("1.234.567,89") == 1234567.89
    assert normalise_number("1 234 567,89") == 1234567.89
    assert normalise_number("1,500") == 1500
    assert normalise_number("12 CR") == -12
    assert normalise_number("abc") is None


def test_looks_numeric_excludes_date_parts_and_captions():
    assert looks_numeric("30,257.06")
    assert looks_numeric("1,OOO.5O")
    assert not looks_numeric("11,")          # day of month
    assert not looks_numeric("2024")         # bare year: date checks own it
    assert not looks_numeric("Note 3")
    assert not looks_numeric("Sales")


def test_suspicious_glyphs():
    assert suspicious_glyphs("1,OOO.5O") == "1,000.50"
    assert suspicious_glyphs("3O,257.O6") == "30,257.06"
    assert suspicious_glyphs("30,257.06") is None
    assert suspicious_glyphs("Sales") is None


def test_dates():
    assert is_well_formed_date("12/31/2024")
    assert is_well_formed_date("31.12.24")
    assert is_well_formed_date("June 11, 2025")
    assert not is_well_formed_date("13/45/2024") is None  # shape only; the app validates the calendar


def test_validate_words_flags_low_confidence_figures_but_not_prose():
    flags = validate_words(1, [w("30,257.06", conf=0.62), w("Cash and cash", conf=0.62), w("1,OOO", conf=0.99), w("12,3456", conf=0.99)])
    kinds = sorted(f.kind for f in flags)
    assert "low-confidence" in kinds
    assert "suspicious-glyph" in kinds
    assert "numeric-grammar" in kinds
    low = [f for f in flags if f.kind == "low-confidence"]
    assert all(f.level == "warn" for f in low if f.text == "30,257.06")
    assert all(f.level == "info" for f in low if f.text.startswith("Cash"))
    # the reading itself is never changed: the flag carries the alternative
    g = next(f for f in flags if f.kind == "suspicious-glyph")
    assert g.text == "1,OOO" and g.alt == "1,000"


def test_compare_engines_flags_real_disagreement_only():
    primary = [w("$72.882.56", bbox=(500, 0, 600, 10)), w("30,257.06", bbox=(500, 20, 600, 30)), w("11,", bbox=(0, 40, 20, 50))]
    other = [w("$ 72,882.56", bbox=(498, 0, 602, 11), engine="tesseract"),
             w("30,257.06", bbox=(499, 20, 601, 30), engine="tesseract"),
             w("11, aC", bbox=(0, 40, 24, 50), engine="tesseract")]
    flags = compare_engines(1, primary, other, "tesseract")
    assert len(flags) == 1
    f = flags[0]
    assert f.kind == "engines-disagree" and f.text == "$72.882.56" and f.alt == "$ 72,882.56"
    assert f.alt_engine == "tesseract"


def test_compare_engines_ignores_junk_alternatives():
    primary = [w("2025", bbox=(0, 0, 40, 10)), w("31,", bbox=(50, 0, 70, 10))]
    other = [w("025 OS", bbox=(0, 0, 44, 10), engine="tesseract"), w("r3t,", bbox=(50, 0, 72, 10), engine="tesseract")]
    assert compare_engines(1, primary, other, "tesseract") == []
