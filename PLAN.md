# Receipt Reconciliation Mystery — Team Plan (4 people, 1 hour)

Mistral OCR + Langfuse tracing over the CORD v2 receipt dataset. We read a receipt,
extract structured fields, compare a synthetic expense claim against it, and decide
whether to **approve / partially approve / reject / escalate** — with every step traced
in Langfuse and evaluated against the dataset ground truth.

## Strategy: lock contracts first, build in parallel, integrate last

The only hard dependency is that OCR needs a receipt image. Everything else works
against stub JSON, so nobody blocks anyone.

- **0–5 min** — whole team agrees the data contracts (below). Person A pushes empty
  module stubs matching them.
- **5–45 min** — parallel build against stub JSON files.
- **45–55 min** — integrate: swap stubs for real modules in `main.py`, one end-to-end run.
- **55–60 min** — confirm the nested Langfuse trace (OCR → extraction → comparison →
  decision) + scores. Screenshot for the demo.

## Data contracts (freeze these first)

```python
# ExtractedReceipt — used by BOTH the OCR output and the normalized ground truth
{ "merchant": str,
  "items": [{"name": str, "qty": float, "unit_price": float, "price": float}],
  "subtotal": float, "tax": float, "discount": float, "total": float,
  "payment_method": str, "cash_price": float, "change": float }

# ExpenseClaim — synthetic, may deliberately disagree with the receipt
{ "claim_id": str, "receipt_id": str, "claimant": str,
  "claimed_amount": float, "claimed_items": [...],
  "claimed_tax": float, "claimed_discount": float,
  "payment_method": str, "policy_category": str,
  "injected_inconsistency": str|null, "expected_decision": str|null }

# Decision — the final verdict
{ "decision": "approve|partial|reject|escalate",
  "reimbursable_amount": float, "mismatched_field": str,
  "policy_rule": str, "evidence_needed": str, "rationale": str }
```

## The 4-way split

| Person | Owns | Deliverable | Blocked by |
|---|---|---|---|
| **A — Data & Infra** | Repo scaffold, `.env`, HF CORD v2 loader, Langfuse client wiring, `main.py` orchestrator + root trace | 3–5 sample receipts saved to disk as image + normalized `ground_truth` JSON. Shares one image at min 5 so B can start. | nobody |
| **B — OCR & Extraction** | Mistral `ocr.process` (`mistral-ocr-latest`) + structured extraction → `ExtractedReceipt`, as a Langfuse generation. `--mock` flag returns saved OCR. | receipt → structured fields | A's images (min 5) |
| **C — Claims & Policy** | Synthetic claim generator that injects a *random* inconsistency (seedable to force a case for the demo). Owns the small `POLICY_RULES` list and hands it to D early. | `ExpenseClaim` + policy ruleset | nobody |
| **D — Decision & Eval** | Compare claim vs receipt, apply C's rules → `Decision`. Langfuse scores: extraction-vs-ground_truth accuracy, decision-vs-expected. | verdict + scores | contracts only |

## Inconsistencies C should build (pick randomly, seedable)

- Claimed total ≠ receipt `total`
- Claim uses `cash_price` (tendered) instead of actual `total`
- `change` incorrectly claimed as an expense
- Item prices don't add up to `subtotal`
- Tax included twice / omitted
- A discounted item claimed at its pre-discount price
- Non-reimbursable item under policy

## Risk-reducers

1. **B ships a `--mock` mode** returning saved OCR output — pipeline still demos if the
   live Mistral call is flaky.
2. **C's generator is seedable** — force a clean, explainable case (e.g. "change claimed
   as expense") for the presentation; show randomness separately.

## Deliverable question to answer live

> Should the claim be approved, partially approved, rejected, or escalated?
> If not fully approved: what amount, which field/calculation mismatched, which policy
> rule triggered, and what additional approval/evidence is needed?
