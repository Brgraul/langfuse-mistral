"""Seedable synthetic expense claim generator, injecting one PLAN.md inconsistency."""

import random
from dataclasses import replace

from receipt_agent.contracts import ExpenseClaim, ExtractedReceipt

INCONSISTENCY_KINDS = [
    "total_mismatch",
    "cash_price_confusion",
    "change_claimed_as_expense",
    "tax_doubled",
    "tax_omitted",
    "discount_ignored",
    "non_reimbursable_item",
]


def generate_synthetic_claim(
    receipt: ExtractedReceipt,
    receipt_id: str,
    seed: int | None = None,
    force_inconsistency: str | None = None,
) -> ExpenseClaim:
    rng = random.Random(seed)
    inconsistency = force_inconsistency or rng.choice(INCONSISTENCY_KINDS + [None])

    claim = ExpenseClaim(
        claim_id=f"CLM-{rng.randint(1000, 9999)}",
        receipt_id=receipt_id,
        claimant="J. Doe",
        claimed_amount=receipt.total,
        claimed_items=[replace(item) for item in receipt.items],
        claimed_tax=receipt.tax,
        claimed_discount=receipt.discount,
        payment_method=receipt.payment_method,
        policy_category="meals",
        injected_inconsistency=inconsistency,
        expected_decision="approve",
    )

    if inconsistency == "total_mismatch":
        claim.claimed_amount = round(receipt.total * 1.1, 2)
        claim.expected_decision = "reject"
    elif inconsistency == "cash_price_confusion":
        claim.claimed_amount = receipt.cash_price
        claim.expected_decision = "partial"
    elif inconsistency == "change_claimed_as_expense":
        claim.claimed_amount = receipt.total + receipt.change
        claim.expected_decision = "partial"
    elif inconsistency == "tax_doubled":
        claim.claimed_tax = receipt.tax * 2
        claim.claimed_amount = receipt.total + receipt.tax
        claim.expected_decision = "partial"
    elif inconsistency == "tax_omitted":
        claim.claimed_tax = 0.0
        claim.claimed_amount = receipt.total - receipt.tax
        claim.expected_decision = "partial"
    elif inconsistency == "discount_ignored":
        claim.claimed_discount = 0.0
        claim.claimed_amount = receipt.total + receipt.discount
        claim.expected_decision = "partial"
    elif inconsistency == "non_reimbursable_item":
        claim.policy_category = "alcohol"
        claim.expected_decision = "partial"

    return claim
