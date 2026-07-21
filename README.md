# Receipt Reconciliation Mystery

An interactive receipt-review frontend backed by live rows from the
[CORD v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) dataset on Hugging Face.
Each generated review uses the real image and `ground_truth` annotation from the same
dataset row, then deliberately perturbs the annotation into a synthetic employee claim.
There are no static claims or bundled mock receipts in the web workflow.

See [PLAN.md](./PLAN.md) for the team split.

## Web workflow

```
fetch one paired CORD row (image + ground_truth)
  -> normalize the annotation
  -> choose an applicable perturbation
  -> render synthetic claim vs original ground truth
  -> recommend reimbursement
```

The Node backend is a TanStack Start server function in
`src/lib/receipt-generator.ts`. It fetches random validation/test rows from the Hugging
Face datasets server, retries transient failures, and passes the paired row to the pure
generator in `src/lib/receipt-generator-core.ts`. Clicking the next arrow fetches and
generates another receipt on demand while retaining earlier receipts in the browser session.

## Setup

```bash
bun install
bun run dev
```

No API key is required for the web workflow. It requires outbound access to
`datasets-server.huggingface.co`.

## Validate

```bash
bun test
bun run build
```

## Legacy Python pipeline

The original Mistral OCR + Langfuse experiment remains under `receipt_recon/` and is
available through `main.py`. It is separate from the Node frontend runtime.

```bash
uv venv .venv && source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env
python main.py
```

## Injectable inconsistencies

The web generator can inject any applicable perturbation for the selected receipt:

| type | what it does | expected decision |
|---|---|---|
| `total-mismatch` | inflates the claimed total | partial |
| `cash-as-total` | claims cash tendered instead of amount owed | partial |
| `change-claimed` | adds returned change to the claim | partial |
| `items-mismatch-subtotal` | inflates a line item so the claim no longer reconciles | escalate |
| `tax-doubled` | claims tax twice | partial |
| `pre-discount-price` | ignores a printed discount | partial |
| `non-reimbursable` | adds an alcohol item absent from the receipt | partial |

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
