import { afterEach, describe, expect, test } from "bun:test";

import {
  MistralOcrError,
  RECEIPT_ANNOTATION_FORMAT,
  parseMistralOcrResponse,
  recognizeReceiptWithMistral,
} from "./mistral-ocr";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const annotation = {
  merchant: "Warung Makan",
  items: [
    {
      name: "NASI GORENG",
      quantity: 2,
      unit_price: 20_000,
      total_price: 40_000,
      discount: null,
    },
  ],
  subtotal: 40_000,
  service_charge: 0,
  tax: 4_000,
  discount: null,
  total: 44_000,
  payment_method: "cash",
  cash_tendered: 50_000,
  change: 6_000,
};

describe("Mistral OCR structured annotations", () => {
  test("requests the CORD-compatible receipt fields with strict JSON schema", () => {
    expect(RECEIPT_ANNOTATION_FORMAT.type).toBe("json_schema");
    expect(RECEIPT_ANNOTATION_FORMAT.json_schema.strict).toBe(true);
    expect(RECEIPT_ANNOTATION_FORMAT.json_schema.schema.required).toContain(
      "cash_tendered",
    );
  });

  test("parses a string document annotation and page confidence", () => {
    const result = parseMistralOcrResponse({
      model: "mistral-ocr-latest",
      document_annotation: JSON.stringify(annotation),
      pages: [{ confidence_scores: { average_page_confidence_score: 0.94 } }],
    });

    expect(result.receipt).toEqual(annotation);
    expect(result.model).toBe("mistral-ocr-latest");
    expect(result.confidence).toBe(0.94);
  });

  test("accepts object annotations returned by SDK-compatible runtimes", () => {
    const result = parseMistralOcrResponse({ document_annotation: annotation });
    expect(result.receipt.total).toBe(44_000);
  });

  test("rejects missing structured annotations as retryable", () => {
    try {
      parseMistralOcrResponse({ pages: [] });
      throw new Error("expected parser to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MistralOcrError);
      expect((error as MistralOcrError).retryable).toBe(true);
    }
  });

  test("sends the Hugging Face image to Mistral with server authorization", async () => {
    let requestBody: Record<string, unknown> = {};
    let authorization: string | null = null;

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("https://api.mistral.ai/v1/ocr");
      authorization = new Headers(init?.headers).get("authorization");
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "mistral-ocr-latest",
          document_annotation: JSON.stringify(annotation),
          pages: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    await recognizeReceiptWithMistral(
      "https://datasets-server.huggingface.co/receipt.jpg",
      "server-secret",
    );

    expect(authorization).toBe("Bearer server-secret");
    expect(requestBody.document).toEqual({
      type: "image_url",
      image_url: "https://datasets-server.huggingface.co/receipt.jpg",
    });
    expect(requestBody).not.toHaveProperty("ground_truth");
  });
});
