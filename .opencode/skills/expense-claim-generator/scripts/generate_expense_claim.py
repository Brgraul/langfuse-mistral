#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
"""Generate a synthetic employee expense claim from a random CORD v2 receipt.

Pulls one random receipt from naver-clova-ix/cord-v2 on Hugging Face (reads only
the small `ground_truth` column of the parquet shards over HTTP via DuckDB range
requests - images are never downloaded), builds a POST-ready employee expense
claim, and optionally applies 1..N deliberate "permutation" anomalies used to
test expense-claim validators.

Run with:  uv run generate_expense_claim.py --help
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

DATASET = "naver-clova-ix/cord-v2"
HF_BASE = f"https://huggingface.co/datasets/{DATASET}/resolve/main/"

# Parquet shards and their row counts (CORD v2: train=800, validation=100, test=100).
SHARDS: dict[str, list[tuple[str, int]]] = {
    "train": [
        ("data/train-00000-of-00004-b4aaeceff1d90ecb.parquet", 200),
        ("data/train-00001-of-00004-7dbbe248962764c5.parquet", 200),
        ("data/train-00002-of-00004-688fe1305a55e5cc.parquet", 200),
        ("data/train-00003-of-00004-2d0cd200555ed7fd.parquet", 200),
    ],
    "validation": [("data/validation-00000-of-00001-cc3c5779fe22e8ca.parquet", 100)],
    "test": [("data/test-00000-of-00001-9c204eb3f4e11791.parquet", 100)],
}

DEFAULT_POLICY = {
    "policy_name": "Default Employee Reimbursement Policy",
    "non_reimbursable_categories": {
        "alcohol": {
            "keywords": ["beer", "bintang", "soju", "wine", "vodka", "whisky",
                         "whiskey", "sake", "cocktail", "liquor", "arak", "guinness"],
            "injectable_items": [
                {"description": "BINTANG BEER 620ML", "unit_price": 85000},
                {"description": "HOUSE RED WINE GLASS", "unit_price": 95000},
            ],
        },
        "tobacco": {
            "keywords": ["cigarette", "marlboro", "tobacco", "sampoerna",
                         "gudang garam", "vape", "djarum"],
            "injectable_items": [{"description": "MARLBORO RED 20S", "unit_price": 62000}],
        },
        "gift_cards": {
            "keywords": ["gift card", "giftcard", "gift voucher"],
            "injectable_items": [{"description": "GIFT CARD 100K", "unit_price": 100000}],
        },
        "lottery": {
            "keywords": ["lottery", "lotto", "scratch card"],
            "injectable_items": [{"description": "LOTTERY TICKET", "unit_price": 50000}],
        },
    },
}

EMPLOYEES = [
    {"employee_id": "E-1001", "full_name": "Amelia Hart", "email": "amelia.hart@example.com", "department": "Sales", "cost_center": "CC-410"},
    {"employee_id": "E-1002", "full_name": "Ravi Nair", "email": "ravi.nair@example.com", "department": "Engineering", "cost_center": "CC-720"},
    {"employee_id": "E-1003", "full_name": "Sofia Mendez", "email": "sofia.mendez@example.com", "department": "Marketing", "cost_center": "CC-330"},
    {"employee_id": "E-1004", "full_name": "Jonas Weber", "email": "jonas.weber@example.com", "department": "Operations", "cost_center": "CC-510"},
    {"employee_id": "E-1005", "full_name": "Priya Raman", "email": "priya.raman@example.com", "department": "Finance", "cost_center": "CC-110"},
    {"employee_id": "E-1006", "full_name": "Tom Becker", "email": "tom.becker@example.com", "department": "Sales", "cost_center": "CC-410"},
    {"employee_id": "E-1007", "full_name": "Lena Fischer", "email": "lena.fischer@example.com", "department": "People", "cost_center": "CC-610"},
    {"employee_id": "E-1008", "full_name": "Daniel Osei", "email": "daniel.osei@example.com", "department": "Engineering", "cost_center": "CC-720"},
]

PURPOSES = [
    "Client dinner", "Team lunch", "Business meal during offsite",
    "Working dinner with vendor", "Team celebration dinner", "Customer workshop catering",
]


# --------------------------------------------------------------------------- #
# Parsing helpers                                                              #
# --------------------------------------------------------------------------- #

def parse_amount(value) -> int | None:
    """Parse CORD price strings like '75,000', '40,000.', '-7,800', '75.000'."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(round(value))
    s = str(value).strip()
    if not s:
        return None
    sign = -1 if s.startswith("-") else 1
    digits = re.sub(r"[^\d]", "", s)
    return sign * int(digits) if digits else None


