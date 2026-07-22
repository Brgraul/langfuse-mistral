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
  LoaderCircle,
} from "lucide-react";
import {
  getRandomReceiptClaim,
  type Claim,
  type Finding,
  type Severity,
  type Verdict,
} from "@/lib/receipt-generator";

export const Route = createFileRoute("/")({
  loader: () => getRandomReceiptClaim(),
  head: () => ({
    meta: [
      { title: "Receipt Review — Expense Reimbursement" },
      {
        name: "description",
        content:
          "Review synthetic employee claims against Mistral OCR extraction of live CORD v2 receipts.",
      },
      {
        property: "og:title",
        content: "Receipt Review — Expense Reimbursement",
      },
      {
        property: "og:description",
        content:
          "Review synthetic employee claims against Mistral OCR extraction of live CORD v2 receipts.",
      },
    ],
  }),
  component: Index,
});

const verdictConfig: Record<
  Verdict,
  {
    label: string;
    short: string;
    icon: typeof CheckCircle2;
    tone: string;
    ring: string;
    dot: string;
    accent: string;
  }
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

const findingMeta: Record<
  Finding["type"],
  { label: string; icon: typeof Calculator }
> = {
  total_mismatch: { label: "Total mismatch", icon: Calculator },
  cashprice_used: { label: "Cash tendered claimed", icon: Banknote },
  change_as_expense: { label: "Change claimed as expense", icon: Coins },
  subtotal_math: { label: "Line items don't sum", icon: Calculator },
  tax_error: { label: "Tax error", icon: Percent },
  discount_ignored: { label: "Discount ignored", icon: Tag },
  policy_items: { label: "Non-reimbursable items", icon: Ban },
};

const severityTone: Record<
  Severity,
  { chip: string; dot: string; ring: string; impact: string }
