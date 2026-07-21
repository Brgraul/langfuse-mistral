export type Verdict = "approve" | "partial" | "reject" | "escalate";
export type Severity = "info" | "warn" | "block";

export type ComparisonLine = {
  label: string;
  claim: string;
  truth: string;
  match: boolean;
  issue?: string;
};

export type PolicyHit = { code: string; title: string; detail: string };
export type Evidence = { label: string; detail: string; done: boolean };

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
      items: {
        label: string;
        price: number;
        blocked: boolean;
        policyCode?: string;
      }[];
    };

export type Claim = {
  id: string;
  employee: string;
  submitted: string;
  category: string;
  merchantClaim: string;
  totalClaim: number;
  totalTruth: number;
  currency: "IDR";
  lines: ComparisonLine[];
  verdict: Verdict;
  reimburseAmount: number;
  rationale: string[];
  policies: PolicyHit[];
  evidence: Evidence[];
  findings: Finding[];
  image: string;
  provenance: {
    dataset: "naver-clova-ix/cord-v2";
    split: "validation" | "test";
    rowIndex: number;
    imageId: number | string;
    imageWidth: number;
    imageHeight: number;
    permutation: Permutation;
  };
};

export type CordDatasetRow = {
  split: "validation" | "test";
  rowIndex: number;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  groundTruth: unknown;
};

type RawRecord = Record<string, unknown>;

type ReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount: number;
  listPrice: number;
};

type NormalizedReceipt = {
  imageId: number | string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  service: number;
  discount: number;
  total: number;
  cash: number | null;
  change: number | null;
};

export type Permutation =
  | "total-mismatch"
  | "cash-as-total"
  | "change-claimed"
  | "items-mismatch-subtotal"
  | "tax-doubled"
  | "pre-discount-price"
  | "non-reimbursable";

const EMPLOYEES = [
  "Amelia Hart",
  "Ravi Nair",
  "Sofia Mendez",
  "Jonas Weber",
  "Priya Raman",
  "Tom Becker",
  "Lena Fischer",
  "Daniel Osei",
];

const PURPOSES = [
  "Client dinner",
  "Team lunch",
  "Business meal during offsite",
  "Working dinner with vendor",
  "Team celebration dinner",
  "Customer workshop catering",
];

const IDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function buildClaimFromCordRow(
  row: CordDatasetRow,
  random: () => number = Math.random,
  forcedPermutation?: Permutation,
): Claim {
  const receipt = normalizeGroundTruth(row.groundTruth, row.rowIndex);
  if (receipt.total <= 0) {
    throw new Error(
      `CORD row ${row.split}/${row.rowIndex} has no usable total`,
    );
  }

  const eligible = eligiblePermutations(receipt);
  const permutation = forcedPermutation ?? pick(eligible, random);
  if (!eligible.includes(permutation)) {
    throw new Error(
      `Permutation ${permutation} does not apply to this receipt`,
    );
  }

  const employee = pick(EMPLOYEES, random);
  const category = pick(PURPOSES, random);
  const submitted = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date());

  const claimItems = receipt.items.map((item) => ({ ...item }));
  let claimedSubtotal = receipt.subtotal;
  let claimedTax = receipt.tax;
  let claimedDiscount = receipt.discount;
  let claimedTotal = receipt.total;
  let finding: Finding;
  let verdict: Verdict = "partial";
  let rationale: string[];
  let policies: PolicyHit[];
  let evidence: Evidence[] = [];

  switch (permutation) {
    case "cash-as-total": {
      const cash = receipt.cash as number;
      claimedTotal = cash;
      const impact = cash - receipt.total;
      finding = {
        type: "cashprice_used",
        severity: "block",
        impact,
        totalPrice: receipt.total,
        cashPrice: cash,
        claimed: cash,
      };
      rationale = [
        `The claim uses cash tendered (${formatMoney(cash)}) instead of the purchase total.`,
        `The paired CORD ground truth records a total of ${formatMoney(receipt.total)}.`,
        "Reimburse only the verified purchase total.",
      ];
      policies = [
        policy(
          "T&E-2.1",
          "Reimburse purchase total only",
          "Cash tendered is not the reimbursable amount.",
        ),
      ];
      break;
    }

    case "change-claimed": {
      const change = receipt.change as number;
      claimedTotal = receipt.total + change;
      finding = {
        type: "change_as_expense",
        severity: "block",
        impact: change,
        amountTendered: receipt.cash ?? claimedTotal,
        receiptTotal: receipt.total,
        change,
      };
      rationale = [
        `The synthetic claim adds returned change (${formatMoney(change)}) to the expense.`,
        `The paired ground truth records a purchase total of ${formatMoney(receipt.total)}.`,
        "Deduct the returned change from reimbursement.",
      ];
      policies = [
        policy(
          "T&E-2.3",
          "Change is not an expense",
          "Change returned to an employee cannot be reimbursed.",
        ),
      ];
      break;
    }

    case "items-mismatch-subtotal": {
      const delta = Math.max(Math.round(receipt.total * 0.12), 1_000);
      claimItems[0] = {
        ...claimItems[0],
        totalPrice: claimItems[0].totalPrice + delta,
      };
      claimedSubtotal = sumItems(claimItems);
      claimedTotal = receipt.total + delta;
      finding = {
        type: "subtotal_math",
        severity: "warn",
        impact: delta,
        items: claimItems.map((item) => ({
          label: itemLabel(item),
          price: item.totalPrice,
        })),
        printedSubtotal: receipt.subtotal,
      };
      verdict = "escalate";
      rationale = [
        "A line item was inflated in the synthetic claim, so its items no longer reconcile to the printed subtotal.",
        `The paired ground truth total remains ${formatMoney(receipt.total)}.`,
        "Request a corrected itemized claim before reimbursement.",
      ];
      policies = [
        policy(
          "T&E-3.2",
          "Line items must sum",
          "Claimed line items must reconcile to the receipt subtotal.",
        ),
      ];
      evidence = [
        {
          label: "Corrected itemization",
          detail: "A claim whose line items match the receipt.",
          done: false,
        },
      ];
      break;
    }

    case "tax-doubled": {
      claimedTax = receipt.tax * 2;
      claimedTotal = receipt.total + receipt.tax;
      finding = {
        type: "tax_error",
        severity: "warn",
        impact: receipt.tax,
        mode: "double",
        subtotal: receipt.subtotal,
        rate: receipt.subtotal > 0 ? receipt.tax / receipt.subtotal : 0,
        printedTax: receipt.tax,
        claimedTax,
      };
      rationale = [
        `The synthetic claim doubles the printed tax from ${formatMoney(receipt.tax)} to ${formatMoney(claimedTax)}.`,
        `This overstates the total by ${formatMoney(receipt.tax)}.`,
        "Reimburse the total recorded in the paired ground truth.",
      ];
      policies = [
        policy(
          "T&E-5.1",
          "Tax accuracy",
          "Claimed tax must equal the tax printed on the receipt.",
        ),
      ];
      break;
    }

    case "pre-discount-price": {
      const discountedItem = claimItems.find((item) => item.discount > 0);
      const discount = discountedItem?.discount ?? receipt.discount;
      const item = discountedItem?.name ?? "Receipt-level discount";
      const netPrice = discountedItem?.totalPrice ?? receipt.total;
      const listPrice = discountedItem?.listPrice ?? receipt.total + discount;
      if (discountedItem) discountedItem.totalPrice = discountedItem.listPrice;
      claimedDiscount = Math.max(0, receipt.discount - discount);
      claimedSubtotal = receipt.subtotal + discount;
      claimedTotal = receipt.total + discount;
      finding = {
        type: "discount_ignored",
        severity: "warn",
        impact: discount,
        item,
        listPrice,
        discount,
        netPrice,
        claimedPrice: listPrice,
      };
      rationale = [
        `The synthetic claim ignores a printed discount of ${formatMoney(discount)}.`,
        `The paired ground truth records a net total of ${formatMoney(receipt.total)}.`,
        "Reimburse the post-discount amount only.",
      ];
      policies = [
        policy(
          "T&E-3.3",
          "Honor printed discounts",
          "Expenses are reimbursed at the net price actually paid.",
        ),
      ];
      break;
    }

    case "non-reimbursable": {
      const blocked = {
        name: "BINTANG BEER 620ML",
        quantity: 1,
        unitPrice: 85_000,
        totalPrice: 85_000,
        discount: 0,
        listPrice: 85_000,
      };
      claimItems.push(blocked);
      claimedSubtotal += blocked.totalPrice;
      claimedTotal += blocked.totalPrice;
      finding = {
        type: "policy_items",
        severity: "block",
        impact: blocked.totalPrice,
        items: claimItems.map((item) => ({
          label: itemLabel(item),
          price: item.totalPrice,
          blocked: item === blocked,
          ...(item === blocked ? { policyCode: "T&E-2.7 Alcohol" } : {}),
        })),
      };
      rationale = [
        "The synthetic claim adds an alcohol item that is absent from the paired receipt ground truth.",
        `Exclude ${formatMoney(blocked.totalPrice)} from reimbursement.`,
        "Reimburse only the legitimate receipt total.",
      ];
      policies = [
        policy(
          "T&E-2.7",
          "Alcohol non-reimbursable",
          "Alcoholic beverages are excluded from reimbursement.",
        ),
      ];
      break;
    }

    case "total-mismatch": {
      const impact = Math.max(Math.round(receipt.total * 0.15), 5_000);
      claimedTotal = receipt.total + impact;
      finding = {
        type: "total_mismatch",
        severity: "block",
        impact,
        claimedTotal,
        receiptTotal: receipt.total,
        note: "The claim total was deliberately inflated from the paired CORD ground truth.",
      };
      rationale = [
        `The synthetic claim exceeds the paired ground truth by ${formatMoney(impact)}.`,
        `The verified receipt total is ${formatMoney(receipt.total)}.`,
        "Reimburse only the verified receipt total.",
      ];
      policies = [
        policy(
          "T&E-4.2",
          "Documented totals only",
          "Reimbursement cannot exceed the receipt total.",
        ),
      ];
      break;
    }
  }

  const lines = buildComparisonLines(receipt, claimItems, {
    subtotal: claimedSubtotal,
    tax: claimedTax,
    discount: claimedDiscount,
    total: claimedTotal,
    permutation,
    split: row.split,
    rowIndex: row.rowIndex,
  });

  return {
    id: `EXP-CORD-${row.split === "validation" ? "V" : "T"}-${String(row.rowIndex).padStart(3, "0")}`,
    employee,
    submitted,
    category,
    merchantClaim: `CORD v2 receipt #${receipt.imageId}`,
    totalClaim: claimedTotal,
    totalTruth: receipt.total,
    currency: "IDR",
    lines,
    verdict,
    reimburseAmount: receipt.total,
    rationale,
    policies,
    evidence,
    findings: [finding],
    image: row.imageUrl,
    provenance: {
      dataset: "naver-clova-ix/cord-v2",
      split: row.split,
      rowIndex: row.rowIndex,
      imageId: receipt.imageId,
      imageWidth: row.imageWidth,
      imageHeight: row.imageHeight,
      permutation,
    },
  };
}