def parse_qty(value) -> float:
    """Parse CORD counts like '1 x', '3', '0.5'. Defaults to 1."""
    if value is None:
        return 1
    m = re.search(r"(\d+(?:\.\d+)?)", str(value))
    if not m:
        return 1
    q = float(m.group(1))
    return int(q) if q == int(q) else q


def money(n) -> int | float:
    """Keep integral amounts as ints in JSON output."""
    if n is None:
        return None
    return int(n) if float(n) == int(n) else round(float(n), 2)


# --------------------------------------------------------------------------- #
# Receipt fetching                                                             #
# --------------------------------------------------------------------------- #

def locate(split: str, index: int) -> tuple[str, int]:
    """Map a global receipt index to (shard_path, offset_within_shard)."""
    shards = SHARDS[split]
    total = sum(c for _, c in shards)
    if not 0 <= index < total:
        raise ValueError(f"receipt index {index} out of range for split '{split}' (0..{total - 1})")
    for path, count in shards:
        if index < count:
            return path, index
        index -= count
    raise AssertionError("unreachable")


def fetch_receipt(split: str, index: int) -> dict:
    """Fetch one receipt's gt_parse + meta by global index. Lazy-imports duckdb."""
    try:
        import duckdb
    except ImportError:
        sys.exit("duckdb is required. Run via `uv run` so inline deps are installed.")
    shard_path, offset = locate(split, index)
    url = HF_BASE + shard_path
    con = duckdb.connect()
    try:
        con.execute("LOAD httpfs;")
        row = con.execute(
            f"SELECT ground_truth FROM read_parquet('{url}') LIMIT 1 OFFSET {offset}"
        ).fetchone()
    except Exception as exc:  # noqa: BLE001 - surface a clean message to the agent
        sys.exit(f"Failed to read receipt from {url}: {exc}")
    if row is None:
        sys.exit(f"No row at index {index} in split '{split}' (shard {shard_path} offset {offset}).")
    gt = json.loads(row[0])
    return {
        "gt_parse": gt.get("gt_parse", {}),
        "meta": gt.get("meta", {}),
        "shard_path": shard_path,
        "shard_offset": offset,
        "global_index": index,
        "split": split,
    }


# --------------------------------------------------------------------------- #
# Claim building (faithful to the receipt)                                     #
# --------------------------------------------------------------------------- #

def classify(description: str, policy: dict) -> str:
    text = description.lower()
    for category, spec in policy["non_reimbursable_categories"].items():
        if any(kw in text for kw in spec["keywords"]):
            return category
    return "meals"


def first_dict(value) -> dict:
    """gt_parse groups (menu/sub_total/total) can repeat as lists on multi-receipt images."""
    if isinstance(value, list):
        value = next((v for v in value if isinstance(v, dict)), {})
    return value if isinstance(value, dict) else {}


def build_claim(receipt: dict, policy: dict, currency: str, rng: random.Random) -> dict:
    gp = receipt["gt_parse"]
    menu = gp.get("menu") or []
    if isinstance(menu, dict):  # single-item receipts annotate menu as an object
        menu = [menu]
    sub_total = first_dict(gp.get("sub_total"))
    total = first_dict(gp.get("total"))

    line_items = []
    for item in menu:
        if not isinstance(item, dict):
            continue
        name = str(item.get("nm", "UNKNOWN ITEM")).strip() or "UNKNOWN ITEM"
        qty = parse_qty(item.get("cnt"))
        list_price = parse_amount(item.get("price")) or 0
        discount = abs(parse_amount(item.get("discountprice")) or 0)
        paid = list_price - discount
        unit = parse_amount(item.get("unitprice"))
        if unit is None:
            unit = round(list_price / qty) if qty else list_price
        line_items.append({
            "description": name,
            "category": classify(name, policy),
            "quantity": qty,
            "unit_price": money(unit),
            "total_price": money(paid),
            "discount": money(discount),
        })

    subtotal = parse_amount(sub_total.get("subtotal_price"))
    if subtotal is None:
        subtotal = sum(li["total_price"] for li in line_items)
    tax = parse_amount(sub_total.get("tax_price")) or 0
    service = parse_amount(sub_total.get("service_price")) or 0
    discount = parse_amount(sub_total.get("discount_price"))
    if discount is None:
        discount = sum(li["discount"] for li in line_items)
    claimed_total = parse_amount(total.get("total_price"))
    if claimed_total is None:
        claimed_total = subtotal + tax + service - discount

    cash = parse_amount(total.get("cashprice"))
    change = parse_amount(total.get("changeprice"))
    card = parse_amount(total.get("creditcardprice"))
    method = "cash" if cash is not None else ("card" if card is not None else "unknown")

    image_id = receipt["meta"].get("image_id", receipt["global_index"])
    return {
        "schema_version": "1.0",
        "claimant": rng.choice(EMPLOYEES),
        "claim": {
            "title": f"{rng.choice(PURPOSES)} - receipt #{image_id}",
            "business_purpose": rng.choice(PURPOSES),
            "expense_date": str(date.today() - timedelta(days=rng.randint(1, 180))),
            "currency": currency,
            "merchant": {
                "name": None,  # CORD v2 gt_parse carries no merchant name
                "receipt_image_ref": f"cord-v2/{receipt['split']}/{image_id}",
            },
            "line_items": line_items,
            "subtotal": money(subtotal),
            "service_charge": money(service),
            "tax": money(tax),
            "discount": money(discount),
            "claimed_total": money(claimed_total),
            "reimbursement_method": "out_of_pocket",
            "payment": {
                "method": method,
                "amount_tendered": money(cash),
                "change_received": money(change),
            },
        },
        "attachments": [{
            "type": "receipt_image",
            "source": DATASET,
            "split": receipt["split"],
            "image_id": image_id,
        }],
    }


