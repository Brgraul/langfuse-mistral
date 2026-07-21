import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowUpRight,
  Receipt,
  ScanLine,
  FileText,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Paperclip,
  Calculator,
  Coins,
  Percent,
  Tag,
  Ban,
  Banknote,
  ArrowRight,
  Minus,
  Equal,
} from "lucide-react";
import receiptImg from "@/assets/receipt-mock.jpg";
import generatedClaims from "@/data/claims.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Receipt Review — Expense Reimbursement" },
      { name: "description", content: "Compare employee expense claims against OCR-extracted receipt data and assess reimbursement." },
      { property: "og:title", content: "Receipt Review — Expense Reimbursement" },
      { property: "og:description", content: "Compare employee expense claims against OCR-extracted receipt data and assess reimbursement." },
    ],
  }),
  component: Index,
});

type Verdict = "approve" | "partial" | "reject" | "escalate";
type Severity = "info" | "warn" | "block";

type Line = { label: string; claim: string; ocr: string; match: boolean; issue?: string };
type PolicyHit = { code: string; title: string; detail: string };
type Evidence = { label: string; detail: string; done: boolean };

type Finding =
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

type Claim = {
  id: string;
  employee: string;
  submitted: string;
  category: string;
  merchantClaim: string;
  totalClaim: number;
  totalOcr: number;
  currency: string;
  lines: Line[];
  verdict: Verdict;
  reimburseAmount: number;
  rationale: string[];
  policies: PolicyHit[];
  evidence: Evidence[];
  findings: Finding[];
  image: string;
};