function normalizeGroundTruth(
  value: unknown,
  fallbackImageId: number,
): NormalizedReceipt {
  const root = asRecord(value);
  const gtParse = asRecord(root.gt_parse);
  const meta = asRecord(root.meta);
  const menuValue = gtParse.menu;
  const menu = Array.isArray(menuValue)
    ? menuValue
    : menuValue
      ? [menuValue]
      : [];
  const items = menu.flatMap((entry) => {
    const item = asRecord(entry);
    if (Object.keys(item).length === 0) return [];
    const quantity = parseQuantity(item.cnt);
    const listPrice = parseAmount(item.price) ?? 0;
    const discount = Math.abs(parseAmount(item.discountprice) ?? 0);
    const totalPrice = Math.max(0, listPrice - discount);
    const unitPrice =
      parseAmount(item.unitprice) ??
      (quantity ? listPrice / quantity : listPrice);
    return [
      {
        name: String(item.nm ?? "Unknown item").trim() || "Unknown item",
        quantity,
        unitPrice,
        totalPrice,
        discount,
        listPrice,
      },
    ];
  });

  const subTotal = firstRecord(gtParse.sub_total);
  const totalRecord = firstRecord(gtParse.total);
  const itemSum = sumItems(items);
  const subtotal = parseAmount(subTotal.subtotal_price) ?? itemSum;
  const tax = parseAmount(subTotal.tax_price) ?? 0;
  const service = parseAmount(subTotal.service_price) ?? 0;
  const discount = Math.abs(
    parseAmount(subTotal.discount_price) ??
      items.reduce((sum, item) => sum + item.discount, 0),
  );
  const total =
    parseAmount(totalRecord.total_price) ?? subtotal + tax + service - discount;

  return {
    imageId:
      typeof meta.image_id === "number" || typeof meta.image_id === "string"
        ? meta.image_id
        : fallbackImageId,
    items,
    subtotal,
    tax,
    service,
    discount,
    total,
    cash: parseAmount(totalRecord.cashprice),
    change: parseAmount(totalRecord.changeprice),
  };
}

