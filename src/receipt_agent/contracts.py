"""Shared data contracts, mirroring PLAN.md exactly."""

from dataclasses import dataclass, field
from typing import Literal


@dataclass
class ReceiptItem:
    name: str
    qty: float
    unit_price: float
    price: float


@dataclass
class ExtractedReceipt:
    merchant: str
    items: list[ReceiptItem]
    subtotal: float
    tax: float
    discount: float
    total: float
    payment_method: str
    cash_price: float
    change: float


@dataclass
class ExpenseClaim:
    claim_id: str
    receipt_id: str
    claimant: str
    claimed_amount: float
    claimed_items: list[ReceiptItem]
    claimed_tax: float
    claimed_discount: float
    payment_method: str
    policy_category: str
    injected_inconsistency: str | None = None
    expected_decision: str | None = None


@dataclass
class Finding:
    checker_name: str
    passed: bool
    mismatched_field: str | None
    policy_rule: str | None
    detail: str
    severity: Literal["info", "warn", "block"]


@dataclass
class Decision:
    decision: Literal["approve", "partial", "reject", "escalate"]
    reimbursable_amount: float
    mismatched_field: str | None
    policy_rule: str | None
    evidence_needed: str | None
    rationale: str
    findings: list[Finding] = field(default_factory=list)
