# Receipt Reconciliation Mystery

An interactive receipt-review frontend backed by live rows from the
[CORD v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) dataset on Hugging Face.
Each generated review sends the real receipt image to `mistral-ocr-latest`, extracts the
same receipt fields represented by CORD's annotations, then deliberately perturbs the OCR
result into a synthetic employee claim. The web runtime does not read the Hugging Face
`ground_truth` column.
There are no static claims or bundled mock receipts in the web workflow.

See [PLAN.md](./PLAN.md) for the team split.

## Web workflow

```
fetch one CORD receipt image
  -> Mistral OCR with a strict receipt JSON schema
  -> normalize the OCR annotation
  -> choose an applicable perturbation
  -> trace the original values, synthetic noise, and exact delta in Langfuse
  -> render synthetic claim vs Mistral OCR
  -> recommend reimbursement
```

The Node backend is a TanStack Start server function in
`src/lib/receipt-generator.ts`. It fetches random validation/test rows from the Hugging
Face datasets server, sends each image to the Mistral OCR endpoint, and passes the structured
annotation to the pure generator in `src/lib/receipt-generator-core.ts`. Clicking the next
arrow fetches and recognizes another receipt on demand while retaining earlier receipts in
the browser session.

## Setup

```bash
bun install --frozen-lockfile   # required: TanStack's plugin needs zod v4 while the
                                 # shadcn forms pin zod v3; the lockfile keeps both. A
                                 # fresh resolve hoists v3 and breaks `bun run build`.
cp .env.example .env             # set MISTRAL_API_KEY
bun run dev
```

The keys are read only inside the server runtime and are never exposed to the client bundle.
The web workflow requires outbound access to `datasets-server.huggingface.co` and
`api.mistral.ai`.

When both Langfuse keys are configured, every generated review is exported as one
`receipt-review-pipeline` trace with these nested observations:

1. `fetch-cord-image` (`retriever`) — dataset row and image dimensions
2. `mistral-receipt-ocr` (`generation`) — model, confidence, and structured receipt
3. `normalize-receipt-fields` (`tool`) — normalized monetary and line-item fields
4. `synthetic-noise-addition` (`tool`) — original values, selected noise type, changed
   claim values, exact finding/delta, and reimbursement recommendation

Retries appear as separate `receipt-attempt` child chains. Trace export is immediate so
short-lived server instances do not lose completed observations. If Langfuse is not
configured, the workflow continues normally without tracing.

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

| type                      | what it does                                           | expected decision |
| ------------------------- | ------------------------------------------------------ | ----------------- |
| `total-mismatch`          | inflates the claimed total                             | partial           |
| `cash-as-total`           | claims cash tendered instead of amount owed            | partial           |
| `change-claimed`          | adds returned change to the claim                      | partial           |
| `items-mismatch-subtotal` | inflates a line item so the claim no longer reconciles | escalate          |
| `tax-doubled`             | claims tax twice                                       | partial           |
| `pre-discount-price`      | ignores a printed discount                             | partial           |
| `non-reimbursable`        | adds an alcohol item absent from the receipt           | partial           |

## Module map

| file                                | owner       | role                                                                |
| ----------------------------------- | ----------- | ------------------------------------------------------------------- |
| `src/lib/mistral-ocr.ts`            | web backend | Mistral OCR request + strict receipt annotation schema              |
| `src/lib/receipt-generator.ts`      | web backend | live image selection, retries, server-only API key access           |
| `src/lib/receipt-generator-core.ts` | web backend | OCR normalization, claim perturbation, reimbursement recommendation |
| `receipt_recon/schemas.py`          | shared      | data contracts (frozen interface)                                   |
| `receipt_recon/config.py`           | A           | env + Mistral/Langfuse clients (Langfuse no-op fallback)            |
| `receipt_recon/dataset.py`          | A           | CORD v2 loader + ground-truth normalizer                            |
| `receipt_recon/ocr.py`              | B           | Mistral OCR + structured extraction (`--mock` aware)                |
| `receipt_recon/claims.py`           | C           | synthetic claim generator                                           |
| `receipt_recon/policy.py`           | C           | reimbursement policy ruleset                                        |
| `receipt_recon/decision.py`         | D           | comparison + decision engine (deterministic)                        |
| `receipt_recon/evaluation.py`       | D           | scoring vs ground truth                                             |
| `main.py`                           | A           | orchestrator + root trace                                           |
