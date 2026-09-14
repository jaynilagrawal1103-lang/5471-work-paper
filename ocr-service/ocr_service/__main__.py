"""`python -m ocr_service` — run the service with uvicorn.

Environment:
    OCR_HOST            default 127.0.0.1 (use 0.0.0.0 to expose it)
    OCR_PORT            default 8472
    OCR_ENGINES         comma list, default paddle,surya,tesseract
    OCR_PADDLE_VERSION  PP-OCRv6 (default) or PP-OCRv5
    OCR_PADDLE_MODEL_DIR  local model store for an offline host
    OCR_PADDLE_BACKEND  auto (default) | native | onnx
"""
from __future__ import annotations

import os

import uvicorn


def main() -> None:
    uvicorn.run("ocr_service.app:app", host=os.environ.get("OCR_HOST", "127.0.0.1"),
                port=int(os.environ.get("OCR_PORT", "8472")), workers=1, log_level=os.environ.get("OCR_LOG", "info"))


if __name__ == "__main__":
    main()
