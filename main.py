"""End-to-end orchestrator for the Receipt Reconciliation Mystery.

Pipeline (each step a Langfuse observation under one trace):
    load receipt (CORD v2) -> OCR + extract -> generate claim -> reconcile -> evaluate

Usage:
    python main.py                         # 1 receipt, random inconsistency, live APIs
    python main.py --n 3                   # 3 receipts
    python main.py --inconsistency change_claimed   # force a known case for the demo
    python main.py --mock                  # skip Mistral, use ground truth as OCR
    python main.py --seed 7                # deterministic claim generation
"""

from __future__ import annotations

import argparse
import json
import sys

from receipt_recon.claims import INCONSISTENCY_TYPES, generate_claim
from receipt_recon.config import langfuse_client
from receipt_recon.dataset import load_samples
from receipt_recon.decision import reconcile
from receipt_recon.evaluation import decision_correct, extraction_accuracy
from receipt_recon.ocr import ocr_and_extract


def _print_case(receipt_id, claim, extracted, decision, ext_eval, dec_eval):
    print("\n" + "=" * 72)
    print(f"RECEIPT: {receipt_id}   |   claim: {claim.claim_id}")
    print(f"  injected inconsistency : {claim.injected_inconsistency}")
    print(f"  claimed amount         : {claim.claimed_amount}")
    print(f"  receipt total (extracted): {extracted.total}")
    print("-" * 72)
    print(f"  DECISION        : {decision.decision.upper()}")
    print(f"  reimbursable    : {decision.reimbursable_amount}")
    print(f"  mismatched field: {decision.mismatched_field}")
    print(f"  policy rule     : {decision.policy_rule}")
    print(f"  evidence needed : {decision.evidence_needed}")
    print(f"  rationale       : {decision.rationale}")
    print("-" * 72)
    print(f"  extraction_accuracy: {ext_eval['score']} "
          f"({ext_eval['correct']}/{ext_eval['compared']} fields)")
    if dec_eval:
        ok = "OK" if dec_eval["score"] == 1.0 else "MISS"
        print(f"  decision_correct   : {ok} (expected {dec_eval['expected']}, "
              f"got {dec_eval['actual']})")


def run_one(record, lf, inconsistency, seed, mock):
    with lf.start_as_current_observation(
        name="reconcile-receipt", as_type="chain",
        input={"receipt_id": record.receipt_id, "inconsistency": inconsistency},
    ) as trace:
        # 1. OCR + extraction
        extracted = ocr_and_extract(
            record.image_path,
            mock_ground_truth=record.ground_truth if mock else None,
            langfuse=lf,
        )

        # 2. Synthetic claim
        claim = generate_claim(
            record.receipt_id, record.ground_truth,
            inconsistency=inconsistency, seed=seed,
        )

        # 3. Decision (deterministic)
        with lf.start_as_current_observation(
            name="reconcile-decision", as_type="tool",
            input={"claim": claim.model_dump(), "receipt": extracted.model_dump()},
        ) as dspan:
            decision = reconcile(claim, extracted)
            dspan.update(output=decision.model_dump())

        # 4. Evaluation vs ground truth
        ext_eval = extraction_accuracy(extracted, record.ground_truth)
        dec_eval = decision_correct(decision, claim)

        trace.update(output={
            "decision": decision.model_dump(),
            "extraction_accuracy": ext_eval["score"],
            "decision_correct": dec_eval["score"] if dec_eval else None,
        })
        # Scores on the trace
        try:
            trace.score(name="extraction_accuracy", value=ext_eval["score"], data_type="NUMERIC")
            if dec_eval:
                trace.score(name="decision_correct", value=dec_eval["score"], data_type="NUMERIC")
        except Exception:
            pass

        _print_case(record.receipt_id, claim, extracted, decision, ext_eval, dec_eval)
        return {
            "receipt_id": record.receipt_id,
            "image_path": record.image_path,
            "claim": claim.model_dump(),
            "extracted": extracted.model_dump(),
            "decision": decision.model_dump(),
            "extraction_accuracy": ext_eval,
            "decision_eval": dec_eval,
        }


def main():
    ap = argparse.ArgumentParser(description="Receipt Reconciliation Mystery")
    ap.add_argument("--n", type=int, default=1, help="number of receipts")
    ap.add_argument("--split", default="test", help="CORD split (train/validation/test)")
    ap.add_argument("--inconsistency", choices=INCONSISTENCY_TYPES, default=None,
                    help="force a specific injected inconsistency (default: random)")
    ap.add_argument("--seed", type=int, default=None, help="seed for claim generation")
    ap.add_argument("--mock", action="store_true",
                    help="skip Mistral; use ground truth in place of OCR")
    ap.add_argument("--out", default=None, help="write results JSON to this path")
    args = ap.parse_args()

    lf = langfuse_client()
    tracing = not getattr(lf, "__class__", type(None)).__name__.startswith("_Noop")
    print(f"Langfuse tracing: {'ON' if tracing else 'OFF (no keys — running local)'}")
    print(f"OCR mode        : {'MOCK (ground truth)' if args.mock else 'LIVE (Mistral)'}")

    print("Loading CORD v2 samples...")
    records = load_samples(n=args.n, split=args.split)

    results = []
    for idx, rec in enumerate(records):
        # Offset the seed per receipt so a multi-receipt run exercises different
        # inconsistencies (when --inconsistency isn't pinned). Deterministic if --seed given.
        seed = None if args.seed is None else args.seed + idx
        results.append(run_one(rec, lf, args.inconsistency, seed, args.mock))

    try:
        lf.flush()
    except Exception:
        pass

    if args.out:
        with open(args.out, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nWrote results to {args.out}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