# --------------------------------------------------------------------------- #
# Permutations (each returns a report entry or None if not applicable)         #
# --------------------------------------------------------------------------- #

def _ensure_cash_payment(claim: dict, rng: random.Random) -> None:
    """Guarantee amount_tendered > claimed_total so cash-based permutations work."""
    pay = claim["claim"]["payment"]
    total = claim["claim"]["claimed_total"]
    if pay["amount_tendered"] is None or pay["amount_tendered"] <= total:
        pay["amount_tendered"] = total + rng.choice([10_000, 20_000, 50_000, 100_000])
        pay["method"] = "cash"
    pay["change_received"] = pay["amount_tendered"] - total


def perm_wrong_total(claim, rng, **_):
    old = claim["claim"]["claimed_total"]
    factor = 1 + rng.choice([1, -1]) * rng.uniform(0.05, 0.20)
    new = round(old * factor)
    claim["claim"]["claimed_total"] = money(new)
    return {"permutation": "wrong-total",
            "detail": f"claimed_total {old} -> {new} ({factor - 1:+.1%})",
            "expected_finding": f"Claimed total {new} differs from receipt total.total_price {old}."}


def perm_cash_as_total(claim, rng, **_):
    _ensure_cash_payment(claim, rng)
    pay = claim["claim"]["payment"]
    old = claim["claim"]["claimed_total"]
    claim["claim"]["claimed_total"] = pay["amount_tendered"]
    return {"permutation": "cash-as-total",
            "detail": f"claimed_total {old} -> amount_tendered {pay['amount_tendered']}",
            "expected_finding": "Reimbursement uses the cash tendered (total.cashprice) "
                                f"{pay['amount_tendered']} instead of the purchase total {old}."}


def perm_change_claimed(claim, rng, **_):
    _ensure_cash_payment(claim, rng)
    pay = claim["claim"]["payment"]
    change = pay["change_received"]
    old = claim["claim"]["claimed_total"]
    claim["claim"]["claimed_total"] = money(old + change)
    return {"permutation": "change-claimed",
            "detail": f"change_received {change} added: claimed_total {old} -> {old + change}",
            "expected_finding": f"Change of {change} returned to the employee is incorrectly "
                                "claimed as an expense."}


def perm_items_mismatch_subtotal(claim, rng, **_):
    items = [li for li in claim["claim"]["line_items"] if li["total_price"] > 0]
    if not items:
        return None
    item = rng.choice(items)
    old = item["total_price"]
    bump = max(1, round(old * rng.uniform(0.05, 0.25)))
    item["total_price"] = money(old + bump)
    return {"permutation": "items-mismatch-subtotal",
            "detail": f"line '{item['description']}' total_price {old} -> {old + bump}; "
                      "subtotal and claimed_total left unchanged",
            "expected_finding": f"Line items sum to "
                                f"{sum(li['total_price'] for li in claim['claim']['line_items'])} "
                                f"but subtotal is {claim['claim']['subtotal']}."}