function eligiblePermutations(receipt: NormalizedReceipt): Permutation[] {
  const eligible: Permutation[] = ["total-mismatch", "non-reimbursable"];
  if (receipt.cash !== null && receipt.cash > receipt.total)
    eligible.push("cash-as-total");
  if (receipt.change !== null && receipt.change > 0)
    eligible.push("change-claimed");
  if (receipt.items.length > 0 && receipt.subtotal > 0)
    eligible.push("items-mismatch-subtotal");
  if (receipt.tax > 0) eligible.push("tax-doubled");
  if (receipt.discount > 0 || receipt.items.some((item) => item.discount > 0))
    eligible.push("pre-discount-price");
  return eligible;
}

function buildComparisonLines(
  receipt: NormalizedReceipt,
  claimItems: ReceiptItem[],
  claim: {
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    permutation: Permutation;
    split: string;
    rowIndex: number;
  },
): ComparisonLine[] {
  const itemSum = sumItems(claimItems);
  const truthItemSum = sumItems(receipt.items);
  const lines: ComparisonLine[] = [
    {
      label: "Dataset row",
      claim: `${claim.split} #${claim.rowIndex}`,
      truth: `${claim.split} #${claim.rowIndex}`,
      match: true,
    },
    comparison(
      "Line items",
      `${claimItems.length} · ${formatMoney(itemSum)}`,
      `${receipt.items.length} · ${formatMoney(truthItemSum)}`,
      claimItems.length === receipt.items.length && itemSum === truthItemSum,
      "Claimed items differ from the paired annotation",
    ),
    comparison(
      "Subtotal",
      formatMoney(claim.subtotal),
      formatMoney(receipt.subtotal),
      claim.subtotal === receipt.subtotal,
      "Claimed subtotal differs from ground truth",
    ),
  ];
  if (receipt.tax > 0 || claim.tax > 0) {
    lines.push(
      comparison(
        "Tax",
        formatMoney(claim.tax),
        formatMoney(receipt.tax),
        claim.tax === receipt.tax,
        "Claimed tax differs from ground truth",
      ),
    );
  }
  if (receipt.discount > 0 || claim.discount > 0) {
    lines.push(
      comparison(
        "Discount",
        formatMoney(claim.discount),
        formatMoney(receipt.discount),
        claim.discount === receipt.discount,
        "Printed discount was not fully claimed",
      ),
    );
  }
  if (receipt.cash !== null) {
    lines.push({
      label: "Cash tendered",
      claim: formatMoney(receipt.cash),
      truth: formatMoney(receipt.cash),
      match: true,
    });
  }
  if (receipt.change !== null) {
    lines.push({
      label: "Change returned",
      claim:
        claim.permutation === "change-claimed"
          ? `${formatMoney(receipt.change)} included`
          : formatMoney(receipt.change),
      truth: `${formatMoney(receipt.change)} returned`,
      match: claim.permutation !== "change-claimed",
      ...(claim.permutation === "change-claimed"
        ? { issue: "Returned change was added to the expense" }
        : {}),
    });
  }
  lines.push(
    comparison(
      "Total",
      formatMoney(claim.total),
      formatMoney(receipt.total),
      claim.total === receipt.total,
      "Claim total differs from the paired ground truth",
    ),
  );
  return lines;
}

function comparison(
  label: string,
  claim: string,
  truth: string,
  match: boolean,
  issue: string,
): ComparisonLine {
  return { label, claim, truth, match, ...(!match ? { issue } : {}) };
}

function policy(code: string, title: string, detail: string): PolicyHit {
  return { code, title, detail };
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.round(value);
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const sign = raw.startsWith("-") ? -1 : 1;
  const digits = raw.replace(/\D/g, "");
  return digits ? sign * Number(digits) : null;
}

function parseQuantity(value: unknown): number {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  const quantity = match ? Number(match[0]) : 1;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function firstRecord(value: unknown): RawRecord {
  if (Array.isArray(value))
    return asRecord(
      value.find((entry) => Object.keys(asRecord(entry)).length > 0),
    );
  return asRecord(value);
}

function asRecord(value: unknown): RawRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function sumItems(items: ReceiptItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + item.totalPrice, 0));
}

function itemLabel(item: ReceiptItem): string {
  return `${item.name}${item.quantity !== 1 ? ` ×${item.quantity}` : ""}`;
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[
    Math.min(values.length - 1, Math.floor(random() * values.length))
  ];
}

function formatMoney(value: number): string {
  return IDR.format(Math.round(value));
}
