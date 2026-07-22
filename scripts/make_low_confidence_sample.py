"""Generate a deliberately degraded receipt image to demo the OCR confidence
quality gate (receipt_recon.ocr.CONFIDENCE_THRESHOLD).

Blurs, downscales, and rotates a cached CORD sample so Mistral OCR reads it with
low confidence (~0.5) and garbled content, triggering the extract-fields-fallback
path instead of trusting document_annotation.

Usage:
    uv run python scripts/make_low_confidence_sample.py [source_receipt_id]

Requires the source receipt already cached under data/samples/ (run
`load_samples()` / `main.py` once first if data/samples/ is empty).
"""

from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageFilter

from receipt_recon.dataset import SAMPLES_DIR


def main() -> None:
    source_id = sys.argv[1] if len(sys.argv) > 1 else "cord-test-0"
    target_id = f"{source_id}-degraded"

    src_png = os.path.join(SAMPLES_DIR, f"{source_id}.png")
    src_gt = os.path.join(SAMPLES_DIR, f"{source_id}.gt.json")
    if not os.path.exists(src_png):
        raise SystemExit(f"{src_png} not found — cache a sample first (run main.py once).")

    img = Image.open(src_png).convert("RGB")
    small = img.resize((max(1, img.width // 3), max(1, img.height // 3)), Image.Resampling.BILINEAR)
    blurred = small.filter(ImageFilter.GaussianBlur(radius=1.2))
    degraded = blurred.resize(img.size, Image.Resampling.BILINEAR)
    degraded = degraded.rotate(8, expand=True, fillcolor=(255, 255, 255))

    out_png = os.path.join(SAMPLES_DIR, f"{target_id}.png")
    degraded.save(out_png)

    # Ground truth is inherited from the source receipt (same underlying receipt,
    # just a worse-quality photo of it) so extraction_accuracy still has something
    # meaningful to compare against.
    with open(src_gt) as f:
        gt = json.load(f)
    with open(os.path.join(SAMPLES_DIR, f"{target_id}.gt.json"), "w") as f:
        json.dump(gt, f, indent=2)

    print(f"Wrote {out_png}")


if __name__ == "__main__":
    main()
