"""Mistral OCR + structured extraction (Person B).

Two steps, both traced as Langfuse generations:
  1. `run_ocr`      — mistral-ocr-latest turns the receipt image into markdown text.
  2. `extract_fields` — a chat model turns that markdown into an ExtractedReceipt.

`--mock` (mock=True) skips the network and returns the saved ground truth as if it
were OCR output, so the pipeline demos even if the live API is flaky.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Optional

from .config import mistral_client
from .schemas import ExtractedReceipt

OCR_MODEL = "mistral-ocr-latest"
EXTRACT_MODEL = "mistral-large-latest"

_EXTRACT_SYSTEM = """You are a meticulous finance assistant that extracts structured \
data from receipt text. Return ONLY valid JSON matching this schema (numbers as \
numbers, null if truly absent):
{
  "merchant": string|null,
  "items": [{"name": string, "qty": number, "unit_price": number, "price": number}],
  "subtotal": number|null,
  "tax": number|null,
  "discount": number|null,
  "total": number|null,
  "payment_method": string|null,
  "cash_price": number|null,
  "change": number|null
}
`price` is the line total actually paid. `total` is the amount owed. `cash_price` is \
cash tendered (can exceed total). Do not invent values."""


def _encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def run_ocr(image_path: str, langfuse=None) -> str:
    """Return markdown text of the receipt from Mistral OCR."""
    client = mistral_client()
    data_url = f"data:image/png;base64,{_encode_image(image_path)}"

    def _call():
        resp = client.ocr.process(
            model=OCR_MODEL,
            document={"type": "image_url", "image_url": data_url},
            include_image_base64=False,
        )
        text = "\n\n".join(page.markdown for page in resp.pages)
        usage = getattr(resp, "usage_info", None)
        return text, resp, usage

    if langfuse is None:
        text, _, _ = _call()
        return text
    with langfuse.start_as_current_observation(
        name="mistral-ocr", as_type="generation", model=OCR_MODEL,
        input={"image_path": os.path.basename(image_path)},
        model_parameters={"include_image_base64": False},
    ) as gen:
        text, resp, usage = _call()
        gen.update(
            output=text,
            metadata={"num_pages": len(resp.pages)},
            usage_details={"pages_processed": getattr(usage, "pages_processed", len(resp.pages))} if usage else None,
        )
        return text


def extract_fields(ocr_text: str, langfuse=None) -> ExtractedReceipt:
    """Turn raw OCR markdown into a structured ExtractedReceipt via a chat model."""
    client = mistral_client()

    def _call():
        resp = client.chat.complete(
            model=EXTRACT_MODEL,
            messages=[
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {"role": "user", "content": ocr_text},
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
        return resp.choices[0].message.content, getattr(resp, "usage", None)

    if langfuse is None:
        raw, _ = _call()
    else:
        with langfuse.start_as_current_observation(
            name="extract-fields", as_type="generation", model=EXTRACT_MODEL,
            input={"ocr_text": ocr_text},
            model_parameters={"temperature": 0, "response_format": "json_object"},
        ) as gen:
            raw, usage = _call()
            gen.update(
                output=raw,
                usage_details=(
                    {
                        "input": getattr(usage, "prompt_tokens", 0),
                        "output": getattr(usage, "completion_tokens", 0),
                        "total": getattr(usage, "total_tokens", 0),
                    }
                    if usage
                    else None
                ),
            )

    data = json.loads(raw)
    receipt = ExtractedReceipt(**data)
    receipt.raw_ocr_text = ocr_text
    receipt.source = "mistral-ocr"
    return receipt


def ocr_and_extract(
    image_path: str, mock_ground_truth: Optional[ExtractedReceipt] = None, langfuse=None
) -> ExtractedReceipt:
    """Full OCR->extract step. If mock_ground_truth is given, skip the network."""
    if mock_ground_truth is not None:
        mock = mock_ground_truth.model_copy(deep=True)
        mock.source = "mock"
        mock.raw_ocr_text = "[MOCK — ground truth used in place of OCR]"
        return mock

    text = run_ocr(image_path, langfuse=langfuse)
    return extract_fields(text, langfuse=langfuse)
