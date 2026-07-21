"""Stable orchestration entrypoint shared by the CLI and the FastAPI wrapper."""

from dataclasses import asdict

from langfuse.api import ScoreDataType

from receipt_agent.checkers import CHECKERS
from receipt_agent.claims import generate_synthetic_claim
from receipt_agent.contracts import Decision, ExpenseClaim, ExtractedReceipt
from receipt_agent.decision_agent import apply_policy
from receipt_agent.ocr_agent import extract_receipt
from receipt_agent.tracing import get_langfuse


def reconcile(
    image_path: str,
    receipt_id: str,
    mock: bool = True,
    claim: ExpenseClaim | None = None,
    seed: int | None = None,
    force_inconsistency: str | None = None,
) -> Decision:
    """Run the full pipeline for a single receipt image against a claim.

    If `claim` is not provided, one is synthesized from the extracted receipt
    (seedable, optionally forcing a specific PLAN.md inconsistency).
    """
    langfuse = get_langfuse()

    with langfuse.start_as_current_observation(name="reconcile", input={"image_path": image_path, "receipt_id": receipt_id, "mock": mock}) as root:
        # OCR step
        model_name = "mistral-ocr-mock" if mock else "mistral-ocr-latest"
        with langfuse.start_as_current_observation(name="extract_receipt", as_type="generation", input=image_path, model=model_name) as ocr_span:
            receipt: ExtractedReceipt = extract_receipt(image_path, mock=mock)
            ocr_span.update(output=asdict(receipt))

        # Claim generation (if needed)
        if claim is None:
            claim = generate_synthetic_claim(receipt, receipt_id, seed=seed, force_inconsistency=force_inconsistency)

        # Checkers
        findings = []
        for checker in CHECKERS:
            with langfuse.start_as_current_observation(name=checker.__name__, as_type="span", input={"checker": checker.__name__}) as checker_span:
                finding = checker(claim, receipt)
                findings.append(finding)
                checker_span.update(output=asdict(finding))

        # Decision
        with langfuse.start_as_current_observation(name="decision", as_type="span", input={"findings_count": len(findings)}) as decision_span:
            decision = apply_policy(findings, receipt)
            decision_span.update(output=asdict(decision))

        # Scores
        has_mismatch = 1.0 if decision.decision != "approve" else 0.0
        root.score(name="has_mismatch", value=has_mismatch, data_type=ScoreDataType.NUMERIC)

        if claim.expected_decision is not None:
            decision_correct = 1.0 if decision.decision == claim.expected_decision else 0.0
            root.score(name="decision_correct", value=decision_correct, data_type=ScoreDataType.NUMERIC)

        root.update(output=asdict(decision))

    langfuse.flush()
    return decision
