"""Comparison + reimbursement decision engine (Person D).

Deterministic, auditable rule engine: compares an ExpenseClaim against the
ExtractedReceipt, applies the policy ruleset, and emits a Decision with the
reimbursable amount, the mismatched field, the triggered policy rule, and any
evidence still needed.

Kept rule-based (not LLM) on purpose so the verdict is explainable and reproducible
for a finance audit. The LLM does the reading (OCR/extraction); the money decision
is deterministic.
"""

from __future__ import annotations

from typing import List, Tuple

from . import policy
from .schemas import Decision, ExpenseClaim, ExtractedReceipt

TOL = policy.AMOUNT_TOLERANCE


def _approx(a, b) -> bool:
    """Money-equal within tolerance. Tolerance is scale-relative so it works for both
    small totals (e.g. 60.00) and large rupiah amounts (e.g. 91,000) — a flat window
    would be huge for the former and cause coincidental rule matches."""
    if a is None or b is None:
        return False
    tol = max(TOL, policy.RELATIVE_TOLERANCE * max(abs(a), abs(b)))
    return abs(a - b) <= tol


def _sum_items(items) -> float:
    return round(sum((i.price or 0.0) for i in items), 2)


def reconcile(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Decision:
    """Compare claim vs receipt and return a reimbursement Decision."""
    findings: List[Tuple[str, str]] = []  # (rule_id, detail)
    receipt_total = receipt.total

    # --- 1. Non-reimbursable items (hard reject) ------------------------------
    bad_items = [i.name for i in claim.claimed_items if policy.is_non_reimbursable(i.name)]
    if bad_items:
        findings.append(
            ("NON_REIMBURSABLE_ITEM", f"non-reimbursable item(s): {', '.join(bad_items)}")
        )

    # --- 2. Missing evidence (can't read the total) --------------------------
    if receipt_total is None:
        return Decision(
            decision="escalate",
            reimbursable_amount=0.0,
            mismatched_field="total",
            policy_rule="MISSING_EVIDENCE",
            evidence_needed="Legible receipt total — OCR could not extract it.",
            rationale="Receipt total could not be read; cannot verify the claim.",
        )

    # --- 3. Internal receipt consistency: items vs subtotal ------------------
    # Only flag when items sum to MORE than the subtotal — that can't be explained
    # by OCR missing a line. Under-summing almost always means OCR dropped an item,
    # which is an extraction-quality issue (surfaced by extraction_accuracy), not a
    # reason to escalate the reimbursement decision.
    if receipt.subtotal is not None and receipt.items:
        items_sum = _sum_items(receipt.items)
        if items_sum > receipt.subtotal and not _approx(items_sum, receipt.subtotal):
            findings.append(
                (
                    "SUBTOTAL_MISMATCH",
                    f"line items sum to {items_sum} vs subtotal {receipt.subtotal}",
                )
            )

    # --- 4. Claim amount vs receipt total ------------------------------------
    over_claim = round((claim.claimed_amount or 0.0) - receipt_total, 2)
    if not _approx(claim.claimed_amount, receipt_total):
        # Diagnose *why* the amount is off, most specific first.
        if receipt.cash_price is not None and _approx(claim.claimed_amount, receipt.cash_price):
            findings.append(
                ("CLAIMED_CASH_TENDERED",
                 f"claimed {claim.claimed_amount} = cash tendered, but total owed is {receipt_total}")
            )
        elif receipt.change and _approx(claim.claimed_amount, receipt_total + receipt.change):
            findings.append(
                ("CHANGE_CLAIMED",
                 f"claimed {claim.claimed_amount} = total {receipt_total} + change {receipt.change}")
            )
        elif receipt.tax and _approx(claim.claimed_amount, receipt_total + receipt.tax):
            findings.append(
                ("TAX_MISMATCH",
                 f"claimed {claim.claimed_amount} includes tax {receipt.tax} twice")
            )
        elif receipt.discount and _approx(claim.claimed_amount, receipt_total + abs(receipt.discount)):
            findings.append(
                ("PRE_DISCOUNT_PRICE",
                 f"claimed {claim.claimed_amount} ignores discount {receipt.discount}")
            )
        else:
            findings.append(
                ("AMOUNT_MISMATCH",
                 f"claimed {claim.claimed_amount} vs receipt total {receipt_total} (delta {over_claim})")
            )

    # --- 5. Tax field sanity (independent of amount) -------------------------
    if claim.claimed_tax is not None and receipt.tax is not None:
        if not _approx(claim.claimed_tax, receipt.tax) and not any(
            f[0] == "TAX_MISMATCH" for f in findings
        ):
            findings.append(
                ("TAX_MISMATCH",
                 f"claimed tax {claim.claimed_tax} vs receipt tax {receipt.tax}")
            )

    # --- 6. Category cap -----------------------------------------------------
    cap = policy.category_cap(claim.policy_category)
    if cap is not None and receipt_total > cap:
        findings.append(
            ("OVER_CATEGORY_CAP",
             f"receipt total {receipt_total} exceeds {claim.policy_category} cap {cap}")
        )

    # ------------------------------------------------------------------------ #
    # Resolve findings into a decision.
    # ------------------------------------------------------------------------ #
    reimbursable = min(claim.claimed_amount or 0.0, receipt_total)

    # Hard reject: non-reimbursable content on the receipt.
    if any(f[0] == "NON_REIMBURSABLE_ITEM" for f in findings):
        rule, detail = next(f for f in findings if f[0] == "NON_REIMBURSABLE_ITEM")
        return Decision(
            decision="reject",
            reimbursable_amount=0.0,
            mismatched_field="items",
            policy_rule=rule,
            evidence_needed="Itemized receipt excluding non-reimbursable items, or a separate compliant claim.",
            rationale=f"Rejected: {policy.POLICY_RULES[rule]} ({detail}).",
        )

    # Escalate: total is large, or receipt is internally inconsistent.
    if receipt_total > policy.ESCALATION_THRESHOLD:
        return Decision(
            decision="escalate",
            reimbursable_amount=reimbursable,
            mismatched_field=findings[0][0] if findings else None,
            policy_rule="OVER_ESCALATION_THRESHOLD",
            evidence_needed="Manager sign-off for high-value expense.",
            rationale=(
                f"Amount {receipt_total} exceeds auto-approval threshold "
                f"{policy.ESCALATION_THRESHOLD}; manager approval required."
            ),
        )
    if any(f[0] == "SUBTOTAL_MISMATCH" for f in findings):
        rule, detail = next(f for f in findings if f[0] == "SUBTOTAL_MISMATCH")
        return Decision(
            decision="escalate",
            reimbursable_amount=reimbursable,
            mismatched_field="subtotal",
            policy_rule=rule,
            evidence_needed="Clarification from finance — receipt line items don't reconcile to its subtotal.",
            rationale=f"Escalated: {policy.POLICY_RULES[rule]} ({detail}).",
        )

    # Partial: claim overstates the reimbursable amount.
    money_findings = [
        f for f in findings
        if f[0] in ("AMOUNT_MISMATCH", "CLAIMED_CASH_TENDERED", "CHANGE_CLAIMED",
                    "TAX_MISMATCH", "PRE_DISCOUNT_PRICE")
    ]
    if money_findings and over_claim > TOL:
        rule, detail = money_findings[0]
        return Decision(
            decision="partial",
            reimbursable_amount=round(reimbursable, 2),
            mismatched_field=_field_for_rule(rule),
            policy_rule=rule,
            evidence_needed="None — reimburse the verified receipt total; notify claimant of the adjustment.",
            rationale=(
                f"Partially approved: {policy.POLICY_RULES[rule]} ({detail}). "
                f"Reimbursing verified total {receipt_total}, not claimed {claim.claimed_amount}."
            ),
        )

    # Claim is under/equal the total and otherwise clean.
    if money_findings and over_claim < -TOL:
        # Claimant asked for less than they could — approve what they asked.
        rule, detail = money_findings[0]
        return Decision(
            decision="approve",
            reimbursable_amount=round(claim.claimed_amount, 2),
            mismatched_field=None,
            policy_rule=None,
            evidence_needed=None,
            rationale=(
                f"Approved: claim ({claim.claimed_amount}) is at or below the verified "
                f"receipt total ({receipt_total}); no overclaim."
            ),
        )

    return Decision(
        decision="approve",
        reimbursable_amount=round(reimbursable, 2),
        mismatched_field=None,
        policy_rule=None,
        evidence_needed=None,
        rationale=f"Approved: claim matches the verified receipt total ({receipt_total}).",
    )


def _field_for_rule(rule: str):
    return {
        "AMOUNT_MISMATCH": "total",
        "CLAIMED_CASH_TENDERED": "cash_price",
        "CHANGE_CLAIMED": "change",
        "TAX_MISMATCH": "tax",
        "PRE_DISCOUNT_PRICE": "discount",
    }.get(rule)
