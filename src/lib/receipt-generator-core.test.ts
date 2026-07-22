import { describe, expect, test } from "bun:test";

import {
  buildClaimFromNormalizedReceipt,
  buildClaimFromReceipt,
  normalizeReceiptSource,
  type ReceiptSource,
} from "./receipt-generator-core";

const row: ReceiptSource = {
  split: "validation",
  rowIndex: 42,
  imageUrl: "https://example.com/receipt.jpg",
  imageWidth: 864,
  imageHeight: 1296,
  ocrModel: "mistral-ocr-latest",
  ocrConfidence: 0.95,
  extractedReceipt: {
    merchant: "Warung Makan",
    items: [
      {
        name: "NASI GORENG",
        quantity: 2,
        unit_price: 20_000,
        total_price: 40_000,
        discount: null,
      },
      {
        name: "ICE TEA",
        quantity: 1,
        unit_price: 8_000,
        total_price: 7_000,
        discount: 1_000,
      },
    ],
    subtotal: 47_000,
    service_charge: 0,
    tax: 4_700,
    discount: 1_000,
    total: 51_700,
    payment_method: "cash",
    cash_tendered: 60_000,
    change: 8_300,
  },
};

describe("buildClaimFromReceipt", () => {
  test("keeps normalization and synthetic noise as separable pipeline phases", () => {
    const normalized = normalizeReceiptSource(row);
    const claim = buildClaimFromNormalizedReceipt(
      normalized,
      () => 0,
      "total-mismatch",
    );

    expect(normalized.receipt.total).toBe(51_700);
    expect(normalized.receipt.items[1]).toMatchObject({
      name: "ICE TEA",
      unitPrice: 8_000,
      totalPrice: 7_000,
      discount: 1_000,
    });
    expect(claim.provenance.permutation).toBe("total-mismatch");
    expect(claim.totalClaim).toBeGreaterThan(normalized.receipt.total);
  });

  test("inflates a claim total from the Mistral OCR extraction", () => {
    const claim = buildClaimFromReceipt(row, () => 0, "total-mismatch");

    expect(claim.totalOcr).toBe(51_700);
    expect(claim.totalClaim).toBeGreaterThan(claim.totalOcr);
    expect(claim.image).toBe(row.imageUrl);
    expect(claim.provenance).toMatchObject({
      split: "validation",
      rowIndex: 42,
      imageId: 42,
      permutation: "total-mismatch",
      ocrModel: "mistral-ocr-latest",
      ocrConfidence: 0.95,
    });
    expect(claim.lines.find((line) => line.label === "Total")?.match).toBe(
      false,
    );
  });

  test("uses cash tendered only when it is present in the same receipt", () => {
    const claim = buildClaimFromReceipt(row, () => 0, "cash-as-total");

    expect(claim.totalClaim).toBe(60_000);
    expect(claim.findings[0]).toMatchObject({
      type: "cashprice_used",
      totalPrice: 51_700,
      cashPrice: 60_000,
      impact: 8_300,
    });
  });

  test("adds a policy item to the claim but not the OCR extraction", () => {
    const claim = buildClaimFromReceipt(row, () => 0, "non-reimbursable");
    const items = claim.lines.find((line) => line.label === "Line items");

    expect(claim.totalClaim).toBe(136_700);
    expect(claim.reimburseAmount).toBe(51_700);
    expect(items?.match).toBe(false);
    expect(claim.findings[0]).toMatchObject({
      type: "policy_items",
      impact: 85_000,
    });
  });

  test("rejects a permutation that the OCR extraction cannot support", () => {
    const withoutTax: ReceiptSource = {
      ...row,
      extractedReceipt: {
        merchant: null,
        items: [
          {
            name: "COFFEE",
            quantity: 1,
            unit_price: 20_000,
            total_price: 20_000,
            discount: null,
          },
        ],
        subtotal: 20_000,
        service_charge: null,
        tax: null,
        discount: null,
        total: 20_000,
        payment_method: null,
        cash_tendered: null,
        change: null,
      },
    };

    expect(() =>
      buildClaimFromReceipt(withoutTax, () => 0, "tax-doubled"),
    ).toThrow("does not apply");
  });
});