> = {
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

const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const money = (n: number) => idrFormatter.format(Math.round(n));

function Index() {
  const initialClaim = Route.useLoaderData();
  const [claims, setClaims] = useState<Claim[]>([initialClaim]);
  const [idx, setIdx] = useState(0);
  const [decision, setDecision] = useState<Verdict | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const nextClaim = async () => {
    if (idx < claims.length - 1) {
      goto(idx + 1);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await getRandomReceiptClaim();
      setClaims((current) => [...current, next]);
      setDecision(null);
      setIdx(claims.length);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Unable to load another CORD receipt.",
      );
    } finally {
      setIsLoading(false);
    }
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
              <h1 className="text-sm font-semibold tracking-tight">
                Receipt Review
              </h1>
              <p className="text-xs text-neutral-500">
                Live CORD v2 reimbursement queue
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goto(idx - 1)}
              disabled={idx === 0 || isLoading}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-neutral-500 tabular-nums">
              {idx + 1} / {claims.length}
            </span>
            <button
              onClick={nextClaim}
              disabled={isLoading}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-60"
              aria-label={
                idx < claims.length - 1 ? "Next" : "Generate next receipt"
              }
            >
              {isLoading ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        {loadError && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <span>{loadError}</span>
            <button
              onClick={nextClaim}
              className="font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-neutral-500">
              <span className="font-mono">{claim.id}</span>
              <span>·</span>
              <span>Submitted {claim.submitted}</span>
              <span>·</span>
              <span className="font-mono">{claim.provenance.permutation}</span>
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {claim.employee}
            </h2>
            <p className="text-sm text-neutral-600">
              {claim.category} · {claim.merchantClaim}
            </p>
          </div>
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ring-4 ${v.tone} ${v.ring}`}
          >
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
                  <span
                    className={`ml-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${tone.impact}`}
                  >
                    −{money(f.impact)}
                  </span>
                </span>
              );
            })
          )}
          <span className="ml-auto text-xs text-neutral-500">
            {claim.findings.length} issue
            {claim.findings.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Receipt image */}
          <section className="lg:col-span-4">
            <Card>
              <SectionTitle
                icon={<Receipt className="h-3.5 w-3.5" />}
                label="Original receipt"
              />
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
                <img
                  src={claim.image}
                  alt={`CORD v2 ${claim.provenance.split} receipt ${claim.provenance.rowIndex}`}
                  loading="lazy"
                  width={claim.provenance.imageWidth}
                  height={claim.provenance.imageHeight}
                  className="h-auto w-full object-cover"
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
                <span className="font-mono">
                  {claim.provenance.split}/{claim.provenance.rowIndex}
                </span>
                <span>
                  {claim.provenance.ocrModel}
                  {claim.provenance.ocrConfidence !== null
                    ? ` · ${Math.round(claim.provenance.ocrConfidence * 100)}% confidence`
                    : ""}
                </span>
              </div>
            </Card>
          </section>

          {/* Comparison + Findings */}
          <section className="lg:col-span-5 space-y-4">
            <Card>
              <SectionTitle
                icon={<ScanLine className="h-3.5 w-3.5" />}
                label="Claim vs. Mistral OCR"
              />
              <div className="overflow-hidden rounded-lg border border-neutral-200">
                <div className="grid grid-cols-12 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  <div className="col-span-3">Field</div>
                  <div className="col-span-4">Employee claim</div>
                  <div className="col-span-4">Mistral OCR</div>
                  <div className="col-span-1 text-right">Match</div>
                </div>
                {claim.lines.map((l, i) => (
                  <div
                    key={i}
                    className={`grid grid-cols-12 items-start px-4 py-3 text-sm ${
                      i !== claim.lines.length - 1
                        ? "border-b border-neutral-100"
                        : ""
                    } ${!l.match ? "bg-rose-50/40" : ""}`}
                  >
                    <div className="col-span-3 pt-0.5 text-xs font-medium text-neutral-500">
                      {l.label}
                    </div>
                    <div className="col-span-4 text-neutral-900">{l.claim}</div>
                    <div className="col-span-4">
                      <div
                        className={`font-mono text-xs ${l.match ? "text-neutral-700" : "text-rose-700"}`}
                      >
                        {l.extracted}
                      </div>
                      {l.issue && (
                        <div className="mt-0.5 text-[11px] text-rose-600">
                          {l.issue}
                        </div>
                      )}
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
                <Stat
                  label="OCR total"
                  value={money(claim.totalOcr)}
                  delta={claim.totalClaim - claim.totalOcr}
                />
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
              <SectionTitle
                icon={<FileText className="h-3.5 w-3.5" />}
                label="Recommendation"
              />
              <div
                className={`flex items-start gap-3 rounded-lg border p-4 ${v.tone}`}
              >
                <VIcon className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{v.label}</p>
                  <p className="mt-0.5 text-xs opacity-80">
                    Reimburse {money(claim.reimburseAmount)} of{" "}
                    {money(claim.totalClaim)}
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-2">
                {claim.rationale.map((r, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm leading-relaxed text-neutral-700"
                  >
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Card>

            {claim.policies.length > 0 && (
              <Card>
                <SectionTitle
                  icon={<BookOpen className="h-3.5 w-3.5" />}
                  label="Policy rules triggered"
                />
                <ul className="space-y-2.5">
                  {claim.policies.map((p) => (
                    <li
                      key={p.code}
                      className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                          {p.code}
                        </span>
                        <span className="text-sm font-medium text-neutral-900">
                          {p.title}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-neutral-600">
                        {p.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {claim.evidence.length > 0 && (
              <Card>
                <SectionTitle
                  icon={<Paperclip className="h-3.5 w-3.5" />}
                  label="Additional evidence needed"
                />
                <ul className="space-y-2">
                  {claim.evidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          e.done
                            ? "border-emerald-500 bg-emerald-500"
                            : "border-neutral-300 bg-white"
                        }`}
                      >
                        {e.done && (
                          <CheckCircle2 className="h-3 w-3 text-white" />
                        )}
                      </span>
                      <div>
                        <div
                          className={`text-sm ${e.done ? "text-neutral-500 line-through" : "font-medium text-neutral-900"}`}
                        >
                          {e.label}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {e.detail}
                        </div>
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
          <SectionTitle
            icon={<Calculator className="h-3.5 w-3.5" />}
            label="Reimbursable calculation"
          />
          <div className="flex flex-wrap items-center gap-3">
            <MathChip
              label="Claimed"
              value={money(claim.totalClaim)}
              tone="neutral"
            />
            {claim.findings.map((f, i) => {
              const meta = findingMeta[f.type];
              return (
                <div key={i} className="flex items-center gap-3">
                  <Minus className="h-4 w-4 text-neutral-400" />
                  <MathChip
                    label={meta.label}
                    value={money(f.impact)}
                    tone={f.severity}
                  />
                </div>
              );
            })}
            <Equal className="h-4 w-4 text-neutral-400" />
            <MathChip
              label="Reimbursable"
              value={money(claim.reimburseAmount)}
              tone="result"
            />
          </div>
        </div>

        {/* Decision bar */}
        <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Reviewer decision
              </div>
              <div className="mt-1 text-sm text-neutral-600">
                Confirm the recommended action or override with your own
                assessment.
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
                      isActive
                        ? `${cfg.tone} border-current`
                        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
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
    <div
      className={`rounded-xl border border-neutral-200 bg-white p-5 shadow-sm ring-1 ${tone.ring}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded ${tone.chip} border-0`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              <span className="text-sm font-semibold text-neutral-900">
                {meta.label}
              </span>
            </div>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 font-mono text-xs font-medium ${tone.impact}`}
        >
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
          <MiniStat
            label="Claimed total"
            value={money(finding.claimedTotal)}
            tone="rose"
          />
          <MiniStat
            label="Receipt total"
            value={money(finding.receiptTotal)}
            tone="neutral"
          />
          {finding.note && (
            <p className="col-span-2 text-xs text-neutral-600">
              {finding.note}
            </p>
          )}
        </div>
      );

    case "cashprice_used":
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MiniStat
              label="Purchase total"
              value={money(finding.totalPrice)}
              tone="emerald"
            />
            <ArrowRight className="h-4 w-4 text-neutral-400" />
            <MiniStat
              label="Cash tendered"
              value={money(finding.cashPrice)}
              tone="rose"
              annotation="claimed"
            />
          </div>
          <p className="text-xs text-neutral-600">
            Employee reimbursed the cash tendered instead of the actual purchase
            total. Reimburse against{" "}
            <span className="font-medium text-neutral-900">
              {money(finding.totalPrice)}
            </span>
            .
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
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">
              {money(finding.change)} change
            </span>
          </div>
          <p className="text-xs text-neutral-600">
            The change returned to the employee was included in the
            reimbursement claim. Deduct{" "}
            <span className="font-medium text-neutral-900">
              {money(finding.change)}
            </span>
            .
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
              <li
                key={i}
                className="flex items-center justify-between px-3 py-2"
              >
                <span className="text-neutral-700">{it.label}</span>
                <span className="font-mono text-xs text-neutral-900">
                  {money(it.price)}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between bg-neutral-50/60 px-3 py-2 text-xs font-medium">
              <span className="text-neutral-500">Sum of items</span>
              <span className="font-mono text-neutral-900">{money(sum)}</span>
            </li>
            <li className="flex items-center justify-between bg-neutral-50/60 px-3 py-2 text-xs font-medium">
              <span className="text-neutral-500">Printed subtotal</span>
              <span className="font-mono text-neutral-900">
                {money(finding.printedSubtotal)}
              </span>
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
            <MiniStat
              label={`Expected (${(finding.rate * 100).toFixed(0)}%)`}
              value={money(expected)}
              tone="neutral"
            />
            <MiniStat
              label="Printed tax"
              value={money(finding.printedTax)}
              tone="emerald"
            />
            <MiniStat
              label="Claimed tax"
              value={money(finding.claimedTax)}
              tone="rose"
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                finding.mode === "double"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {finding.mode === "double"
                ? "Double-counted"
                : "Missing / under-reported"}
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
            <div className="mb-2 text-sm font-medium text-neutral-900">
              {finding.item}
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-neutral-500">List</span>
              <span className="text-neutral-500 line-through">
                {money(finding.listPrice)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-neutral-500">Discount</span>
              <span className="text-emerald-700">
                −{money(finding.discount)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              <span className="text-neutral-500">Net</span>
              <span className="text-neutral-900">
                {money(finding.netPrice)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">
              Claimed at list: {money(finding.claimedPrice)}
            </span>
            <span className="text-neutral-600">
              Reimburse net price {money(finding.netPrice)}.
            </span>
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
                <span
                  className={it.blocked ? "text-rose-700" : "text-neutral-800"}
                >
                  {it.label}
                </span>
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
  const valueCls =
    tone === "rose"
      ? "text-rose-700"
      : tone === "emerald"
        ? "text-emerald-700"
        : "text-neutral-900";
  return (
    <div className={`flex-1 rounded-lg border px-3 py-2 ${toneCls}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${valueCls}`}
      >
        {value}
      </div>
      {annotation && (
        <div className="text-[10px] uppercase tracking-wide text-rose-600">
          {annotation}
        </div>
      )}
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
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="font-mono text-sm font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      {children}
    </div>
  );
}

function SectionTitle({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      <span className="flex h-5 w-5 items-center justify-center rounded bg-neutral-100 text-neutral-600">
        {icon}
      </span>
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
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span
          className={`text-lg font-semibold tabular-nums ${muted ? "text-neutral-600" : ""}`}
        >
          {value}
        </span>
        {delta !== undefined && Math.abs(delta) > 0.001 && (
          <span
            className={`text-xs font-medium ${delta > 0 ? "text-rose-600" : "text-emerald-600"}`}
          >
            {delta > 0 ? "+" : "−"}
            {money(Math.abs(delta))}
          </span>
        )}
      </div>
    </div>
  );
}