const mockClaims: Claim[] = [
  {
    id: "EXP-10421",
    employee: "Amelia Chen",
    submitted: "Jul 18, 2026",
    category: "Client Dinner",
    merchantClaim: "The Copper Kettle",
    totalClaim: 84.5,
    totalOcr: 84.5,
    currency: "USD",
    lines: [
      { label: "Merchant", claim: "The Copper Kettle", ocr: "The Copper Kettle Restaurant", match: true },
      { label: "Date", claim: "Jul 16, 2026", ocr: "Jul 16, 2026", match: true },
      { label: "Subtotal", claim: "$76.82", ocr: "$76.82", match: true },
      { label: "Tax", claim: "$7.68", ocr: "$7.68", match: true },
      { label: "Total", claim: "$84.50", ocr: "$84.50", match: true },
      { label: "Category", claim: "Client Dinner", ocr: "Restaurant", match: true },
    ],
    verdict: "approve",
    reimburseAmount: 84.5,
    rationale: [
      "All extracted fields match the employee claim within tolerance.",
      "Amount is within the $150 per-attendee client dinner cap.",
      "No policy exceptions triggered.",
    ],
    policies: [],
    evidence: [],
    findings: [],
    image: receiptImg,
  },
  {
    id: "EXP-10422",
    employee: "Marcus Alvarez",
    submitted: "Jul 17, 2026",
    category: "Team Lunch",
    merchantClaim: "The Copper Kettle",
    totalClaim: 142.0,
    totalOcr: 118.25,
    currency: "USD",
    lines: [
      { label: "Merchant", claim: "The Copper Kettle", ocr: "The Copper Kettle Restaurant", match: true },
      { label: "Date", claim: "Jul 15, 2026", ocr: "Jul 15, 2026", match: true },
      { label: "Subtotal", claim: "$107.50", ocr: "$107.50", match: true },
      { label: "Tax", claim: "$21.60", ocr: "$10.75", match: false, issue: "Tax appears double-counted" },
      { label: "Tip", claim: "$12.90", ocr: "—", match: false, issue: "Tip not itemized on receipt" },
      { label: "Total", claim: "$142.00", ocr: "$118.25", match: false, issue: "Total exceeds OCR by $23.75" },
    ],
    verdict: "partial",
    reimburseAmount: 118.25,
    rationale: [
      "Claim total exceeds the receipt total by $23.75.",
      "Tax appears to have been added twice on the claim form.",
      "Recommend reimbursing the documented amount of $118.25.",
    ],
    policies: [
      { code: "T&E-4.2", title: "Documented totals only", detail: "Reimbursable amount cannot exceed the total printed on the receipt." },
      { code: "T&E-5.1", title: "Tax accuracy", detail: "Tax reimbursed must equal the tax printed on the receipt." },
    ],
    evidence: [
      { label: "Signed credit card slip", detail: "To justify the $12.90 tip line.", done: false },
      { label: "Attendee list", detail: "Required for meals over $100.", done: true },
    ],
    findings: [
      {
        type: "total_mismatch",
        severity: "block",
        impact: 23.75,
        claimedTotal: 142.0,
        receiptTotal: 118.25,
        note: "Claim exceeds printed receipt total.",
      },
      {
        type: "tax_error",
        severity: "warn",
        impact: 10.85,
        mode: "double",
        subtotal: 107.5,
        rate: 0.1,
        printedTax: 10.75,
        claimedTax: 21.6,
      },
    ],
    image: receiptImg,
  },
  {
    id: "EXP-10423",
    employee: "Priya Natarajan",
    submitted: "Jul 15, 2026",
    category: "Fuel",
    merchantClaim: "Shell Station #418",
    totalClaim: 80.0,
    totalOcr: 62.4,
    currency: "USD",
    lines: [
      { label: "Merchant", claim: "Shell Station #418", ocr: "Shell Station #418", match: true },
      { label: "Date", claim: "Jul 14, 2026", ocr: "Jul 14, 2026", match: true },
      { label: "Purchase total", claim: "—", ocr: "$62.40", match: false, issue: "Claim used cash tendered, not purchase total" },
      { label: "Amount tendered", claim: "$80.00", ocr: "$80.00", match: true },
      { label: "Change", claim: "$17.60 (claimed)", ocr: "$17.60", match: false, issue: "Change was claimed as an expense" },
      { label: "Total claimed", claim: "$80.00", ocr: "$62.40", match: false, issue: "Overclaim of $17.60" },
    ],
    verdict: "partial",
    reimburseAmount: 62.4,
    rationale: [
      "Employee claimed the cash tendered ($80.00) rather than the purchase total ($62.40).",
      "The $17.60 in change returned was included in the claim.",
      "Reimburse the actual purchase total: $62.40.",
    ],
    policies: [
      { code: "T&E-2.1", title: "Reimburse purchase total only", detail: "Reimbursement is based on the printed purchase total, never cash tendered or rounded amounts." },
      { code: "T&E-2.3", title: "Change is not an expense", detail: "Change returned to the employee cannot be reimbursed." },
    ],
    evidence: [],
    findings: [
      {
        type: "cashprice_used",
        severity: "block",
        impact: 17.6,
        totalPrice: 62.4,
        cashPrice: 80.0,
        claimed: 80.0,
      },
      {
        type: "change_as_expense",
        severity: "block",
        impact: 17.6,
        amountTendered: 80.0,
        receiptTotal: 62.4,
        change: 17.6,
      },
    ],
    image: receiptImg,
  },
  {
    id: "EXP-10424",
    employee: "Jordan Lee",
    submitted: "Jul 19, 2026",
    category: "Client Dinner",
    merchantClaim: "The Copper Kettle",
    totalClaim: 612.0,
    totalOcr: 612.0,
    currency: "USD",
    lines: [
      { label: "Merchant", claim: "The Copper Kettle", ocr: "The Copper Kettle Restaurant", match: true },
      { label: "Date", claim: "Jul 12, 2026", ocr: "Jul 12, 2026", match: true },
      { label: "Subtotal", claim: "$540.00", ocr: "$540.00", match: true },
      { label: "Tax + Tip", claim: "$72.00", ocr: "$72.00", match: true },
      { label: "Total", claim: "$612.00", ocr: "$612.00", match: true, issue: "Total exceeds VP approval threshold" },
      { label: "Attendees", claim: "3 (internal)", ocr: "—", match: false, issue: "No external client listed" },
    ],
    verdict: "escalate",
    reimburseAmount: 468.0,
    rationale: [
      "Receipt data matches claim but includes $144 of alcohol, which is non-reimbursable.",
      "Amount exceeds the $500 VP-level approval threshold.",
      "Category is Client Dinner but no external attendee was listed.",
    ],
    policies: [
      { code: "T&E-6.3", title: "VP approval required over $500", detail: "Any single meal exceeding $500 requires written VP-level approval before reimbursement." },
      { code: "T&E-2.7", title: "Alcohol non-reimbursable", detail: "Alcoholic beverages are excluded from meal reimbursements under corporate policy." },
      { code: "T&E-4.5", title: "External attendee required", detail: "Client Dinner category requires at least one non-employee attendee to be listed." },
    ],
    evidence: [
      { label: "VP written approval", detail: "Sign-off from department VP for meals over $500.", done: false },
      { label: "External attendee names", detail: "Client name(s) and affiliation.", done: false },
    ],
    findings: [
      {
        type: "policy_items",
        severity: "block",
        impact: 144.0,
        items: [
          { label: "Entrées ×3", price: 210.0, blocked: false },
          { label: "Appetizer platter", price: 64.0, blocked: false },
          { label: "Bottle of red wine", price: 96.0, blocked: true, policyCode: "T&E-2.7 Alcohol" },
          { label: "Cocktails ×2", price: 48.0, blocked: true, policyCode: "T&E-2.7 Alcohol" },
          { label: "Desserts ×3", price: 50.0, blocked: false },
          { label: "Coffee ×3", price: 22.0, blocked: false },
          { label: "Tax + Tip", price: 122.0, blocked: false },
        ],
      },
    ],
    image: receiptImg,
  },
  {
    id: "EXP-10425",
    employee: "Sofia Rossi",
    submitted: "Jul 20, 2026",
    category: "Office Supplies",
    merchantClaim: "Staples",
    totalClaim: 138.5,
    totalOcr: 121.3,
    currency: "USD",
    lines: [
      { label: "Merchant", claim: "Staples", ocr: "Staples #221", match: true },
      { label: "Date", claim: "Jul 19, 2026", ocr: "Jul 19, 2026", match: true },
      { label: "Subtotal", claim: "$126.00", ocr: "$110.27", match: false, issue: "Line items don't sum to claimed subtotal" },
      { label: "Tax", claim: "$12.50", ocr: "$11.03", match: false, issue: "Tax scales with subtotal error" },
      { label: "Total", claim: "$138.50", ocr: "$121.30", match: false, issue: "Total inflated by ~$17.20" },
    ],
    verdict: "partial",
    reimburseAmount: 121.3,
    rationale: [
      "Line items on the receipt sum to $110.27, not the claimed $126.00.",
      "A promoted item was claimed at list price, ignoring the printed discount.",
      "Reimburse against the printed receipt total of $121.30.",
    ],
    policies: [
      { code: "T&E-3.2", title: "Line items must sum", detail: "Subtotal reimbursed must equal the sum of itemized line prices on the receipt." },
      { code: "T&E-3.3", title: "Honor printed discounts", detail: "Items must be reimbursed at the net (post-discount) price shown on the receipt." },
    ],
    evidence: [],
    findings: [
      {
        type: "subtotal_math",
        severity: "warn",
        impact: 5.73,
        items: [
          { label: "Notebooks ×4", price: 32.0 },
          { label: "Pens ×2 packs", price: 14.5 },
          { label: "Printer paper", price: 24.99 },
          { label: "Toner cartridge", price: 38.78 },
        ],
        printedSubtotal: 110.27,
      },
      {
        type: "discount_ignored",
        severity: "warn",
        impact: 10.0,
        item: "Toner cartridge (promo)",
        listPrice: 48.78,
        discount: 10.0,
        netPrice: 38.78,
        claimedPrice: 48.78,
      },
    ],
    image: receiptImg,
  },
];

