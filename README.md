# Receipt Reconciliation Mystery

Mistral OCR + Langfuse tracing over the [CORD v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)
receipt dataset. The workflow reads a receipt, extracts structured fields, compares a
synthetic expense claim against it, and decides whether to **approve / partially approve /
reject / escalate** — with every step traced in Langfuse and evaluated against the dataset
ground truth.

See [PLAN.md](./PLAN.md) for the team split.

## Pipeline

```
load receipt (CORD v2)  ->  Mistral OCR  ->  structured extraction  ->  synthetic claim
                                                                              |
        evaluate vs ground truth  <-  reconcile (policy engine)  <-----------+
```

Each step is a Langfuse observation under one trace. Two scores are pushed:
`extraction_accuracy` (extraction vs CORD ground truth) and `decision_correct`
(verdict vs the claim's expected decision).

## Setup

```bash
uv venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env        # then fill in MISTRAL_API_KEY + LANGFUSE_* keys
```

## Run

```bash
python main.py                                   # 1 receipt, random inconsistency, live APIs
python main.py --n 3                             # 3 receipts
python main.py --inconsistency change_claimed    # force a known case for the demo
python main.py --mock                            # skip Mistral, use ground truth as OCR
python main.py --seed 7 --out results.json       # deterministic + write results
```

- `--mock` runs the whole pipeline without calling Mistral (uses the CORD ground truth in
  place of OCR) — handy if the live API is flaky during a demo.
- Without Langfuse keys, tracing degrades to a no-op and the pipeline still runs locally.

## Injectable inconsistencies

The claim generator (`receipt_recon/claims.py`) can inject any of:

| type | what it does | expected decision |
|---|---|---|
| `none` | faithful claim | approve |
| `amount_mismatch` | inflated claimed amount | partial |
| `claimed_cash_tendered` | claims cash tendered, not amount owed | partial |
| `change_claimed` | adds change back on top of total | partial |
| `tax_doubled` | claims tax twice | partial |
| `pre_discount_price` | ignores an item discount | partial |
| `non_reimbursable_item` | adds an alcohol line item | reject |

## Module map

| file | owner | role |
|---|---|---|
| `receipt_recon/schemas.py` | shared | data contracts (frozen interface) |
| `receipt_recon/config.py` | A | env + Mistral/Langfuse clients (Langfuse no-op fallback) |
| `receipt_recon/dataset.py` | A | CORD v2 loader + ground-truth normalizer |
| `receipt_recon/ocr.py` | B | Mistral OCR + structured extraction (`--mock` aware) |
| `receipt_recon/claims.py` | C | synthetic claim generator |
| `receipt_recon/policy.py` | C | reimbursement policy ruleset |
| `receipt_recon/decision.py` | D | comparison + decision engine (deterministic) |
| `receipt_recon/evaluation.py` | D | scoring vs ground truth |
| `main.py` | A | orchestrator + root trace |
