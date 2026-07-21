// Maps the backend's flat Finding shape (receipt_recon/schemas.py::Finding) onto
// the frontend's richer discriminated-union Finding type used for per-type
// visualizations in src/routes/index.tsx.

import type { BackendFinding } from "./receipt-api";

export type Severity = "info" | "warn" | "block";

export type Finding =
  | {
      type: "total_mismatch";
      severity: Severity;
      impact: number;
      claimedTotal: number;
      receiptTotal: number;
      note?: string;
    }
  | {
      type: "cashprice_used";
      severity: Severity;
      impact: number;
      totalPrice: number;
      cashPrice: number;
      claimed: number;
    }
  | {
      type: "change_as_expense";
      severity: Severity;
      impact: number;
      amountTendered: number;
      receiptTotal: number;
      change: number;
    }
  | {
      type: "subtotal_math";
      severity: Severity;
      impact: number;
      items: { label: string; price: number }[];
      printedSubtotal: number;
    }
  | {
      type: "tax_error";
      severity: Severity;
      impact: number;
      mode: "double" | "missing";
      subtotal: number;
      rate: number;
      printedTax: number;
      claimedTax: number;
    }
  | {
      type: "discount_ignored";
      severity: Severity;
      impact: number;
      item: string;
      listPrice: number;
      discount: number;
      netPrice: number;
      claimedPrice: number;
    }
  | {
      type: "policy_items";
      severity: Severity;
      impact: number;
      items: { label: string; price: number; blocked: boolean; policyCode?: string }[];
    };

export function mapFinding(f: BackendFinding): Finding | null {
  switch (f.type) {
    case "total_mismatch":
      return {
        type: "total_mismatch",
        severity: f.severity,
        impact: f.impact,
        claimedTotal: f.claimed_total ?? 0,
        receiptTotal: f.receipt_total ?? 0,
        note: f.detail,
      };
    case "cashprice_used":
      return {
        type: "cashprice_used",
        severity: f.severity,
        impact: f.impact,
        totalPrice: f.receipt_total ?? 0,
        cashPrice: f.cash_price ?? 0,
        claimed: f.claimed_amount ?? 0,
      };
    case "change_as_expense":
      return {
        type: "change_as_expense",
        severity: f.severity,
        impact: f.impact,
        amountTendered: f.amount_tendered ?? 0,
        receiptTotal: f.receipt_total ?? 0,
        change: f.change ?? 0,
      };
    case "subtotal_math":
      return {
        type: "subtotal_math",
        severity: f.severity,
        impact: f.impact,
        items: (f.items ?? []).map((i) => ({ label: i.label, price: i.price })),
        printedSubtotal: f.printed_subtotal ?? 0,
      };
    case "tax_error":
      return {
        type: "tax_error",
        severity: f.severity,
        impact: f.impact,
        mode: f.tax_mode === "missing" ? "missing" : "double",
        subtotal: f.subtotal ?? 0,
        rate: f.tax_rate ?? 0,
        printedTax: f.printed_tax ?? 0,
        claimedTax: f.claimed_tax ?? 0,
      };
    case "discount_ignored":
      return {
        type: "discount_ignored",
        severity: f.severity,
        impact: f.impact,
        item: f.item_name ?? "item",
        listPrice: f.list_price ?? 0,
        discount: f.discount ?? 0,
        netPrice: f.net_price ?? 0,
        claimedPrice: f.claimed_price ?? 0,
      };
    case "policy_items":
      return {
        type: "policy_items",
        severity: f.severity,
        impact: f.impact,
        items: (f.items ?? []).map((i) => ({
          label: i.label,
          price: i.price,
          blocked: i.blocked,
          policyCode: i.policy_code ?? undefined,
        })),
      };
    default:
      // over_category_cap / missing_evidence / escalation_threshold have no
      // dedicated visualization yet — surfaced via the rationale text instead.
      return null;
  }
}

export function mapFindings(findings: BackendFinding[]): Finding[] {
  return findings.map(mapFinding).filter((f): f is Finding => f !== null);
}
