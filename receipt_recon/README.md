# `receipt_recon` — Receipt Reconciliation Backend

This package implements the Receipt Reconciliation Mystery pipeline (see the
[repo-root README](../README.md) and [PLAN.md](../PLAN.md) for the challenge
background). It was extended, in parallel with the rest of the team, with a
FastAPI layer, a much deeper Langfuse trace, and a Mistral-OCR-native
structured-extraction path with an automatic quality gate. This document
covers those additions and how to run the backend standalone.

## What's here beyond the original pipeline

### 1. Mistral OCR does the structured extraction itself

The original design used two Mistral calls: OCR to get markdown text, then a
separate chat completion to turn that markdown into an `ExtractedReceipt`.
`receipt_recon/ocr.py` now does this in **one OCR call** by passing
`document_annotation_format` — a JSON schema matching `ExtractedReceipt` —
directly to `client.ocr.process(...)`. Mistral OCR returns the structured
JSON as `resp.document_annotation`, no second model call needed on the happy
path.

### 2. Every detected element is individually traceable

The same OCR call also passes `include_blocks=True`, which returns
paragraph-level bounding boxes for every element Mistral OCR detects (text
lines, titles, tables, images, footers, ...). For each one, `ocr.py` crops
the *exact region* of the source receipt image to that bounding box and logs
it as a Langfuse child span nested under the OCR generation:

- **input** — the cropped image region (uploaded via `LangfuseMedia`) + its
  bounding box coordinates
- **output** — the content Mistral extracted from that region (e.g. a
  markdown table, a line of text)

Spans are named `<type> <ordinal>` in reading order (`table 1`, `text 3`,
`image 2 (img_abc123)`, ...) so they're distinguishable in the trace tree.
This means any field in the final `ExtractedReceipt` can be traced back to
the literal pixels on the receipt it came from — useful for auditing OCR
mistakes field-by-field instead of trusting the aggregate output.

### 3. Confidence-based quality gate with automatic fallback

`confidence_scores_granularity="word"` is requested on the same OCR call,
giving per-word and aggregate page confidence. If the aggregate confidence
falls below `CONFIDENCE_THRESHOLD` (0.85), `ocr_and_extract` does **not**
trust the OCR model's own `document_annotation` — it:

1. Logs a Langfuse `WARNING`-level event (`ocr-low-confidence`) with the
   measured confidence and the threshold, so the trace makes the fallback
   visible and explainable.
2. Falls back to the original two-step path: a `mistral-large-latest` chat
   completion re-derives the structured fields from the raw OCR markdown,
   traced as its own generation (`extract-fields-fallback`).

None of the cached CORD v2 samples are noisy enough to trigger this
naturally (Mistral OCR reads them at 0.90–0.98 confidence), so
[`scripts/make_low_confidence_sample.py`](../scripts/make_low_confidence_sample.py)
generates a deliberately degraded copy of a receipt (blurred, downscaled,
rotated) that reliably drops confidence to ~0.53 for a live demo of the gate.

### 4. Structured, typed findings instead of a single rule string

`decision.py`'s reconciliation engine builds a `Finding` (see
`schemas.py`) for every policy check that fires — not just a rule id and a
free-text description, but the exact numbers compared (claimed vs. receipt
total, cash price vs. total, printed vs. claimed tax, discount math, etc.).
`Decision.findings` carries the full list. Each finding also becomes its own
Langfuse span (`as_type="evaluator"`) with a severity score, so a single
`reconcile-receipt` trace shows every check that ran, not just the final
verdict.

Per-field extraction accuracy is scored individually too
(`extraction_accuracy.<field>`), rather than only the aggregate score, so a
single wrong field doesn't get averaged away in the trace.

### 5. FastAPI layer + integration with the team's React frontend

`api.py` exposes the same pipeline over HTTP:

| Endpoint | Purpose |
|---|---|
| `POST /reconcile` | Run OCR → claim → decision → eval for one receipt; returns the full structured response (decision, findings, extracted receipt, claim, eval scores) |
| `GET /samples` | List cached CORD v2 receipts (downloads a few if none are cached yet) |
| `GET /samples/{id}/image` | Serve a cached receipt image |
| `GET /inconsistencies` | List injectable claim inconsistency types |
| `GET /health` | Liveness check |

CORS is enabled so the existing team-built React/TanStack frontend (repo
root `src/`) can call this backend directly from its Vite dev server. `src/lib/receipt-api.ts` is a typed client for these endpoints, and
`src/lib/map-findings.ts` maps the backend's `Finding[]` onto the frontend's
existing rich per-finding-type visualizations — so the frontend's UI, findings
strip, and reimbursable-calculation breakdown all render from live backend
data instead of the hardcoded mock claims it originally shipped with.

A minimal framework-free static demo page also ships at `GET /` (served from
`receipt_recon/static/index.html`) for testing the API without the React app
running.

## Setup

```bash
uv venv .venv
uv sync                       # installs from pyproject.toml / uv.lock
cp .env.example .env           # fill in MISTRAL_API_KEY + LANGFUSE_* keys
```

## Run

CLI:

```bash
uv run python main.py                                # 1 receipt, random inconsistency, live APIs
uv run python main.py --n 3                          # 3 receipts
uv run python main.py --inconsistency change_claimed # force a known case for the demo
uv run python main.py --mock                         # skip Mistral, use ground truth as OCR
uv run python main.py --seed 7 --out results.json    # deterministic + write results
```

API server:

```bash
uv run uvicorn receipt_recon.api:app --port 8000
# then either open http://localhost:8000 (static demo page)
# or point the React frontend's VITE_API_BASE at it and `npm run dev` (see repo root README)
```

Generate a low-confidence demo sample (see §3 above):

```bash
uv run python scripts/make_low_confidence_sample.py [source_receipt_id]
```

- `--mock` / `mock: true` skips Mistral entirely and returns the CORD ground truth
  in place of OCR output — the pipeline still runs end-to-end without live credentials.
- Without Langfuse keys configured, tracing degrades to a no-op shim
  (`config._NoopLangfuse`) and the pipeline still runs, just untraced.

## Module map

| file | role |
|---|---|
| `schemas.py` | data contracts: `ExtractedReceipt`, `ExpenseClaim`, `Decision`, `Finding` |
| `config.py` | env + Mistral/Langfuse client wiring, no-op Langfuse fallback |
| `dataset.py` | CORD v2 loader + ground-truth normalizer |
| `ocr.py` | Mistral OCR (structured output + bounding boxes + confidence gate) |
| `claims.py` | synthetic claim generator (seedable, injectable inconsistencies) |
| `policy.py` | reimbursement policy ruleset |
| `decision.py` | comparison + decision engine (deterministic, structured findings) |
| `evaluation.py` | scoring vs. ground truth (aggregate + per-field) |
| `api.py` | FastAPI app: `/reconcile`, `/samples`, `/inconsistencies`, static demo UI |
| `static/index.html` | minimal no-build-tool demo page served at `GET /` |

Root-level `main.py` is the CLI orchestrator; `../src/lib/receipt-api.ts` and
`../src/lib/map-findings.ts` are the frontend-side integration.
