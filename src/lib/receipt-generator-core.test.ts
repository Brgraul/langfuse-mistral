import { describe, expect, test } from "bun:test";

import {
  buildClaimFromCordRow,
  type CordDatasetRow,
} from "./receipt-generator-core";

const row: CordDatasetRow = {
  split: "validation",
  rowIndex: 42,
  imageUrl: "https://example.com/receipt.jpg",
  imageWidth: 864,
  imageHeight: 1296,
  groundTruth: {
    gt_parse: {
      menu: [
        { nm: "NASI GORENG", cnt: "2 x", unitprice: "20,000", price: "40,000" },
        { nm: "ICE TEA", cnt: "1", price: "8,000", discountprice: "1,000" },
      ],
      sub_total: {
        subtotal_price: "47,000",
        tax_price: "4,700",
        discount_price: "1,000",
      },
      total: {
        total_price: "51,700",
        cashprice: "60,000",
        changeprice: "8,300",
      },
    },
    meta: { image_id: 42 },
  },
};

describe("buildClaimFromCordRow", () => {
  test("inflates a claim total from the paired ground truth", () => {
    const claim = buildClaimFromCordRow(row, () => 0, "total-mismatch");

    expect(claim.totalTruth).toBe(51_700);
    expect(claim.totalClaim).toBeGreaterThan(claim.totalTruth);
    expect(claim.image).toBe(row.imageUrl);
    expect(claim.provenance).toMatchObject({
      split: "validation",
      rowIndex: 42,
      imageId: 42,
      permutation: "total-mismatch",
    });
    expect(claim.lines.find((line) => line.label === "Total")?.match).toBe(
      false,
    );
  });

  test("uses cash tendered only when it is present in the same receipt", () => {
    const claim = buildClaimFromCordRow(row, () => 0, "cash-as-total");

    expect(claim.totalClaim).toBe(60_000);
    expect(claim.findings[0]).toMatchObject({
      type: "cashprice_used",
      totalPrice: 51_700,
      cashPrice: 60_000,
      impact: 8_300,
    });
  });

  test("adds a policy item to the claim but not the receipt truth", () => {
    const claim = buildClaimFromCordRow(row, () => 0, "non-reimbursable");
    const items = claim.lines.find((line) => line.label === "Line items");

    expect(claim.totalClaim).toBe(136_700);
    expect(claim.reimburseAmount).toBe(51_700);
    expect(items?.match).toBe(false);
    expect(claim.findings[0]).toMatchObject({
      type: "policy_items",
      impact: 85_000,
    });
  });

  test("rejects a permutation that the paired ground truth cannot support", () => {
    const withoutTax: CordDatasetRow = {
      ...row,
      groundTruth: {
        gt_parse: {
          menu: { nm: "COFFEE", price: "20,000" },
          total: { total_price: "20,000" },
        },
        meta: { image_id: 7 },
      },
    };

    expect(() =>
      buildClaimFromCordRow(withoutTax, () => 0, "tax-doubled"),
    ).toThrow("does not apply");
  });
});
