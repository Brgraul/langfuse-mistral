// Thin client for the receipt_recon FastAPI backend (receipt_recon/api.py).
// The backend runs on a separate port (uvicorn, default 8000) from the Vite
// dev server, so calls go cross-origin — CORS is enabled on the API side.

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export type BackendLineItem = {
  name: string;
  qty: number;
  unit_price: number;
  price: number;
};

export type BackendExtractedReceipt = {
  merchant: string | null;
  items: BackendLineItem[];
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number | null;
  payment_method: string | null;
  cash_price: number | null;
  change: number | null;
  raw_ocr_text: string | null;
  source: string | null;
};

export type BackendExpenseClaim = {
  claim_id: string;
  receipt_id: string;
  claimant: string;
  claimed_amount: number;
  claimed_items: BackendLineItem[];
  claimed_tax: number | null;
  claimed_discount: number | null;
  payment_method: string | null;
  policy_category: string;
  note: string | null;
  injected_inconsistency: string | null;
  expected_decision: string | null;
};

export type BackendFindingItem = {
  label: string;
  price: number;
  blocked: boolean;
  policy_code: string | null;
};

export type BackendFinding = {
  type: string;
  rule: string;
  severity: "info" | "warn" | "block";
  detail: string;
  impact: number;
  claimed_total?: number | null;
  receipt_total?: number | null;
  cash_price?: number | null;
  claimed_amount?: number | null;
  change?: number | null;
  amount_tendered?: number | null;
  items?: BackendFindingItem[] | null;
  printed_subtotal?: number | null;
  tax_mode?: string | null;
  printed_tax?: number | null;
  claimed_tax?: number | null;
  tax_rate?: number | null;
  subtotal?: number | null;
  item_name?: string | null;
  list_price?: number | null;
  discount?: number | null;
  net_price?: number | null;
  claimed_price?: number | null;
  cap?: number | null;
};

export type BackendDecision = {
  decision: "approve" | "partial" | "reject" | "escalate";
  reimbursable_amount: number;
  mismatched_field: string | null;
  policy_rule: string | null;
  evidence_needed: string | null;
  rationale: string;
  findings: BackendFinding[];
};

export type Sample = {
  receipt_id: string;
  image_url: string;
  ground_truth: BackendExtractedReceipt;
};

export type ReconcileResponse = {
  decision: BackendDecision;
  extracted: BackendExtractedReceipt;
  claim: BackendExpenseClaim;
  extraction_accuracy: {
    score: number;
    compared: number;
    correct: number;
    fields: Record<string, { ground_truth: unknown; extracted: unknown; match: boolean }>;
  } | null;
  decision_correct: { score: number; expected: string; actual: string } | null;
};

export type ReconcileRequest = {
  image_path: string;
  receipt_id: string;
  mock: boolean;
  ground_truth?: BackendExtractedReceipt;
  inconsistency?: string;
  seed?: number;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function fetchSamples(): Promise<Sample[]> {
  return get<Sample[]>("/samples");
}

export function fetchInconsistencies(): Promise<string[]> {
  return get<string[]>("/inconsistencies");
}

export function imageUrl(sample: Sample): string {
  return `${API_BASE}${sample.image_url}`;
}

export async function reconcile(payload: ReconcileRequest): Promise<ReconcileResponse> {
  const res = await fetch(`${API_BASE}/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST /reconcile failed: ${res.status} ${await res.text()}`);
  return res.json();
}
