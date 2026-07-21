"""FastAPI wrapper around the receipt_recon reconciliation pipeline, plus a
minimal static demo UI (receipt image + extracted fields + claim + decision).

Mirrors main.py's run_one() as an HTTP endpoint: OCR/extract -> claim ->
decision -> (optional) eval against ground truth, all under one Langfuse trace.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .claims import INCONSISTENCY_TYPES, generate_claim
from .config import langfuse_client
from .dataset import SAMPLES_DIR, load_samples
from .decision import reconcile
from .evaluation import decision_correct, extraction_accuracy
from .ocr import ocr_and_extract
from .schemas import Decision, ExpenseClaim, ExtractedReceipt

app = FastAPI(title="Receipt Reconciliation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).resolve().parent / "static"


class ReconcileRequest(BaseModel):
    image_path: str
    receipt_id: str
    mock: bool = True
    ground_truth: Optional[dict] = None
    claim: Optional[dict] = None
    seed: Optional[int] = None
    inconsistency: Optional[str] = None


class ReconcileResponse(BaseModel):
    decision: Decision
    extracted: ExtractedReceipt
    claim: ExpenseClaim
    extraction_accuracy: Optional[dict] = None
    decision_correct: Optional[dict] = None


@app.post("/reconcile", response_model=ReconcileResponse)
def reconcile_endpoint(payload: ReconcileRequest) -> ReconcileResponse:
    lf = langfuse_client()
    ground_truth = ExtractedReceipt(**payload.ground_truth) if payload.ground_truth else None

    with lf.start_as_current_observation(
        name="reconcile-receipt", as_type="chain",
        input={
            "receipt_id": payload.receipt_id,
            "inconsistency": payload.inconsistency,
            "seed": payload.seed,
            "mock": payload.mock,
        },
    ) as trace:
        extracted = ocr_and_extract(
            payload.image_path,
            mock_ground_truth=ground_truth if payload.mock else None,
            langfuse=lf,
        )

        with lf.start_as_current_observation(
            name="generate-claim", as_type="tool",
            input={"receipt_id": payload.receipt_id, "inconsistency": payload.inconsistency, "seed": payload.seed},
        ) as cspan:
            if payload.claim is not None:
                claim = ExpenseClaim(**payload.claim)
            else:
                claim = generate_claim(
                    payload.receipt_id,
                    ground_truth or extracted,
                    inconsistency=payload.inconsistency,
                    seed=payload.seed,
                )
            cspan.update(output=claim.model_dump())

        with lf.start_as_current_observation(
            name="reconcile-decision", as_type="tool",
            input={"claim": claim.model_dump(), "receipt": extracted.model_dump()},
        ) as dspan:
            decision = reconcile(claim, extracted)
            dspan.update(output=decision.model_dump())

            for finding in decision.findings:
                with lf.start_as_current_observation(
                    name=f"check:{finding.type}", as_type="evaluator",
                    input={"rule": finding.rule, "claim_amount": claim.claimed_amount, "receipt_total": extracted.total},
                ) as fspan:
                    fspan.update(output=finding.model_dump())
                    try:
                        fspan.score(
                            name="severity",
                            value={"info": 0.0, "warn": 0.5, "block": 1.0}.get(finding.severity, 0.5),
                            data_type="NUMERIC",
                            comment=finding.detail,
                        )
                    except Exception:
                        pass

            try:
                dspan.score(name="num_findings", value=len(decision.findings), data_type="NUMERIC")
                dspan.score(
                    name="has_blocking_finding",
                    value=1.0 if any(f.severity == "block" for f in decision.findings) else 0.0,
                    data_type="NUMERIC",
                )
            except Exception:
                pass

        ext_eval = extraction_accuracy(extracted, ground_truth) if ground_truth else None
        dec_eval = decision_correct(decision, claim)

        trace.update(output={
            "decision": decision.model_dump(),
            "extraction_accuracy": ext_eval["score"] if ext_eval else None,
            "decision_correct": dec_eval["score"] if dec_eval else None,
        })
        try:
            if ext_eval:
                trace.score(name="extraction_accuracy", value=ext_eval["score"], data_type="NUMERIC")
                for field_name, field_result in ext_eval["fields"].items():
                    trace.score(
                        name=f"extraction_accuracy.{field_name}",
                        value=1.0 if field_result["match"] else 0.0,
                        data_type="NUMERIC",
                        comment=f"ground_truth={field_result['ground_truth']} extracted={field_result['extracted']}",
                    )
            if dec_eval:
                trace.score(name="decision_correct", value=dec_eval["score"], data_type="NUMERIC")
            trace.score(name="reimbursable_amount", value=decision.reimbursable_amount, data_type="NUMERIC")
        except Exception:
            pass

    lf.flush()

    return ReconcileResponse(
        decision=decision,
        extracted=extracted,
        claim=claim,
        extraction_accuracy=ext_eval,
        decision_correct=dec_eval,
    )


@app.get("/health")
def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Minimal demo UI support: list/serve cached CORD samples, list inconsistencies.
# --------------------------------------------------------------------------- #
@app.get("/samples")
def list_samples():
    """List CORD receipts already cached locally (downloads a couple if none exist)."""
    if not os.path.isdir(SAMPLES_DIR) or not any(
        f.endswith(".png") for f in os.listdir(SAMPLES_DIR)
    ):
        load_samples(n=3)

    samples = []
    for fname in sorted(os.listdir(SAMPLES_DIR)):
        if not fname.endswith(".png"):
            continue
        receipt_id = fname[: -len(".png")]
        gt_path = os.path.join(SAMPLES_DIR, f"{receipt_id}.gt.json")
        with open(gt_path) as f:
            ground_truth = json.load(f)
        samples.append({
            "receipt_id": receipt_id,
            "image_url": f"/samples/{receipt_id}/image",
            "ground_truth": ground_truth,
        })
    return samples


@app.get("/samples/{receipt_id}/image")
def get_sample_image(receipt_id: str):
    path = os.path.join(SAMPLES_DIR, f"{receipt_id}.png")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="sample not found")
    return FileResponse(path)


@app.get("/inconsistencies")
def list_inconsistencies():
    return INCONSISTENCY_TYPES


@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