// Real data generated by the Python pipeline (python main.py --export-frontend).
// Falls back to the mock claims if the export hasn't been run yet.
const generated = generatedClaims as unknown as Claim[];
const claims: Claim[] = generated.length > 0 ? generated : mockClaims;

const verdictConfig: Record<
  Verdict,
  { label: string; short: string; icon: typeof CheckCircle2; tone: string; ring: string; dot: string; accent: string }
> = {
  approve: {
    label: "Approve — Full reimbursement",
    short: "Approve",
    icon: CheckCircle2,
    tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
    ring: "ring-emerald-500/20",
    dot: "bg-emerald-500",
    accent: "text-emerald-700",
  },
  partial: {
    label: "Partial reimbursement",
    short: "Partial",
    icon: AlertTriangle,
    tone: "text-amber-800 bg-amber-50 border-amber-200",
    ring: "ring-amber-500/20",
    dot: "bg-amber-500",
    accent: "text-amber-700",
  },
  reject: {
    label: "Reject — Do not reimburse",
    short: "Reject",
    icon: XCircle,
    tone: "text-rose-700 bg-rose-50 border-rose-200",
    ring: "ring-rose-500/20",
    dot: "bg-rose-500",
    accent: "text-rose-700",
  },
  escalate: {
    label: "Escalate for approval",
    short: "Escalate",
    icon: ArrowUpRight,
    tone: "text-indigo-700 bg-indigo-50 border-indigo-200",
    ring: "ring-indigo-500/20",
    dot: "bg-indigo-500",
    accent: "text-indigo-700",
  },
};

