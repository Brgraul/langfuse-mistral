"""Comparison + reimbursement decision engine (Person D).

Deterministic, auditable rule engine: compares an ExpenseClaim against the
ExtractedReceipt, applies the policy ruleset, and emits a Decision with the
reimbursable amount, the mismatched field, the triggered policy rule, any
evidence still needed, and a structured list of Findings (one per check that
fired) carrying the exact numbers involved, for a detailed audit trail /ui.

Kept rule-based (not LLM) on purpose so the verdict is explainable and reproducible
for a finance audit. The LLM does the reading (OCR/extraction); the money decision
is deterministic.
"""

from __future__ import annotations

from typing import List, Optional

from . import policy
from .schemas import Decision, ExpenseClaim, ExtractedReceipt, Finding, FindingItem

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


def _field_for_rule(rule: str) -> Optional[str]:
    return {
        "AMOUNT_MISMATCH": "total",
        "CLAIMED_CASH_TENDERED": "cash_price",
        "CHANGE_CLAIMED": "change",
        "TAX_MISMATCH": "tax",
        "PRE_DISCOUNT_PRICE": "discount",
    }.get(rule)


def reconcile(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Decision:
    """Compare claim vs receipt and return a reimbursement Decision."""
    findings: List[Finding] = []
    receipt_total = receipt.total

    # --- 1. Non-reimbursable items (hard reject) ------------------------------
    bad_items = [i.name for i in claim.claimed_items if policy.is_non_reimbursable(i.name)]
    if bad_items:
        bad_total = round(
            sum(i.price or 0.0 for i in claim.claimed_items if policy.is_non_reimbursable(i.name)), 2
        )
        findings.append(
            Finding(
                type="policy_items",
                rule="NON_REIMBURSABLE_ITEM",
                severity="block",
                detail=f"non-reimbursable item(s): {', '.join(bad_items)}",
                impact=bad_total,
                items=[
                    FindingItem(
                        label=i.name,
                        price=i.price or 0.0,
                        blocked=policy.is_non_reimbursable(i.name),
                        policy_code="NON_REIMBURSABLE_ITEM" if policy.is_non_reimbursable(i.name) else None,
                    )
                    for i in claim.claimed_items
                ],
            )
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
            findings=[
                Finding(
                    type="missing_evidence",
                    rule="MISSING_EVIDENCE",
                    severity="block",
                    detail="Receipt total could not be read.",
                    impact=0.0,
                )
            ],
        )

    # --- 3. Internal receipt consistency: items vs subtotal ------------------
    # Only flag when items sum to MORE than the subtotal — that can't be explained
    # by OCR missing a line. Under-summing almost always means OCR dropped an item,
    # which is an extraction-quality issue (surfaced by extraction_accuracy), not a
    # reason to escalate the reimbursement decision.
    if receipt.subtotal is not None and receipt.items:
        items_sum = _sum_items(receipt.items)
        if items_sum > receipt.subtotal and not _approx(items_sum, receipt.subtotal):
            delta = round(items_sum - receipt.subtotal, 2)
            findings.append(
                Finding(
                    type="subtotal_math",
                    rule="SUBTOTAL_MISMATCH",
                    severity="warn",
                    detail=f"line items sum to {items_sum} vs subtotal {receipt.subtotal}",
                    impact=delta,
                    items=[FindingItem(label=i.name, price=i.price or 0.0) for i in receipt.items],
                    printed_subtotal=receipt.subtotal,
                )
            )

    # --- 4. Claim amount vs receipt total ------------------------------------
    over_claim = round((claim.claimed_amount or 0.0) - receipt_total, 2)
    money_finding: Optional[Finding] = None
    if not _approx(claim.claimed_amount, receipt_total):
        # Diagnose *why* the amount is off, most specific first.
        if receipt.cash_price is not None and _approx(claim.claimed_amount, receipt.cash_price):
            money_finding = Finding(
                type="cashprice_used",
                rule="CLAIMED_CASH_TENDERED",
                severity="block",
                detail=f"claimed {claim.claimed_amount} = cash tendered, but total owed is {receipt_total}",
                impact=round(claim.claimed_amount - receipt_total, 2),
                receipt_total=receipt_total,
                cash_price=receipt.cash_price,
                claimed_amount=claim.claimed_amount,
            )
        elif receipt.change and _approx(claim.claimed_amount, receipt_total + receipt.change):
            money_finding = Finding(
                type="change_as_expense",
                rule="CHANGE_CLAIMED",
                severity="block",
                detail=f"claimed {claim.claimed_amount} = total {receipt_total} + change {receipt.change}",
                impact=receipt.change,
                amount_tendered=claim.claimed_amount,
                receipt_total=receipt_total,
                change=receipt.change,
            )
        elif receipt.tax and _approx(claim.claimed_amount, receipt_total + receipt.tax):
            money_finding = Finding(
                type="tax_error",
                rule="TAX_MISMATCH",
                severity="warn",
                detail=f"claimed {claim.claimed_amount} includes tax {receipt.tax} twice",
                impact=receipt.tax,
                tax_mode="double",
                printed_tax=receipt.tax,
                claimed_tax=claim.claimed_tax,
                tax_rate=(receipt.tax / receipt.subtotal) if receipt.subtotal else None,
                subtotal=receipt.subtotal,
            )
        elif receipt.discount and _approx(claim.claimed_amount, receipt_total + abs(receipt.discount)):
            money_finding = Finding(
                type="discount_ignored",
                rule="PRE_DISCOUNT_PRICE",
                severity="warn",
                detail=f"claimed {claim.claimed_amount} ignores discount {receipt.discount}",
                impact=abs(receipt.discount),
                item_name=receipt.items[0].name if receipt.items else "item",
                list_price=round(receipt_total + abs(receipt.discount), 2),
                discount=abs(receipt.discount),
                net_price=receipt_total,
                claimed_price=claim.claimed_amount,
            )
        else:
            money_finding = Finding(
                type="total_mismatch",
                rule="AMOUNT_MISMATCH",
                severity="block",
                detail=f"claimed {claim.claimed_amount} vs receipt total {receipt_total} (delta {over_claim})",
                impact=abs(over_claim),
                claimed_total=claim.claimed_amount,
                receipt_total=receipt_total,
            )
        findings.append(money_finding)

    # --- 5. Tax field sanity (independent of amount) -------------------------
    if claim.claimed_tax is not None and receipt.tax is not None:
        already_flagged = money_finding is not None and money_finding.rule == "TAX_MISMATCH"
        if not _approx(claim.claimed_tax, receipt.tax) and not already_flagged:
            findings.append(
                Finding(
                    type="tax_error",
                    rule="TAX_MISMATCH",
                    severity="warn",
                    detail=f"claimed tax {claim.claimed_tax} vs receipt tax {receipt.tax}",
                    impact=round(abs(claim.claimed_tax - receipt.tax), 2),
                    tax_mode="double" if claim.claimed_tax > receipt.tax else "missing",
                    printed_tax=receipt.tax,
                    claimed_tax=claim.claimed_tax,
                    tax_rate=(receipt.tax / receipt.subtotal) if receipt.subtotal else None,
                subtotal=receipt.subtotal,
                )
            )

    # --- 6. Category cap -----------------------------------------------------
    cap = policy.category_cap(claim.policy_category)
    if cap is not None and receipt_total > cap:
        findings.append(
            Finding(
                type="over_category_cap",
                rule="OVER_CATEGORY_CAP",
                severity="warn",
                detail=f"receipt total {receipt_total} exceeds {claim.policy_category} cap {cap}",
                impact=round(receipt_total - cap, 2),
                receipt_total=receipt_total,
                cap=cap,
            )
        )

    # ------------------------------------------------------------------------ #
    # Resolve findings into a decision.
    # ------------------------------------------------------------------------ #
    reimbursable = min(claim.claimed_amount or 0.0, receipt_total)

    # Hard reject: non-reimbursable content on the receipt.
    non_reimbursable = next((f for f in findings if f.rule == "NON_REIMBURSABLE_ITEM"), None)
    if non_reimbursable is not None:
        return Decision(
            decision="reject",
            reimbursable_amount=0.0,
            mismatched_field="items",
            policy_rule=non_reimbursable.rule,
            evidence_needed="Itemized receipt excluding non-reimbursable items, or a separate compliant claim.",
            rationale=f"Rejected: {policy.POLICY_RULES[non_reimbursable.rule]} ({non_reimbursable.detail}).",
            findings=findings,
        )

    # Escalate: total is large, or receipt is internally inconsistent.
    if receipt_total > policy.ESCALATION_THRESHOLD:
        findings.append(
            Finding(
                type="escalation_threshold",
                rule="OVER_ESCALATION_THRESHOLD",
                severity="block",
                detail=f"amount {receipt_total} exceeds threshold {policy.ESCALATION_THRESHOLD}",
                impact=round(receipt_total - policy.ESCALATION_THRESHOLD, 2),
                receipt_total=receipt_total,
                cap=policy.ESCALATION_THRESHOLD,
            )
        )
        return Decision(
            decision="escalate",
            reimbursable_amount=reimbursable,
            mismatched_field=findings[0].rule if findings else None,
            policy_rule="OVER_ESCALATION_THRESHOLD",
            evidence_needed="Manager sign-off for high-value expense.",
            rationale=(
                f"Amount {receipt_total} exceeds auto-approval threshold "
                f"{policy.ESCALATION_THRESHOLD}; manager approval required."
            ),
            findings=findings,
        )

    subtotal_finding = next((f for f in findings if f.rule == "SUBTOTAL_MISMATCH"), None)
    if subtotal_finding is not None:
        return Decision(
            decision="escalate",
            reimbursable_amount=reimbursable,
            mismatched_field="subtotal",
            policy_rule=subtotal_finding.rule,
            evidence_needed="Clarification from finance — receipt line items don't reconcile to its subtotal.",
            rationale=f"Escalated: {policy.POLICY_RULES[subtotal_finding.rule]} ({subtotal_finding.detail}).",
            findings=findings,
        )

    # Partial: claim overstates the reimbursable amount.
    money_rules = ("AMOUNT_MISMATCH", "CLAIMED_CASH_TENDERED", "CHANGE_CLAIMED", "TAX_MISMATCH", "PRE_DISCOUNT_PRICE")
    money_findings = [f for f in findings if f.rule in money_rules]
    if money_findings and over_claim > TOL:
        primary = money_findings[0]
        return Decision(
            decision="partial",
            reimbursable_amount=round(reimbursable, 2),
            mismatched_field=_field_for_rule(primary.rule),
            policy_rule=primary.rule,
            evidence_needed="None — reimburse the verified receipt total; notify claimant of the adjustment.",
            rationale=(
                f"Partially approved: {policy.POLICY_RULES[primary.rule]} ({primary.detail}). "
                f"Reimbursing verified total {receipt_total}, not claimed {claim.claimed_amount}."
            ),
            findings=findings,
        )

    # Claim is under/equal the total and otherwise clean.
    if money_findings and over_claim < -TOL:
        # Claimant asked for less than they could — approve what they asked.
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
            findings=findings,
        )

    return Decision(
        decision="approve",
        reimbursable_amount=round(reimbursable, 2),
        mismatched_field=None,
        policy_rule=None,
        evidence_needed=None,
        rationale=f"Approved: claim matches the verified receipt total ({receipt_total}).",
        findings=findings,
    )
