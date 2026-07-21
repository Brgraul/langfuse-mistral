"""FastAPI wrapper around the reconcile orchestrator."""

from dataclasses import asdict

from fastapi import FastAPI
from pydantic import BaseModel

from receipt_agent.contracts import ExpenseClaim, ReceiptItem
from receipt_agent.orchestrator import reconcile

app = FastAPI(title="Receipt Reconciliation Agent")


class ReconcileRequest(BaseModel):
    image_path: str
    receipt_id: str
    mock: bool = True
    claim: dict | None = None
    seed: int | None = None
    force_inconsistency: str | None = None


@app.post("/reconcile")
def reconcile_endpoint(payload: ReconcileRequest):
    claim = None
    if payload.claim is not None:
        data = dict(payload.claim)
        data["claimed_items"] = [ReceiptItem(**item) for item in data["claimed_items"]]
        claim = ExpenseClaim(**data)
    decision = reconcile(
        image_path=payload.image_path,
        receipt_id=payload.receipt_id,
        mock=payload.mock,
        claim=claim,
        seed=payload.seed,
        force_inconsistency=payload.force_inconsistency,
    )
    return asdict(decision)


@app.get("/health")
def health():
    return {"status": "ok"}
