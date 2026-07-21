"""OCR seam: extract_receipt() hides mock vs. live Mistral OCR behind one interface."""

import json
import os
from pathlib import Path

from receipt_agent.contracts import ExtractedReceipt, ReceiptItem

FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "fixtures"


def extract_receipt(image_path: str, mock: bool = True) -> ExtractedReceipt:
    """image_path: path to a receipt image. In mock mode, the matching fixture's
    normalized.json (same parent directory) is returned instead of calling Mistral OCR."""
    if mock:
        return _load_mock_extraction(image_path)
    return _call_mistral_ocr(image_path)


def _load_mock_extraction(image_path: str) -> ExtractedReceipt:
    normalized_path = Path(image_path).parent / "normalized.json"
    data = json.loads(normalized_path.read_text())
    data["items"] = [ReceiptItem(**item) for item in data["items"]]
    return ExtractedReceipt(**data)


def _call_mistral_ocr(image_path: str) -> ExtractedReceipt:
    from mistralai.client import Mistral

    client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])
    raise NotImplementedError(
        "Live Mistral OCR call not wired up yet (Phase 4). "
        f"Would call client.ocr.process(model='mistral-ocr-latest', ...) for {image_path}."
    )