def _perm_tax(claim, rng, mode):
    c = claim["claim"]
    orig = c["tax"]
    if orig == 0:
        fabricated = round(c["subtotal"] * 0.11)  # Indonesian VAT
        c["tax"] = money(fabricated)
        c["claimed_total"] = money(c["claimed_total"] + fabricated)
        return {"permutation": f"tax-{mode}",
                "detail": f"receipt had no tax; fabricated tax of {fabricated} added to claim",
                "expected_finding": f"Tax of {fabricated} claimed but no tax appears on the receipt."}
    if mode == "doubled":
        c["tax"] = money(orig * 2)
        c["claimed_total"] = money(c["claimed_total"] + orig)
        return {"permutation": "tax-doubled",
                "detail": f"tax {orig} -> {orig * 2}; claimed_total increased by {orig}",
                "expected_finding": f"Tax of {orig} is included twice (claimed tax {orig * 2})."}
    c["tax"] = 0
    c["claimed_total"] = money(c["claimed_total"] - orig)
    return {"permutation": "tax-omitted",
            "detail": f"tax {orig} -> 0; claimed_total reduced by {orig}",
            "expected_finding": f"Receipt tax of {orig} was omitted from the claim."}


def perm_tax_error(claim, rng, mode=None, **_):
    return _perm_tax(claim, rng, mode or rng.choice(["doubled", "omitted"]))


def perm_pre_discount_price(claim, rng, **_):
    c = claim["claim"]
    discounted = [li for li in c["line_items"] if li["discount"] > 0]
    if discounted:
        item = rng.choice(discounted)
        old = item["total_price"]
        pre = old + item["discount"]
        item["total_price"] = money(pre)
        c["subtotal"] = money(c["subtotal"] + item["discount"])
        c["claimed_total"] = money(c["claimed_total"] + item["discount"])
        return {"permutation": "pre-discount-price",
                "detail": f"line '{item['description']}' claimed at pre-discount {pre} "
                          f"instead of {old}",
                "expected_finding": f"Discounted item '{item['description']}' claimed at its "
                                    f"pre-discount price {pre} (discount of {item['discount']} ignored)."}
    if c["discount"] > 0:
        old_total = c["claimed_total"]
        c["claimed_total"] = money(old_total + c["discount"])
        return {"permutation": "pre-discount-price",
                "detail": f"receipt-level discount {c['discount']} not applied: "
                          f"claimed_total {old_total} -> {c['claimed_total']}",
                "expected_finding": f"Receipt discount of {c['discount']} was not deducted "
                                    "from the claimed total."}
    return None


def perm_non_reimbursable(claim, rng, policy, **_):
    c = claim["claim"]
    hits = [li for li in c["line_items"] if li["category"] in policy["non_reimbursable_categories"]]
    if hits:
        names = ", ".join(f"'{li['description']}' ({li['category']})" for li in hits)
        return {"permutation": "non-reimbursable",
                "detail": f"receipt already contains non-reimbursable item(s): {names}",
                "expected_finding": f"Claim contains non-reimbursable item(s) under policy: {names}."}
    category = rng.choice(list(policy["non_reimbursable_categories"]))
    spec = policy["non_reimbursable_categories"][category]
    template = rng.choice(spec["injectable_items"])
    item = {"description": template["description"], "category": category,
            "quantity": 1, "unit_price": template["unit_price"],
            "total_price": template["unit_price"], "discount": 0}
    c["line_items"].append(item)
    c["subtotal"] = money(c["subtotal"] + item["total_price"])
    c["claimed_total"] = money(c["claimed_total"] + item["total_price"])
    return {"permutation": "non-reimbursable",
            "detail": f"injected '{item['description']}' ({category}, {item['total_price']}) "
                      "into line_items, subtotal and claimed_total",
            "expected_finding": f"Claim contains non-reimbursable {category} item "
                                f"'{item['description']}' under policy '{policy['policy_name']}'."}


PERMUTATIONS = {
    "wrong-total": perm_wrong_total,
    "cash-as-total": perm_cash_as_total,
    "change-claimed": perm_change_claimed,
    "items-mismatch-subtotal": perm_items_mismatch_subtotal,
    "tax-error": perm_tax_error,
    "tax-doubled": lambda c, r, **kw: perm_tax_error(c, r, mode="doubled", **kw),
    "tax-omitted": lambda c, r, **kw: perm_tax_error(c, r, mode="omitted", **kw),
    "pre-discount-price": perm_pre_discount_price,
    "non-reimbursable": perm_non_reimbursable,
}
CANONICAL_ORDER = ["wrong-total", "cash-as-total", "change-claimed",
                   "items-mismatch-subtotal", "tax-error", "pre-discount-price",
                   "non-reimbursable"]


