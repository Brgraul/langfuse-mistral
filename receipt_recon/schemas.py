"""Shared data contracts for the whole team.

THIS FILE IS THE INTERFACE between the four workstreams. Agree changes with the
group before editing — everyone builds against these shapes.

    Person A (data/infra)  -> produces `ReceiptRecord` (image + normalized ground truth)
    Person B (OCR)         -> produces `ExtractedReceipt` from an image
    Person C (claims)      -> produces `ExpenseClaim` + owns `POLICY_RULES`
    Person D (decision)    -> consumes ExtractedReceipt + ExpenseClaim -> `Decision`
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Line item — shared by receipts and claims
# --------------------------------------------------------------------------- #
class LineItem(BaseModel):
    name: str
    qty: float = 1.0
    unit_price: float = 0.0
    price: float = 0.0  # line total actually paid (qty * unit_price, post item-discount)


# --------------------------------------------------------------------------- #
# ExtractedReceipt — the normalized receipt shape.
# Both the OCR output (Person B) and the CORD ground truth (Person A) use this,
# so Person D can compare them field-for-field.
# --------------------------------------------------------------------------- #
class ExtractedReceipt(BaseModel):
    merchant: Optional[str] = None
    items: List[LineItem] = Field(default_factory=list)
    subtotal: Optional[float] = None      # sum of line items before tax
    tax: Optional[float] = None
    discount: Optional[float] = None      # total discount applied
    total: Optional[float] = None         # amount actually owed/paid
    payment_method: Optional[str] = None  # e.g. "cash", "card"
    cash_price: Optional[float] = None     # cash tendered (may exceed total)
    change: Optional[float] = None

    # Provenance / debugging
    raw_ocr_text: Optional[str] = None
    source: Optional[str] = None          # "mistral-ocr" | "ground_truth" | "mock"


# --------------------------------------------------------------------------- #
# ExpenseClaim — synthetic, deliberately may disagree with the receipt.
# --------------------------------------------------------------------------- #
class ExpenseClaim(BaseModel):
    claim_id: str
    receipt_id: str                        # which ReceiptRecord this references
    claimant: str = "employee@example.com"
    claimed_amount: float = 0.0            # what the employee wants reimbursed
    claimed_items: List[LineItem] = Field(default_factory=list)
    claimed_tax: Optional[float] = None
    claimed_discount: Optional[float] = None
    payment_method: Optional[str] = None
    policy_category: str = "meals"         # meals | transport | office_supplies | client_meeting
    note: Optional[str] = None

    # For evaluation only — the inconsistency intentionally injected (or None).
    injected_inconsistency: Optional[str] = None
    expected_decision: Optional[str] = None  # ground-truth label for scoring Person D


# --------------------------------------------------------------------------- #
# ReceiptRecord — one CORD sample: image bytes + normalized ground truth.
# --------------------------------------------------------------------------- #
class ReceiptRecord(BaseModel):
    receipt_id: str
    image_path: str                        # local path to the saved image
    ground_truth: ExtractedReceipt

    class Config:
        arbitrary_types_allowed = True


# --------------------------------------------------------------------------- #
# Decision — the final reimbursement verdict (Person D).
# --------------------------------------------------------------------------- #
VALID_DECISIONS = ("approve", "partial", "reject", "escalate")


class Decision(BaseModel):
    decision: str                          # one of VALID_DECISIONS
    reimbursable_amount: float = 0.0
    mismatched_field: Optional[str] = None  # e.g. "total", "tax", "change"
    policy_rule: Optional[str] = None       # id from POLICY_RULES that was triggered
    evidence_needed: Optional[str] = None
    rationale: str = ""
