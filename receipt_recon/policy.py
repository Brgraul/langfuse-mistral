"""Reimbursement policy ruleset (Person C).

Small, explicit ruleset the decision engine (Person D) checks against. Each rule has
an id, a human description, and — where relevant — the decision it drives.
"""

from __future__ import annotations

# Non-reimbursable item keywords (case-insensitive substring match on item name).
NON_REIMBURSABLE_KEYWORDS = [
    "alcohol", "beer", "wine", "liquor", "cigarette", "tobacco", "vodka", "soju",
]

# Category spend caps (per claim), in the receipt's currency units.
CATEGORY_CAPS = {
    "meals": 50_000,
    "transport": 100_000,
    "office_supplies": 200_000,
    "client_meeting": 300_000,
}

# Absolute amount above which a claim must be escalated for manager sign-off.
ESCALATION_THRESHOLD = 250_000

# Tolerance for float comparisons on money. The effective tolerance is
# max(AMOUNT_TOLERANCE, RELATIVE_TOLERANCE * amount) so it scales with receipt size.
AMOUNT_TOLERANCE = 0.01
RELATIVE_TOLERANCE = 0.005  # 0.5%

POLICY_RULES = {
    "AMOUNT_MISMATCH": "Claimed amount does not match the receipt total.",
    "CLAIMED_CASH_TENDERED": "Claim uses cash tendered instead of the actual total paid.",
    "CHANGE_CLAIMED": "Change returned to the customer was claimed as an expense.",
    "SUBTOTAL_MISMATCH": "Line items do not add up to the receipt subtotal.",
    "TAX_MISMATCH": "Claimed tax is doubled, omitted, or otherwise inconsistent.",
    "PRE_DISCOUNT_PRICE": "A discounted item was claimed at its pre-discount price.",
    "NON_REIMBURSABLE_ITEM": "Receipt contains an item not reimbursable under policy.",
    "OVER_CATEGORY_CAP": "Claim exceeds the spend cap for its expense category.",
    "OVER_ESCALATION_THRESHOLD": "Amount exceeds the auto-approval threshold; needs sign-off.",
    "MISSING_EVIDENCE": "Required field could not be read from the receipt.",
}


def is_non_reimbursable(item_name: str) -> bool:
    low = (item_name or "").lower()
    return any(kw in low for kw in NON_REIMBURSABLE_KEYWORDS)


def category_cap(category: str):
    return CATEGORY_CAPS.get(category)
