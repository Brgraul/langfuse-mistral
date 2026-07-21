---
name: expense-claim-generator
description: Generates synthetic employee expense claims from random real receipts in the CORD v2 dataset (naver-clova-ix/cord-v2 on Hugging Face), with 1..N deliberate permutation anomalies (wrong total, cash-as-total, change claimed, items/subtotal mismatch, tax doubled/omitted, pre-discount pricing, non-reimbursable items). Use when the user wants a random receipt, an expense claim POST body, test data for an expense-claim validator/checker, or mentions CORD receipts, claim permutations, or expense anomalies.
---

# Expense Claim Generator

Generates POST-ready employee expense claims built on **real receipts** pulled at random from
[CORD v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) (Indonesian food & beverage
receipts, prices in IDR), then optionally corrupts them with deliberate anomalies
("permutations") for testing expense-claim validation.

Only the small `ground_truth` parquet column is read over HTTP (DuckDB range requests) —
receipt images are never downloaded.

## Requirements

- `uv` (runs the script with PEP 723 inline deps; installs DuckDB into an isolated env automatically)
- Network access to huggingface.co

## Quick start

Run from anywhere (paths below are relative to this skill directory):

```bash
# Faithful claim from a random receipt (claim JSON to stdout, summary to stderr)
uv run scripts/generate_expense_claim.py

# Exactly one permutation
uv run scripts/generate_expense_claim.py --permutations wrong-total

# Several explicit permutations
uv run scripts/generate_expense_claim.py -p cash-as-total,change-claimed,tax-omitted

# N distinct permutations chosen at random (1..7)
uv run scripts/generate_expense_claim.py -p 3

# All permutations at once
uv run scripts/generate_expense_claim.py -p all

# Reproducible: same seed -> same receipt, same claim, same permutations
uv run scripts/generate_expense_claim.py --seed 42 -p all

# A specific receipt (0..799 for train, 0..99 for validation/test)
uv run scripts/generate_expense_claim.py --receipt-index 439 --split train

# Write artifacts and POST the claim
uv run scripts/generate_expense_claim.py -p all \
  --out claim.json --report report.json \
  --post https://api.example.com/expense-claims \
  --header "Authorization: Bearer $TOKEN"
```

Always pass `--out`/`--report` when the artifacts matter; stdout is the claim JSON only,
and the human-readable summary goes to stderr.

## Permutation catalog

`--permutations` / `-p` accepts comma-separated names, an integer N, or `all`.
List valid names with `--list-permutations`.

| Name | Anomaly planted in the claim |
| --- | --- |
| `wrong-total` | `claimed_total` differs from the receipt's `total.total_price` (±5–20%) |
| `cash-as-total` | `claimed_total` set to cash tendered (`total.cashprice`) instead of the purchase total |
| `change-claimed` | Change returned (`total.changeprice`) is added to the claimed total |
| `items-mismatch-subtotal` | A line item's `total_price` is inflated so items no longer sum to `sub_total.subtotal_price` |
| `tax-error` | Randomly doubles the tax (`tax-doubled`) or omits it (`tax-omitted`); explicit names also accepted |
| `pre-discount-price` | A discounted item is claimed at its pre-discount price (discount ignored) |
| `non-reimbursable` | Ensures the claim contains a policy-violating item (alcohol/tobacco/gift card/lottery) |

Caveats:

- `pre-discount-price` only applies when the receipt actually carries a discount
  (~6% of receipts; e.g. train indices 407, 436, 439, 448, 472). Otherwise it is **skipped**
  and recorded under `permutations_skipped_not_applicable` in the report. Re-roll the seed
  or pass a known-discounted `--receipt-index` when you need it.
- `cash-as-total` / `change-claimed` fabricate plausible tendered/change amounts when the
  receipt lacks them, so they always apply.
- Receipts are real and not always internally consistent; the baseline claim mirrors the
  receipt as-is. Use `--report` to compare against ground truth.

## Claim schema (POST body)

```json
{
  "schema_version": "1.0",
  "claimant": {"employee_id", "full_name", "email", "department", "cost_center"},
  "claim": {
    "title": "...", "business_purpose": "...", "expense_date": "YYYY-MM-DD",
    "currency": "IDR",
    "merchant": {"name": null, "receipt_image_ref": "cord-v2/<split>/<image_id>"},
    "line_items": [{"description", "category", "quantity", "unit_price", "total_price", "discount"}],
    "subtotal": 0, "service_charge": 0, "tax": 0, "discount": 0,
    "claimed_total": 0,
    "reimbursement_method": "out_of_pocket",
    "payment": {"method": "cash|card|unknown", "amount_tendered": 0, "change_received": 0}
  },
  "attachments": [{"type": "receipt_image", "source": "naver-clova-ix/cord-v2", "split", "image_id"}]
}
```

`merchant.name` is `null` because CORD v2 ground truth carries no merchant name; claimant,
dates, and purposes are synthetic (seeded). CORD price strings are parsed as integers
(thousand separators stripped).

## Report (for testing a validator)

`--report report.json` captures everything needed to grade a claim checker:

- `receipt`: dataset provenance (split, shard, global index, image_id) + raw `gt_parse` + `receipt_total_price`
- `permutations_applied[]`: `permutation`, `detail` (exact numbers changed), `expected_finding` (what a validator should flag)
- `permutations_skipped_not_applicable[]`

## Reimbursement policy

`non-reimbursable` uses `policy.default.json` (alcohol, tobacco, gift cards, lottery —
keyword matchers + injectable items). Supply a different policy with `--policy my-policy.json`
using the same shape.
