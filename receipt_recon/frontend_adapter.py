"""Adapter: pipeline output -> the frontend `Claim` shape (Person A/integration).

The React app (src/routes/index.tsx) renders a `Claim` object. This maps our real
ExpenseClaim + ExtractedReceipt + Decision into that shape and writes it to
`src/data/claims.json`, and copies each receipt image into `public/receipts/` so the
frontend can display the actual CORD receipt (Vite serves public/ at the web root).

We emit only fields the pipeline genuinely produces. The frontend renders empty
`policies`/`evidence`/`findings` gracefully, so unmapped detail simply doesn't show.
"""

from __future__ import annotations

import json
import os
import shutil
from typing import Dict, List, Optional

from .decision import _approx  # scale-relative money comparison
from .schemas import Decision, ExpenseClaim, ExtractedReceipt

# our policy rule id -> frontend finding "type"
_RULE_TO_FINDING = {
    "AMOUNT_MISMATCH": "total_mismatch",
    "CLAIMED_CASH_TENDERED": "cashprice_used",
    "CHANGE_CLAIMED": "change_as_expense",
    "SUBTOTAL_MISMATCH": "subtotal_math",
    "TAX_MISMATCH": "tax_error",
    "PRE_DISCOUNT_PRICE": "discount_ignored",
    "NON_REIMBURSABLE_ITEM": "policy_items",
}


def _sum_items(items) -> float:
    return round(sum((i.price or 0.0) for i in items), 2)


def _row(label: str, claim_val, ocr_val, issue: Optional[str] = None) -> Dict:
    """One comparison row. Numbers compared with tolerance; strings by equality."""
    if isinstance(claim_val, (int, float)) and isinstance(ocr_val, (int, float)):
        match = _approx(float(claim_val), float(ocr_val))
        claim_s, ocr_s = f"{claim_val:.2f}", f"{ocr_val:.2f}"
    else:
        claim_s = "—" if claim_val is None else str(claim_val)
        ocr_s = "—" if ocr_val is None else str(ocr_val)
        match = claim_val is not None and str(claim_val) == str(ocr_val)
    row = {"label": label, "claim": claim_s, "ocr": ocr_s, "match": match}
    if not match and issue:
        row["issue"] = issue
    return row


def _severity(decision: str) -> str:
    return {"reject": "block", "escalate": "warn", "partial": "warn"}.get(decision, "info")


def _build_finding(decision: Decision, claim: ExpenseClaim, receipt: ExtractedReceipt) -> Optional[Dict]:
    ftype = _RULE_TO_FINDING.get(decision.policy_rule or "")
    if not ftype:
        return None
    sev = _severity(decision.decision)
    impact = round((claim.claimed_amount or 0.0) - (decision.reimbursable_amount or 0.0), 2)
    total = receipt.total or 0.0

    if ftype == "total_mismatch":
        return {"type": ftype, "severity": sev, "impact": impact,
                "claimedTotal": claim.claimed_amount, "receiptTotal": total,
                "note": "Claim exceeds printed receipt total."}
    if ftype == "cashprice_used":
        return {"type": ftype, "severity": sev, "impact": impact,
                "totalPrice": total, "cashPrice": receipt.cash_price or claim.claimed_amount,
                "claimed": claim.claimed_amount}
    if ftype == "change_as_expense":
        change = receipt.change or impact
        return {"type": ftype, "severity": sev, "impact": impact,
                "amountTendered": claim.claimed_amount, "receiptTotal": total, "change": change}
    if ftype == "subtotal_math":
        return {"type": ftype, "severity": sev, "impact": impact,
                "items": [{"label": i.name or "item", "price": i.price or 0.0} for i in receipt.items],
                "printedSubtotal": receipt.subtotal or 0.0}
    if ftype == "tax_error":
        rate = round((receipt.tax or 0.0) / receipt.subtotal, 4) if receipt.subtotal else 0.0
        return {"type": ftype, "severity": sev, "impact": impact, "mode": "double",
                "subtotal": receipt.subtotal or 0.0, "rate": rate,
                "printedTax": receipt.tax or 0.0, "claimedTax": claim.claimed_tax or 0.0}
    if ftype == "discount_ignored":
        disc = receipt.discount or 0.0
        return {"type": ftype, "severity": sev, "impact": impact,
                "item": "Discounted item", "listPrice": total + disc, "discount": disc,
                "netPrice": total, "claimedPrice": claim.claimed_amount}
    if ftype == "policy_items":
        from .policy import is_non_reimbursable
        items = [{"label": i.name or "item", "price": i.price or 0.0,
                  "blocked": is_non_reimbursable(i.name),
                  **({"policyCode": "T&E-2.7 Alcohol"} if is_non_reimbursable(i.name) else {})}
                 for i in claim.claimed_items]
        return {"type": ftype, "severity": sev, "impact": impact, "items": items}
    return None


