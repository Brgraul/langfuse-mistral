"""CORD v2 loader + ground-truth normalizer (Person A — data).

Pulls receipt images + structured ground truth from the HuggingFace dataset
`naver-clova-ix/cord-v2` and normalizes CORD's `gt_parse` shape into our shared
`ExtractedReceipt` contract so Person D can compare field-for-field.
"""

from __future__ import annotations

import json
import os
import re
from typing import List, Optional

from .schemas import ExtractedReceipt, LineItem, ReceiptRecord

SAMPLES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "samples")


def _to_float(val) -> Optional[float]:
    """CORD prices are strings like '10,000' or '1.234' or '- 5,000'. Best-effort parse."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s:
        return None
    # strip currency symbols/spaces, keep digits, separators and sign
    s = re.sub(r"[^\d,.\-]", "", s)
    if not s:
        return None
    # CORD uses ',' as a thousands separator (Indonesian receipts). Drop commas.
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _as_list(x) -> list:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def normalize_ground_truth(gt_parse: dict) -> ExtractedReceipt:
    """Map CORD's gt_parse dict into our ExtractedReceipt shape."""
    items: List[LineItem] = []
    for m in _as_list(gt_parse.get("menu")):
        if not isinstance(m, dict):
            continue
        qty = _to_float(m.get("cnt")) or 1.0
        unit = _to_float(m.get("unitprice"))
        price = _to_float(m.get("price"))
        if unit is None and price is not None and qty:
            unit = price / qty
        items.append(
            LineItem(
                name=str(m.get("nm", "")).strip(),
                qty=qty,
                unit_price=unit or 0.0,
                price=price or 0.0,
            )
        )

    sub = gt_parse.get("sub_total", {}) or {}
    tot = gt_parse.get("total", {}) or {}

    return ExtractedReceipt(
        merchant=None,  # CORD gt_parse rarely carries a clean merchant name
        items=items,
        subtotal=_to_float(sub.get("subtotal_price")),
        tax=_to_float(sub.get("tax_price")),
        discount=_to_float(sub.get("discount_price")),
        total=_to_float(tot.get("total_price")),
        cash_price=_to_float(tot.get("cashprice")),
        change=_to_float(tot.get("changeprice")),
        payment_method="cash" if tot.get("cashprice") else None,
        source="ground_truth",
    )


def load_samples(n: int = 3, split: str = "test", seed: int = 42) -> List[ReceiptRecord]:
    """Download CORD v2, save `n` images locally, return ReceiptRecords.

    Images are written to data/samples/ (gitignored). Re-running reuses them.
    """
    from datasets import load_dataset

    os.makedirs(SAMPLES_DIR, exist_ok=True)
    ds = load_dataset("naver-clova-ix/cord-v2", split=split)

    # Deterministic pick without shuffling the whole set.
    idxs = list(range(min(n, len(ds))))

    records: List[ReceiptRecord] = []
    for i in idxs:
        row = ds[i]
        receipt_id = f"cord-{split}-{i}"
        image_path = os.path.join(SAMPLES_DIR, f"{receipt_id}.png")
        if not os.path.exists(image_path):
            row["image"].convert("RGB").save(image_path)

        gt_parse = json.loads(row["ground_truth"])["gt_parse"]
        gt = normalize_ground_truth(gt_parse)

        # persist normalized gt for debugging / stubs
        with open(os.path.join(SAMPLES_DIR, f"{receipt_id}.gt.json"), "w") as f:
            f.write(gt.model_dump_json(indent=2))

        records.append(
            ReceiptRecord(receipt_id=receipt_id, image_path=image_path, ground_truth=gt)
        )
    return records
