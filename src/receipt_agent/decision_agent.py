"""Deterministic policy engine: findings -> Decision."""

from receipt_agent.contracts import Decision, ExtractedReceipt, Finding


def apply_policy(findings: list[Finding], receipt: ExtractedReceipt) -> Decision:
    blocking = [f for f in findings if not f.passed and f.severity == "block"]
    warnings = [f for f in findings if not f.passed and f.severity == "warn"]

    if not blocking and not warnings:
        return Decision(
            decision="approve",
            reimbursable_amount=receipt.total,
            mismatched_field=None,
            policy_rule=None,
            evidence_needed=None,
            rationale="Claim matches receipt on all checks.",
            findings=findings,
        )

    if not blocking and warnings:
        primary = warnings[0]
        return Decision(
            decision="escalate",
            reimbursable_amount=receipt.total,
            mismatched_field=primary.mismatched_field,
            policy_rule=primary.policy_rule,
            evidence_needed="Receipt itself is internally inconsistent; needs manual review before reimbursement.",
            rationale=primary.detail,
            findings=findings,
        )

    primary = blocking[0]
    return Decision(
        decision="partial" if len(blocking) == 1 else "reject",
        reimbursable_amount=receipt.total,
        mismatched_field=primary.mismatched_field,
        policy_rule=primary.policy_rule,
        evidence_needed=f"Corrected claim amount and justification for: {primary.mismatched_field}",
        rationale=primary.detail,
        findings=findings,
    )
