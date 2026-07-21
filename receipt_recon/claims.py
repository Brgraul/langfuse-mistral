"""Synthetic expense claim generator (Person C).

Builds an ExpenseClaim that references a ReceiptRecord and — for most inconsistency
types — deliberately disagrees with it. The inconsistency is chosen randomly but is
*seedable*, and can be forced via `inconsistency=` so the demo shows a clean, known case.

Each generated claim carries `injected_inconsistency` and `expected_decision` for
scoring the decision engine (Person D).
"""

from __future__ import annotations

import random
from typing import List, Optional

from .schemas import ExpenseClaim, ExtractedReceipt, LineItem

# The inconsistency types we can inject. "none" produces a faithful claim.
INCONSISTENCY_TYPES = [
    "none",                 # faithful claim -> approve
    "amount_mismatch",      # claimed_amount inflated
    "claimed_cash_tendered",  # uses cash tendered instead of total
    "change_claimed",       # adds the change back on top
    "tax_doubled",          # claims tax twice
    "pre_discount_price",   # ignores discount
    "non_reimbursable_item",  # injects an alcohol line item
]

# What the decision SHOULD be for each injected inconsistency (for eval).
EXPECTED_DECISION = {
    "none": "approve",
    "amount_mismatch": "partial",
    "claimed_cash_tendered": "partial",
    "change_claimed": "partial",
    "tax_doubled": "partial",
    "pre_discount_price": "partial",
    "non_reimbursable_item": "reject",
}


def _copy_items(items: List[LineItem]) -> List[LineItem]:
    return [i.model_copy(deep=True) for i in items]


def generate_claim(
    receipt_id: str,
    receipt: ExtractedReceipt,
    inconsistency: Optional[str] = None,
    seed: Optional[int] = None,
    claimant: str = "employee@example.com",
) -> ExpenseClaim:
    """Create a synthetic claim against `receipt`.

    Args:
        inconsistency: one of INCONSISTENCY_TYPES, or None to pick randomly.
        seed: makes the random pick + jitter deterministic.
    """
    rng = random.Random(seed)
    if inconsistency is None:
        inconsistency = rng.choice(INCONSISTENCY_TYPES)
    if inconsistency not in INCONSISTENCY_TYPES:
        raise ValueError(f"Unknown inconsistency: {inconsistency}")

    total = receipt.total or 0.0
    tax = receipt.tax or 0.0
    discount = receipt.discount or 0.0
    items = _copy_items(receipt.items)

    claimed_amount = total
    claimed_tax = tax
    claimed_discount = discount
    note = "Faithful claim matching the receipt."

    if inconsistency == "amount_mismatch":
        claimed_amount = round(total + max(total * 0.15, 5_000), 2)
        note = "Employee claimed more than the receipt total."

    elif inconsistency == "claimed_cash_tendered":
        if receipt.cash_price:
            claimed_amount = receipt.cash_price
            note = "Employee claimed the cash tendered, not the amount owed."
        else:  # fall back to an inflated amount if receipt has no cash tendered
            claimed_amount = round(total + 10_000, 2)
            note = "Employee claimed cash tendered (approximated)."

    elif inconsistency == "change_claimed":
        change = receipt.change or round(total * 0.1, 2)
        claimed_amount = round(total + change, 2)
        note = "Employee added the change back on top of the total."

    elif inconsistency == "tax_doubled":
        claimed_tax = round(tax * 2, 2)
        claimed_amount = round(total + tax, 2)
        note = "Employee claimed tax twice."

    elif inconsistency == "pre_discount_price":
        claimed_discount = 0.0
        claimed_amount = round(total + abs(discount), 2) if discount else round(total * 1.1, 2)
        note = "Employee claimed the pre-discount price."

    elif inconsistency == "non_reimbursable_item":
        beer = LineItem(name="Bintang Beer", qty=1, unit_price=25_000, price=25_000)
        items.append(beer)
        claimed_amount = round(total + 25_000, 2)
        note = "Claim includes a non-reimbursable alcohol item."

    category = rng.choice(["meals", "transport", "office_supplies", "client_meeting"])

    return ExpenseClaim(
        claim_id=f"claim-{receipt_id}-{inconsistency}",
        receipt_id=receipt_id,
        claimant=claimant,
        claimed_amount=round(claimed_amount, 2),
        claimed_items=items,
        claimed_tax=claimed_tax,
        claimed_discount=claimed_discount,
        payment_method=receipt.payment_method or "card",
        policy_category=category,
        note=note,
        injected_inconsistency=inconsistency,
        expected_decision=EXPECTED_DECISION[inconsistency],
    )
