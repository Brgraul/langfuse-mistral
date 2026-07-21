"""CLI entrypoint: fixture receipt + claim -> checkers -> decision -> print."""

import json
from dataclasses import asdict
from pathlib import Path

from receipt_agent.contracts import ExpenseClaim, ReceiptItem
from receipt_agent.orchestrator import reconcile

FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "fixtures" / "receipt_001"


def _load_claim(path: Path) -> ExpenseClaim:
    data = json.loads(path.read_text())
    data["claimed_items"] = [ReceiptItem(**item) for item in data["claimed_items"]]
    return ExpenseClaim(**data)


def main() -> None:
    claim = _load_claim(FIXTURE_DIR / "claim.json")
    decision = reconcile(
        image_path=str(FIXTURE_DIR / "receipt.png"),
        receipt_id="receipt_001",
        mock=True,
        claim=claim,
    )
    print(json.dumps(asdict(decision), indent=2))


if __name__ == "__main__":
    main()
