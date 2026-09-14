"""OCR service for the 5471 Work Paper.

PaddleOCR 3.x is the primary engine (PP-OCRv6 where the installed release and
the local model store provide it, PP-OCRv5 otherwise; PP-StructureV3 for table
pages). Surya is the secondary engine, consulted when the primary result is
weak or when a numeric token needs a second reading. Tesseract is the last,
optional fallback. Every reading keeps its source page, bounding box, engine
and confidence; nothing the engines disagree on is silently resolved.
"""

__version__ = "1.0.0"
