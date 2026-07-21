"""Download CORD v2 receipt dataset from Hugging Face and save samples to disk.

Saves each sample as:
  data/cord/<split>/<idx>/receipt.png
  data/cord/<split>/<idx>/ground_truth.json   (raw dataset ground_truth field)
  data/cord/<split>/<idx>/normalized.json     (normalized to the ExtractedReceipt contract)
"""

import json
import os
from pathlib import Path

from datasets import load_dataset
from dotenv import load_dotenv

load_dotenv()

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "cord"
SPLITS = {"train": 5, "validation": 3, "test": 3}


def normalize_ground_truth(gt: dict) -> dict:
    """Best-effort mapping of CORD v2's ground_truth schema to the ExtractedReceipt contract."""
    gt_parse = gt.get("gt_parse", gt)
    menu = gt_parse.get("menu", [])
    if isinstance(menu, dict):
        menu = [menu]

    items = []
    for m in menu:
        def _num(key):
            val = m.get(key)
            if val is None:
                return None
            try:
                return float(str(val).replace(",", "").strip())
            except ValueError:
                return None

        items.append(
            {
                "name": m.get("nm"),
                "qty": _num("cnt") or 1.0,
                "unit_price": _num("unitprice"),
                "price": _num("price"),
            }
        )

    sub_total = gt_parse.get("sub_total", {})
    total = gt_parse.get("total", {})

    def _tnum(d, key):
        val = d.get(key)
        if val is None:
            return None
        try:
            return float(str(val).replace(",", "").strip())
        except ValueError:
            return None

    return {
        "merchant": gt_parse.get("store_info", {}).get("store_nm") if isinstance(gt_parse.get("store_info"), dict) else None,
        "items": items,
        "subtotal": _tnum(sub_total, "subtotal_price"),
        "tax": _tnum(sub_total, "tax_price"),
        "discount": _tnum(sub_total, "discount_price"),
        "total": _tnum(total, "total_price"),
        "payment_method": total.get("cashprice") and "cash" or None,
        "cash_price": _tnum(total, "cashprice"),
        "change": _tnum(total, "changeprice"),
    }


def main():
    token = os.environ.get("HF_TOKEN")
    for split, n in SPLITS.items():
        print(f"Loading split={split} (streaming)...")
        ds = load_dataset("naver-clova-ix/cord-v2", split=split, streaming=True, token=token)
        out_dir = DATA_DIR / split
        out_dir.mkdir(parents=True, exist_ok=True)

        count = 0
        for idx, sample in enumerate(ds):
            if count >= n:
                break
            sample_dir = out_dir / str(idx)
            sample_dir.mkdir(parents=True, exist_ok=True)

            image = sample["image"]
            image.save(sample_dir / "receipt.png")

            gt_raw = json.loads(sample["ground_truth"])
            (sample_dir / "ground_truth.json").write_text(json.dumps(gt_raw, indent=2))

            normalized = normalize_ground_truth(gt_raw)
            (sample_dir / "normalized.json").write_text(json.dumps(normalized, indent=2))

            count += 1
            print(f"  saved {split}/{idx}")

        print(f"Done split={split}: saved {count} samples -> {out_dir}")


if __name__ == "__main__":
    main()