def resolve_permutations(spec: str, rng: random.Random) -> list[str]:
    """Parse --permutations: comma-separated names | 'all' | an integer N."""
    spec = (spec or "").strip()
    if not spec:
        return []
    if spec.lower() == "all":
        return list(CANONICAL_ORDER)
    if spec.isdigit():
        n = int(spec)
        if not 1 <= n <= len(CANONICAL_ORDER):
            sys.exit(f"N must be 1..{len(CANONICAL_ORDER)}, got {n}")
        return rng.sample(CANONICAL_ORDER, n)
    names = [s.strip().lower().replace("_", "-") for s in spec.split(",") if s.strip()]
    unknown = [n for n in names if n not in PERMUTATIONS]
    if unknown:
        sys.exit(f"Unknown permutation(s): {', '.join(unknown)}\n"
                 f"Valid: {', '.join(CANONICAL_ORDER)} (plus tax-doubled, tax-omitted)")
    return names


# --------------------------------------------------------------------------- #
# Main                                                                         #
# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Generate a synthetic employee expense claim from a random CORD v2 receipt.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Permutations: " + ", ".join(CANONICAL_ORDER) +
               "\nUse --permutations all, an integer N, or a comma-separated list.")
    ap.add_argument("--split", choices=sorted(SHARDS), default="train")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed for reproducibility")
    ap.add_argument("--receipt-index", type=int, default=None,
                    help="Deterministic receipt index within the split (overrides random pick)")
    ap.add_argument("--permutations", "-p", default="",
                    help="'all', integer N, or comma-separated names")
    ap.add_argument("--policy", type=Path, default=None, help="Path to reimbursement policy JSON")
    ap.add_argument("--currency", default="IDR")
    ap.add_argument("--out", type=Path, default=None, help="Write claim JSON here (default: stdout)")
    ap.add_argument("--report", type=Path, default=None,
                    help="Write provenance + applied-permutation report JSON here")
    ap.add_argument("--post", metavar="URL", default=None, help="POST the claim JSON to URL")
    ap.add_argument("--header", action="append", default=[],
                    help="Extra header for --post, e.g. --header 'Authorization: Bearer x'")
    ap.add_argument("--list-permutations", action="store_true")
    args = ap.parse_args()

    if args.list_permutations:
        print("\n".join(CANONICAL_ORDER + ["tax-doubled", "tax-omitted"]))
        return

    rng = random.Random(args.seed)
    policy = json.loads(args.policy.read_text()) if args.policy else DEFAULT_POLICY

    total_rows = sum(c for _, c in SHARDS[args.split])
    index = args.receipt_index if args.receipt_index is not None else rng.randrange(total_rows)
    receipt = fetch_receipt(args.split, index)

    claim = build_claim(receipt, policy, args.currency, rng)
    receipt_total = parse_amount(first_dict(receipt["gt_parse"].get("total")).get("total_price"))

    applied, skipped = [], []
    for name in resolve_permutations(args.permutations, rng):
        entry = PERMUTATIONS[name](claim, rng, policy=policy)
        if entry:
            applied.append(entry)
        else:
            skipped.append(name)

    payload = json.dumps(claim, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(payload + "\n")
    else:
        print(payload)

    # Provenance + expectations, for validating a claim checker afterwards.
    report = {
        "seed": args.seed,
        "receipt": {
            "dataset": DATASET, "split": args.split,
            "global_index": index, "shard_path": receipt["shard_path"],
            "shard_offset": receipt["shard_offset"],
            "image_id": receipt["meta"].get("image_id"),
            "receipt_total_price": receipt_total,
            "gt_parse": receipt["gt_parse"],
        },
        "permutations_applied": applied,
        "permutations_skipped_not_applicable": skipped,
    }
    if args.report:
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")

    summary = [f"receipt: {args.split}#{index} (image_id={report['receipt']['image_id']}, "
               f"receipt total={receipt_total}, currency={args.currency})"]
    summary += [f"  + {a['permutation']}: {a['detail']}" for a in applied]
    summary += [f"  - skipped (not applicable): {s}" for s in skipped]
    print("\n".join(summary), file=sys.stderr)

    if args.post:
        headers = {"Content-Type": "application/json"}
        for h in args.header:
            k, _, v = h.partition(":")
            headers[k.strip()] = v.strip()
        req = urllib.request.Request(args.post, data=payload.encode(),
                                     headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                print(f"POST {args.post} -> {resp.status}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            sys.exit(f"POST to {args.post} failed: {exc}")


if __name__ == "__main__":
    main()
