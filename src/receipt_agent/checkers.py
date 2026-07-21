"""Independent, individually-testable checkers — one per PLAN.md inconsistency."""

from receipt_agent.contracts import ExpenseClaim, ExtractedReceipt, Finding

_TOLERANCE = 0.01

# Items considered non-reimbursable under the (toy) expense policy.
NON_REIMBURSABLE_KEYWORDS = ("beer", "wine", "alcohol", "cigarette", "lottery")


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= _TOLERANCE


def check_total_matches(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Finding:
    if _close(claim.claimed_amount, receipt.total):
        return Finding("check_total_matches", True, None, None, "claimed amount matches receipt total", "info")
    return Finding(
        "check_total_matches",
        False,
        "total",
        "policy:claimed-amount-must-equal-total",
        f"claimed {claim.claimed_amount} != receipt total {receipt.total}",
        "block",
    )


def check_cash_price_confusion(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Finding:
    if _close(claim.claimed_amount, receipt.cash_price) and not _close(receipt.cash_price, receipt.total):
        return Finding(
            "check_cash_price_confusion",
            False,
            "cash_price",
            "policy:reimburse-actual-total-not-cash-tendered",
            f"claim uses cash tendered ({receipt.cash_price}) instead of actual total ({receipt.total})",
            "block",
        )
    return Finding("check_cash_price_confusion", True, None, None, "claim does not use cash tendered amount", "info")


def check_change_claimed_as_expense(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Finding:
    if receipt.change > 0 and _close(claim.claimed_amount, receipt.total + receipt.change):
        return Finding(
            "check_change_claimed_as_expense",
            False,
            "change",
            "policy:change-is-not-reimbursable",
            f"claimed amount appears to include change of {receipt.change}",
            "block",
        )
    return Finding("check_change_claimed_as_expense", True, None, None, "change not included in claim", "info")


def check_items_sum_to_subtotal(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Finding:
    item_sum = sum(item.price for item in receipt.items)
    if _close(item_sum, receipt.subtotal):
        return Finding("check_items_sum_to_subtotal", True, None, None, "item prices sum to subtotal", "info")
    return Finding(
        "check_items_sum_to_subtotal",
        False,
        "subtotal",
        "policy:receipt-internally-consistent",
        f"item prices sum to {item_sum} but subtotal is {receipt.subtotal}",
        "warn",
    )


def check_tax_handling(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Finding:
    if _close(claim.claimed_tax, receipt.tax):
        return Finding("check_tax_handling", True, None, None, "claimed tax matches receipt tax", "info")

    if _close(claim.claimed_tax, receipt.tax * 2):
        detail = f"claimed tax {claim.claimed_tax} looks like tax counted twice (receipt tax {receipt.tax})"
    elif _close(claim.claimed_tax, 0.0) and receipt.tax > 0:
        detail = f"claimed tax is 0 but receipt tax is {receipt.tax} (tax omitted)"
    else:
        detail = f"claimed tax {claim.claimed_tax} != receipt tax {receipt.tax}"

    return Finding("check_tax_handling", False, "tax", "policy:tax-must-match-receipt", detail, "block")


def check_discount_precedence(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Finding:
    if receipt.discount <= 0:
        return Finding("check_discount_precedence", True, None, None, "no discount on receipt", "info")
    if _close(claim.claimed_discount, receipt.discount):
        return Finding("check_discount_precedence", True, None, None, "claimed discount matches receipt discount", "info")
    return Finding(
        "check_discount_precedence",
        False,
        "discount",
        "policy:claim-must-reflect-discounted-price",
        f"claimed discount {claim.claimed_discount} != receipt discount {receipt.discount} "
        "(item may be claimed at pre-discount price)",
        "block",
    )


def check_non_reimbursable_items(claim: ExpenseClaim, receipt: ExtractedReceipt) -> Finding:
    flagged = [
        item.name
        for item in receipt.items
        if any(keyword in item.name.lower() for keyword in NON_REIMBURSABLE_KEYWORDS)
    ]
    if not flagged:
        return Finding("check_non_reimbursable_items", True, None, None, "no non-reimbursable items found", "info")
    return Finding(
        "check_non_reimbursable_items",
        False,
        "items",
        "policy:non-reimbursable-item-category",
        f"receipt contains non-reimbursable item(s): {', '.join(flagged)}",
        "block",
    )


CHECKERS = [
    check_total_matches,
    check_cash_price_confusion,
    check_change_claimed_as_expense,
    check_items_sum_to_subtotal,
    check_tax_handling,
    check_discount_precedence,
    check_non_reimbursable_items,
]