const findingMeta: Record<Finding["type"], { label: string; icon: typeof Calculator }> = {
  total_mismatch: { label: "Total mismatch", icon: Calculator },
  cashprice_used: { label: "Cash tendered claimed", icon: Banknote },
  change_as_expense: { label: "Change claimed as expense", icon: Coins },
  subtotal_math: { label: "Line items don't sum", icon: Calculator },
  tax_error: { label: "Tax error", icon: Percent },
  discount_ignored: { label: "Discount ignored", icon: Tag },
  policy_items: { label: "Non-reimbursable items", icon: Ban },
};

const severityTone: Record<Severity, { chip: string; dot: string; ring: string; impact: string }> = {
  info: {
    chip: "border-neutral-200 bg-neutral-50 text-neutral-700",
    dot: "bg-neutral-400",
    ring: "ring-neutral-200",
    impact: "bg-neutral-100 text-neutral-700",
  },
  warn: {
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    ring: "ring-amber-200",
    impact: "bg-amber-100 text-amber-800",
  },
  block: {
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
    ring: "ring-rose-200",
    impact: "bg-rose-100 text-rose-700",
  },
};

const money = (n: number) => `$${n.toFixed(2)}`;

function Index() {
  const [idx, setIdx] = useState(0);
  const [decision, setDecision] = useState<Verdict | null>(null);
  const claim = claims[idx];
  const suggested = claim.verdict;
  const active = decision ?? suggested;
  const v = verdictConfig[active];
  const VIcon = v.icon;
  const mismatches = claim.lines.filter((l) => !l.match);

  const goto = (n: number) => {
    setDecision(null);
    setIdx(n);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <Receipt className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">Receipt Review</h1>
              <p className="text-xs text-neutral-500">Expense reimbursement queue</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goto((idx - 1 + claims.length) % claims.length)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition hover:bg-neutral-50"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-neutral-500 tabular-nums">
              {idx + 1} / {claims.length}
            </span>
            <button
              onClick={() => goto((idx + 1) % claims.length)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition hover:bg-neutral-50"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
              <span className="font-mono">{claim.id}</span>
              <span>·</span>
              <span>Submitted {claim.submitted}</span>
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{claim.employee}</h2>
            <p className="text-sm text-neutral-600">
              {claim.category} · {claim.merchantClaim}
            </p>
          </div>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ring-4 ${v.tone} ${v.ring}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
            Suggested: {verdictConfig[suggested].short}
          </div>
        </div>

        {/* Findings strip */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Findings
          </span>
          {claim.findings.length === 0 ? (
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> No issues detected
            </span>
          ) : (
            claim.findings.map((f, i) => {
              const meta = findingMeta[f.type];
              const tone = severityTone[f.severity];
              const Icon = meta.icon;
              return (
                <span
                  key={i}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.chip}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                  <span className={`ml-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${tone.impact}`}>
                    −{money(f.impact)}
                  </span>
                </span>
              );
            })
          )}
          <span className="ml-auto text-xs text-neutral-500">
            {claim.findings.length} issue{claim.findings.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Receipt image */}
          <section className="lg:col-span-4">
            <Card>
              <SectionTitle icon={<Receipt className="h-3.5 w-3.5" />} label="Original receipt" />
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                <img
                  src={claim.image}
                  alt="Submitted receipt"
                  loading="lazy"
                  width={1024}
                  height={1024}
                  className="h-auto w-full object-cover"
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
                <span>receipt.jpg</span>
                <span>OCR confidence · 96%</span>
              </div>
            </Card>
          </section>

          {/* Comparison + Findings */}
          <section className="lg:col-span-5 space-y-4">
            <Card>
              <SectionTitle icon={<ScanLine className="h-3.5 w-3.5" />} label="Claim vs. OCR extraction" />
              <div className="overflow-hidden rounded-lg border border-neutral-200">
                <div className="grid grid-cols-12 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  <div className="col-span-3">Field</div>
                  <div className="col-span-4">Employee claim</div>
                  <div className="col-span-4">OCR extracted</div>
                  <div className="col-span-1 text-right">Match</div>
                </div>
                {claim.lines.map((l, i) => (
                  <div
                    key={i}
                    className={`grid grid-cols-12 items-start px-4 py-3 text-sm ${
                      i !== claim.lines.length - 1 ? "border-b border-neutral-100" : ""
                    } ${!l.match ? "bg-rose-50/40" : ""}`}
                  >
                    <div className="col-span-3 pt-0.5 text-xs font-medium text-neutral-500">{l.label}</div>
                    <div className="col-span-4 text-neutral-900">{l.claim}</div>
                    <div className="col-span-4">
                      <div className={`font-mono text-xs ${l.match ? "text-neutral-700" : "text-rose-700"}`}>{l.ocr}</div>
                      {l.issue && <div className="mt-0.5 text-[11px] text-rose-600">{l.issue}</div>}
                    </div>
                    <div className="col-span-1 flex justify-end pt-0.5">
                      {l.match ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <Stat label="Claimed" value={money(claim.totalClaim)} />
                <Stat label="OCR total" value={money(claim.totalOcr)} delta={claim.totalClaim - claim.totalOcr} />
                <Stat label="Mismatches" value={`${mismatches.length}`} muted />
              </div>
            </Card>

            {claim.findings.map((f, i) => (
              <FindingCard key={i} finding={f} />
            ))}
          </section>

          {/* Evaluation */}
          <section className="lg:col-span-3 space-y-4">
            <Card>
              <SectionTitle icon={<FileText className="h-3.5 w-3.5" />} label="Recommendation" />
              <div className={`flex items-start gap-3 rounded-lg border p-4 ${v.tone}`}>
                <VIcon className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{v.label}</p>
                  <p className="mt-0.5 text-xs opacity-80">
                    Reimburse {money(claim.reimburseAmount)} of {money(claim.totalClaim)}
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-2">
                {claim.rationale.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-neutral-700">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Card>

            {claim.policies.length > 0 && (
              <Card>
                <SectionTitle icon={<BookOpen className="h-3.5 w-3.5" />} label="Policy rules triggered" />
                <ul className="space-y-2.5">
                  {claim.policies.map((p) => (
                    <li key={p.code} className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                          {p.code}
                        </span>
                        <span className="text-sm font-medium text-neutral-900">{p.title}</span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-neutral-600">{p.detail}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {claim.evidence.length > 0 && (
              <Card>
                <SectionTitle icon={<Paperclip className="h-3.5 w-3.5" />} label="Additional evidence needed" />
                <ul className="space-y-2">
                  {claim.evidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          e.done ? "border-emerald-500 bg-emerald-500" : "border-neutral-300 bg-white"
                        }`}
                      >
                        {e.done && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </span>
                      <div>
                        <div className={`text-sm ${e.done ? "text-neutral-500 line-through" : "font-medium text-neutral-900"}`}>
                          {e.label}
                        </div>
                        <div className="text-[11px] text-neutral-500">{e.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </div>

        {/* Reimbursable math breakdown */}
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <SectionTitle icon={<Calculator className="h-3.5 w-3.5" />} label="Reimbursable calculation" />
          <div className="flex flex-wrap items-center gap-3">
            <MathChip label="Claimed" value={money(claim.totalClaim)} tone="neutral" />
            {claim.findings.map((f, i) => {
              const meta = findingMeta[f.type];
              return (
                <div key={i} className="flex items-center gap-3">
                  <Minus className="h-4 w-4 text-neutral-400" />
                  <MathChip label={meta.label} value={money(f.impact)} tone={f.severity} />
                </div>
              );
            })}
            <Equal className="h-4 w-4 text-neutral-400" />
            <MathChip label="Reimbursable" value={money(claim.reimburseAmount)} tone="result" />
          </div>
        </div>

        {/* Decision bar */}
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Reviewer decision</div>
              <div className="mt-1 text-sm text-neutral-600">
                Confirm the recommended action or override with your own assessment.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(verdictConfig) as Verdict[]).map((k) => {
                const cfg = verdictConfig[k];
                const isActive = active === k;
                const Icon = cfg.icon;
                return (
                  <button
                    key={k}
                    onClick={() => setDecision(k)}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition ${
                      isActive ? `${cfg.tone} border-current` : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {cfg.short}
                    {k === suggested && !decision && (
                      <span className="ml-1 rounded-sm bg-white/60 px-1 text-[10px] font-semibold uppercase tracking-wide">
                        Suggested
                      </span>
                    )}
                  </button>
                );
              })}
              <button className="ml-2 rounded-md bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-neutral-800">
                Submit decision
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const meta = findingMeta[finding.type];
  const tone = severityTone[finding.severity];
  const Icon = meta.icon;

  return (
    <div className={`rounded-xl border border-neutral-200 bg-white p-5 shadow-sm ring-1 ${tone.ring}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded ${tone.chip} border-0`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              <span className="text-sm font-semibold text-neutral-900">{meta.label}</span>
            </div>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 font-mono text-xs font-medium ${tone.impact}`}>
          Impact −{money(finding.impact)}
        </span>
      </div>
      <FindingBody finding={finding} />
    </div>
  );
}

function FindingBody({ finding }: { finding: Finding }) {
  switch (finding.type) {
    case "total_mismatch":
      return (
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Claimed total" value={money(finding.claimedTotal)} tone="rose" />
          <MiniStat label="Receipt total" value={money(finding.receiptTotal)} tone="neutral" />
          {finding.note && <p className="col-span-2 text-xs text-neutral-600">{finding.note}</p>}
        </div>
      );

    case "cashprice_used":
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MiniStat label="Purchase total" value={money(finding.totalPrice)} tone="emerald" />
            <ArrowRight className="h-4 w-4 text-neutral-400" />
            <MiniStat label="Cash tendered" value={money(finding.cashPrice)} tone="rose" annotation="claimed" />
          </div>
          <p className="text-xs text-neutral-600">
            Employee reimbursed the cash tendered instead of the actual purchase total. Reimburse against{" "}
            <span className="font-medium text-neutral-900">{money(finding.totalPrice)}</span>.
          </p>
        </div>
      );

    case "change_as_expense":
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 font-mono text-xs">
            <span>{money(finding.amountTendered)}</span>
            <Minus className="h-3.5 w-3.5 text-neutral-400" />
            <span>{money(finding.receiptTotal)}</span>
            <Equal className="h-3.5 w-3.5 text-neutral-400" />
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">{money(finding.change)} change</span>
          </div>
          <p className="text-xs text-neutral-600">
            The change returned to the employee was included in the reimbursement claim. Deduct{" "}
            <span className="font-medium text-neutral-900">{money(finding.change)}</span>.
          </p>
        </div>
      );

    case "subtotal_math": {
      const sum = finding.items.reduce((a, b) => a + b.price, 0);
      const delta = finding.printedSubtotal - sum;
      return (
        <div className="space-y-2">
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 text-sm">
            {finding.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-2">
                <span className="text-neutral-700">{it.label}</span>
                <span className="font-mono text-xs text-neutral-900">{money(it.price)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between bg-neutral-50/60 px-3 py-2 text-xs font-medium">
              <span className="text-neutral-500">Sum of items</span>
              <span className="font-mono text-neutral-900">{money(sum)}</span>
            </li>
            <li className="flex items-center justify-between bg-neutral-50/60 px-3 py-2 text-xs font-medium">
              <span className="text-neutral-500">Printed subtotal</span>
              <span className="font-mono text-neutral-900">{money(finding.printedSubtotal)}</span>
            </li>
            <li className="flex items-center justify-between bg-rose-50 px-3 py-2 text-xs font-semibold">
              <span className="text-rose-700">Delta</span>
              <span className="font-mono text-rose-700">
                {delta >= 0 ? "+" : "−"}
                {money(Math.abs(delta))}
              </span>
            </li>
          </ul>
        </div>
      );
    }

    case "tax_error": {
      const expected = finding.subtotal * finding.rate;
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label={`Expected (${(finding.rate * 100).toFixed(0)}%)`} value={money(expected)} tone="neutral" />
            <MiniStat label="Printed tax" value={money(finding.printedTax)} tone="emerald" />
            <MiniStat label="Claimed tax" value={money(finding.claimedTax)} tone="rose" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                finding.mode === "double" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
              }`}
            >
              {finding.mode === "double" ? "Double-counted" : "Missing / under-reported"}
            </span>
            <span className="text-xs text-neutral-600">
              {finding.mode === "double"
                ? "Claimed tax is roughly 2× the printed tax on the receipt."
                : "Claimed tax is below the tax printed on the receipt."}
            </span>
          </div>
        </div>
      );
    }

    case "discount_ignored":
      return (
        <div className="space-y-3">
          <div className="rounded-lg border border-neutral-200 p-3">
            <div className="mb-2 text-sm font-medium text-neutral-900">{finding.item}</div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-neutral-500">List</span>
              <span className="text-neutral-500 line-through">{money(finding.listPrice)}</span>
              <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-neutral-500">Discount</span>
              <span className="text-emerald-700">−{money(finding.discount)}</span>
              <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-neutral-500">Net</span>
              <span className="text-neutral-900">{money(finding.netPrice)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">
              Claimed at list: {money(finding.claimedPrice)}
            </span>
            <span className="text-neutral-600">Reimburse net price {money(finding.netPrice)}.</span>
          </div>
        </div>
      );

    case "policy_items":
      return (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 text-sm">
          {finding.items.map((it, i) => (
            <li
              key={i}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${it.blocked ? "bg-rose-50/40" : ""}`}
            >
              <div className="flex items-center gap-2">
                {it.blocked ? (
                  <Ban className="h-3.5 w-3.5 text-rose-500" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                )}
                <span className={it.blocked ? "text-rose-700" : "text-neutral-800"}>{it.label}</span>
                {it.policyCode && (
                  <span className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-white">
                    {it.policyCode}
                  </span>
                )}
              </div>
              <span
                className={`font-mono text-xs ${
                  it.blocked ? "text-rose-700 line-through" : "text-neutral-900"
                }`}
              >
                {money(it.price)}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

function MiniStat({
  label,
  value,
  tone = "neutral",
  annotation,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "rose" | "emerald";
  annotation?: string;
}) {
  const toneCls =
    tone === "rose"
      ? "border-rose-200 bg-rose-50"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50"
        : "border-neutral-200 bg-neutral-50/60";
  const valueCls = tone === "rose" ? "text-rose-700" : tone === "emerald" ? "text-emerald-700" : "text-neutral-900";
  return (
    <div className={`flex-1 rounded-lg border px-3 py-2 ${toneCls}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${valueCls}`}>{value}</div>
      {annotation && <div className="text-[10px] uppercase tracking-wide text-rose-600">{annotation}</div>}
    </div>
  );
}

function MathChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | Severity | "result";
}) {
  const cls =
    tone === "result"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : tone === "block"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-neutral-200 bg-white text-neutral-800";
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">{children}</div>;
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      <span className="flex h-5 w-5 items-center justify-center rounded bg-neutral-100 text-neutral-600">{icon}</span>
      {label}
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  muted,
}: {
  label: string;
  value: string;
  delta?: number;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className={`text-lg font-semibold tabular-nums ${muted ? "text-neutral-600" : ""}`}>{value}</span>
        {delta !== undefined && Math.abs(delta) > 0.001 && (
          <span className={`text-xs font-medium ${delta > 0 ? "text-rose-600" : "text-emerald-600"}`}>
            {delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
