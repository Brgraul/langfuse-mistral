"""Mistral OCR + structured extraction (Person B).

Pipeline, every step traced in Langfuse:
  1. `run_ocr` — mistral-ocr-latest reads the receipt image in ONE call, requesting:
     - `include_blocks=True`      -> paragraph-level bounding boxes per detected element
     - `confidence_scores_granularity="word"` -> per-word + aggregate page confidence
     - `document_annotation_format` -> the final ExtractedReceipt JSON, produced by
       the OCR model itself (no separate chat-completion call needed on the happy path)
     Each detected block becomes its own Langfuse child span nested under the OCR
     generation: input = the block's bounding box cropped out of the source image,
     output = the block's extracted content — so every field can be traced back to
     exactly where on the receipt it came from.
  2. Quality gate — if the aggregate OCR confidence is below CONFIDENCE_THRESHOLD,
     the document_annotation is treated as unreliable: log a Langfuse WARNING event
     and fall back to `extract_fields`, a second chat-completion pass over the raw
     OCR markdown, traced as its own generation.

`--mock` (mock=True) skips the network and returns the saved ground truth as if it
were OCR output, so the pipeline demos even if the live API is flaky.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any, Optional

from .config import mistral_client
from .schemas import ExtractedReceipt

OCR_MODEL = "mistral-ocr-latest"
EXTRACT_MODEL = "mistral-large-latest"

# Below this aggregate OCR confidence, don't trust document_annotation as-is —
# fall back to a second LLM pass over the raw markdown, with an explicit warning.
CONFIDENCE_THRESHOLD = 0.85

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

# JSON schema Mistral OCR must follow for `document_annotation` — same shape as the
# chat-fallback prompt above, expressed as a real schema for document_annotation_format.
_RECEIPT_ANNOTATION_SCHEMA = {
    "type": "object",
    "properties": {
        "merchant": {"type": ["string", "null"]},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "qty": {"type": "number"},
                    "unit_price": {"type": "number"},
                    "price": {"type": "number"},
                },
                "required": ["name"],
            },
        },
        "subtotal": {"type": ["number", "null"]},
        "tax": {"type": ["number", "null"]},
        "discount": {"type": ["number", "null"]},
        "total": {"type": ["number", "null"]},
        "payment_method": {"type": ["string", "null"]},
        "cash_price": {"type": ["number", "null"]},
        "change": {"type": ["number", "null"]},
    },
    "required": ["items"],
}


def _encode_image(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def _crop_block_base64(image_path: str, block: Any, page_dims: Any) -> Optional[str]:
    """Crop the source image to a block's bounding box, return a base64 data URI.

    Block coordinates are pixel offsets against `page_dims` (the OCR'd page-image's
    own width/height), which may differ from the source file's resolution — scale
    accordingly so crops land on the right region regardless of DPI mismatches.
    """
    try:
        from PIL import Image
    except ImportError:
        return None

    try:
        with Image.open(image_path) as img:
            img = img.convert("RGB")
            src_w, src_h = img.size
            page_w = getattr(page_dims, "width", src_w) or src_w
            page_h = getattr(page_dims, "height", src_h) or src_h
            scale_x = src_w / page_w
            scale_y = src_h / page_h

            box = (
                max(0, int(block.top_left_x * scale_x)),
                max(0, int(block.top_left_y * scale_y)),
                min(src_w, int(block.bottom_right_x * scale_x)),
                min(src_h, int(block.bottom_right_y * scale_y)),
            )
            if box[2] <= box[0] or box[3] <= box[1]:
                return None

            crop = img.crop(box)
            import io

            buf = io.BytesIO()
            crop.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def _trace_blocks(image_path: str, page, langfuse) -> None:
    """One child span per detected block: input = cropped region, output = content."""
    blocks = getattr(page, "blocks", None) or []
    page_dims = getattr(page, "dimensions", None)

    for block in blocks:
        block_type = getattr(block, "type", "unknown")
        crop_b64 = _crop_block_base64(image_path, block, page_dims)

        span_input: Any = {
            "bbox": {
                "top_left_x": block.top_left_x,
                "top_left_y": block.top_left_y,
                "bottom_right_x": block.bottom_right_x,
                "bottom_right_y": block.bottom_right_y,
            },
        }
        if crop_b64:
            from langfuse.media import LangfuseMedia

            span_input["image"] = LangfuseMedia(
                base64_data_uri=f"data:image/png;base64,{crop_b64}"
            )

        with langfuse.start_as_current_observation(
            name=f"block:{block_type}", as_type="span", input=span_input,
        ) as bspan:
            bspan.update(output=block.content, metadata={"block_type": block_type})


def run_ocr(image_path: str, langfuse=None):
    """Run Mistral OCR with bounding boxes + structured document_annotation.

    Returns (markdown_text, document_annotation_json_or_None, confidence_score_or_None).
    """
    client = mistral_client()
    data_url = f"data:image/png;base64,{_encode_image(image_path)}"

    def _call():
        resp = client.ocr.process(
            model=OCR_MODEL,
            document={"type": "image_url", "image_url": data_url},
            include_image_base64=False,
            include_blocks=True,
            confidence_scores_granularity="word",
            document_annotation_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "extracted_receipt",
                    "schema": _RECEIPT_ANNOTATION_SCHEMA,
                    "strict": True,
                },
            },
        )
        text = "\n\n".join(page.markdown for page in resp.pages)
        usage = getattr(resp, "usage_info", None)
        return text, resp, usage

    if langfuse is None:
        text, resp, _ = _call()
        return text, resp.document_annotation, _aggregate_confidence(resp)

    with langfuse.start_as_current_observation(
        name="mistral-ocr", as_type="generation", model=OCR_MODEL,
        input={"image_path": os.path.basename(image_path)},
        model_parameters={
            "include_blocks": True,
            "confidence_scores_granularity": "word",
            "document_annotation_format": "json_schema",
        },
    ) as gen:
        text, resp, usage = _call()
        confidence = _aggregate_confidence(resp)

        for page in resp.pages:
            _trace_blocks(image_path, page, langfuse)

        gen.update(
            output={"markdown": text, "document_annotation": resp.document_annotation},
            metadata={"num_pages": len(resp.pages), "aggregate_confidence": confidence},
            usage_details={"pages_processed": getattr(usage, "pages_processed", len(resp.pages))} if usage else None,
        )
        return text, resp.document_annotation, confidence


def _aggregate_confidence(resp) -> Optional[float]:
    """Average of each page's average confidence score, or None if unavailable."""
    scores = []
    for page in resp.pages:
        cs = getattr(page, "confidence_scores", None)
        if cs is not None and getattr(cs, "average_page_confidence_score", None) is not None:
            scores.append(cs.average_page_confidence_score)
    if not scores:
        return None
    return sum(scores) / len(scores)


