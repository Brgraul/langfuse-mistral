"""Evaluation against ground truth (Person D + F).

Two scores, pushed to Langfuse:
  - extraction_accuracy: how well OCR/extraction matched the CORD ground truth,
    field by field (fraction of comparable numeric fields within tolerance).
  - decision_correct: did the engine's verdict match the claim's expected_decision.
"""

from __future__ import annotations

from typing import Dict, Optional

from .policy import AMOUNT_TOLERANCE
from .schemas import Decision, ExpenseClaim, ExtractedReceipt

_NUMERIC_FIELDS = ["subtotal", "tax", "discount", "total", "cash_price", "change"]


def extraction_accuracy(extracted: ExtractedReceipt, ground_truth: ExtractedReceipt) -> Dict:
    """Fraction of comparable numeric fields the extraction got right (within tolerance)."""
    compared = 0
    correct = 0
    per_field = {}
    for f in _NUMERIC_FIELDS:
        gt = getattr(ground_truth, f)
        ex = getattr(extracted, f)
        if gt is None:
            continue
        compared += 1
        ok = ex is not None and abs(ex - gt) <= AMOUNT_TOLERANCE
        per_field[f] = {"ground_truth": gt, "extracted": ex, "match": ok}
        if ok:
            correct += 1

    # item count agreement (soft signal)
    per_field["item_count"] = {
        "ground_truth": len(ground_truth.items),
        "extracted": len(extracted.items),
        "match": len(ground_truth.items) == len(extracted.items),
    }

    score = (correct / compared) if compared else 0.0
    return {"score": round(score, 3), "compared": compared, "correct": correct, "fields": per_field}


def decision_correct(decision: Decision, claim: ExpenseClaim) -> Optional[Dict]:
    """Compare the engine's decision to the claim's expected_decision label."""
    expected = claim.expected_decision
    if expected is None:
        return None
    match = decision.decision == expected
    return {"score": 1.0 if match else 0.0, "expected": expected, "actual": decision.decision}