def to_frontend_claim(
    claim: ExpenseClaim, receipt: ExtractedReceipt, decision: Decision,
    submitted: str = "Jul 21, 2026", image_url: str = "",
) -> Dict:
    """Map one reconciliation into the frontend `Claim` object."""
    total = receipt.total or 0.0
    claim_subtotal = _sum_items(claim.claimed_items)

    lines: List[Dict] = [
        _row("Merchant", receipt.merchant or "—", receipt.merchant or "—"),
        _row("Subtotal", claim_subtotal, receipt.subtotal,
             issue="Line items don't sum to claimed subtotal"),
        _row("Tax", claim.claimed_tax, receipt.tax, issue="Claimed tax differs from receipt"),
        _row("Discount", claim.claimed_discount, receipt.discount,
             issue="Discount not applied to the claim"),
        _row("Total", claim.claimed_amount, total, issue="Claim total differs from receipt"),
        _row("Payment", claim.payment_method, receipt.payment_method),
    ]

    finding = _build_finding(decision, claim, receipt)
    policies = []
    if decision.policy_rule:
        from .policy import POLICY_RULES
        policies = [{"code": decision.policy_rule, "title": decision.policy_rule.replace("_", " ").title(),
                     "detail": POLICY_RULES.get(decision.policy_rule, "")}]
    evidence = []
    if decision.evidence_needed and "None" not in decision.evidence_needed:
        evidence = [{"label": "Additional evidence", "detail": decision.evidence_needed, "done": False}]

    return {
        "id": claim.claim_id,
        "employee": claim.claimant,
        "submitted": submitted,
        "category": claim.policy_category.replace("_", " ").title(),
        "merchantClaim": receipt.merchant or claim.receipt_id,
        "totalClaim": round(claim.claimed_amount or 0.0, 2),
        "totalOcr": round(total, 2),
        "currency": "IDR",
        "lines": lines,
        "verdict": decision.decision,
        "reimburseAmount": round(decision.reimbursable_amount or 0.0, 2),
        "rationale": [s.strip() for s in (decision.rationale or "").split(". ") if s.strip()],
        "policies": policies,
        "evidence": evidence,
        "findings": [finding] if finding else [],
        "image": image_url,
    }


def export_claims(records: List[Dict], project_root: str) -> str:
    """Write claims.json + copy receipt images into the frontend.

    `records` is the list produced by main.run_one (dicts with claim/extracted/decision
    model_dumps plus the source image path).
    """
    data_dir = os.path.join(project_root, "src", "data")
    img_dir = os.path.join(project_root, "public", "receipts")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(img_dir, exist_ok=True)

    claims = []
    for r in records:
        claim = ExpenseClaim(**r["claim"])
        receipt = ExtractedReceipt(**r["extracted"])
        decision = Decision(**r["decision"])

        image_url = ""
        src_img = r.get("image_path")
        if src_img and os.path.exists(src_img):
            fname = os.path.basename(src_img)
            shutil.copyfile(src_img, os.path.join(img_dir, fname))
            image_url = f"/receipts/{fname}"

        claims.append(to_frontend_claim(claim, receipt, decision, image_url=image_url))

    out = os.path.join(data_dir, "claims.json")
    with open(out, "w") as f:
        json.dump(claims, f, indent=2)
    return out