def extract_fields(ocr_text: str, langfuse=None) -> ExtractedReceipt:
    """Fallback: turn raw OCR markdown into ExtractedReceipt via a chat model.

    Only invoked when the OCR call's own structured document_annotation is missing
    or the confidence quality gate fails.
    """
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
            name="extract-fields-fallback", as_type="generation", model=EXTRACT_MODEL,
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
    receipt.source = "mistral-ocr-fallback"
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

    text, document_annotation, confidence = run_ocr(image_path, langfuse=langfuse)

    low_confidence = confidence is not None and confidence < CONFIDENCE_THRESHOLD
    if low_confidence and langfuse is not None:
        langfuse.create_event(
            name="ocr-low-confidence",
            level="WARNING",
            input={"confidence": confidence, "threshold": CONFIDENCE_THRESHOLD},
            status_message=(
                f"OCR aggregate confidence {confidence:.3f} is below the "
                f"{CONFIDENCE_THRESHOLD} quality gate — falling back to a second "
                "extraction pass over the raw OCR markdown."
            ),
        )

    if document_annotation is not None and not low_confidence:
        try:
            data = json.loads(document_annotation)
            receipt = ExtractedReceipt(**data)
            receipt.raw_ocr_text = text
            receipt.source = "mistral-ocr"
            return receipt
        except Exception:
            pass  # malformed annotation — fall through to the chat-based fallback

    return extract_fields(text, langfuse=langfuse)
