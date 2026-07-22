import type { OcrExtractedReceipt } from "./receipt-generator-core";

const MISTRAL_OCR_ENDPOINT = "https://api.mistral.ai/v1/ocr";
const OCR_MODEL = "mistral-ocr-latest";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };

export const RECEIPT_ANNOTATION_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "receipt_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        merchant: {
          ...nullableString,
          description:
            "Merchant name exactly as printed, or null if unreadable.",
        },
        items: {
          type: "array",
          description: "Every purchased line item visible on the receipt.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: {
                type: "string",
                description: "Item description exactly as printed.",
              },
              quantity: {
                type: "number",
                description: "Purchased quantity; use 1 when omitted.",
              },
              unit_price: {
                ...nullableNumber,
                description:
                  "Price for one unit in IDR, or null when it cannot be derived.",
              },
              total_price: {
                type: "number",
                description:
                  "Net line total actually paid in IDR after item discount.",
              },
              discount: {
                ...nullableNumber,
                description: "Line-item discount in IDR, or null when absent.",
              },
            },
            required: [
              "name",
              "quantity",
              "unit_price",
              "total_price",
              "discount",
            ],
          },
        },
        subtotal: {
          ...nullableNumber,
          description: "Printed subtotal in IDR.",
        },
        service_charge: {
          ...nullableNumber,
          description: "Printed service charge in IDR.",
        },
        tax: { ...nullableNumber, description: "Printed tax in IDR." },
        discount: {
          ...nullableNumber,
          description: "Printed receipt-level discount in IDR.",
        },
        total: {
          ...nullableNumber,
          description:
            "Final amount owed or paid in IDR, excluding cash tendered and change.",
        },
        payment_method: {
          ...nullableString,
          description: "Printed payment method, such as cash or card, or null.",
        },
        cash_tendered: {
          ...nullableNumber,
          description: "Cash handed to the merchant in IDR; may exceed total.",
        },
        change: {
          ...nullableNumber,
          description: "Change returned to the customer in IDR.",
        },
      },
      required: [
        "merchant",
        "items",
        "subtotal",
        "service_charge",
        "tax",
        "discount",
        "total",
        "payment_method",
        "cash_tendered",
        "change",
      ],
    },
  },
} as const;

const ANNOTATION_PROMPT = `Extract the receipt into the provided schema.
The receipt is Indonesian and all monetary values must be returned as integer IDR amounts.
Treat commas and periods between groups of three digits as thousands separators (for example, 45,500 and 45.500 both mean 45500).
The final total is the amount owed, not cash tendered. Change is money returned to the customer.
Do not invent unreadable or absent values; use null. Include every visible purchased item.`;

export type MistralOcrResult = {
  receipt: OcrExtractedReceipt;
  model: string;
  confidence: number | null;
};

export class MistralOcrError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MistralOcrError";
  }
}

export async function recognizeReceiptWithMistral(
  imageUrl: string,
  apiKey: string,
): Promise<MistralOcrResult> {
  const response = await fetch(MISTRAL_OCR_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      document: { type: "image_url", image_url: imageUrl },
      document_annotation_format: RECEIPT_ANNOTATION_FORMAT,
      document_annotation_prompt: ANNOTATION_PROMPT,
      include_image_base64: false,
      confidence_scores_granularity: "page",
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const detail = await readMistralError(response);
    throw new MistralOcrError(
      `Mistral OCR returned ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
    );
  }

  return parseMistralOcrResponse(await response.json());
}

export function parseMistralOcrResponse(value: unknown): MistralOcrResult {
  const response = asRecord(value);
  const annotationValue = response.document_annotation;
  let annotation: unknown;

  if (typeof annotationValue === "string") {
    try {
      annotation = JSON.parse(annotationValue);
    } catch {
      throw new MistralOcrError(
        "Mistral OCR returned invalid annotation JSON",
        true,
      );
    }
  } else {
    annotation = annotationValue;
  }

  const receipt = parseReceiptAnnotation(annotation);
  const model = typeof response.model === "string" ? response.model : OCR_MODEL;
  const pages = Array.isArray(response.pages) ? response.pages : [];
  const confidenceScores = pages
    .map(
      (page) =>
        asRecord(asRecord(page).confidence_scores)
          .average_page_confidence_score,
    )
    .filter(
      (score): score is number =>
        typeof score === "number" && Number.isFinite(score),
    );
  const confidence = confidenceScores.length
    ? confidenceScores.reduce((sum, score) => sum + score, 0) /
      confidenceScores.length
    : null;

  return { receipt, model, confidence };
}

function parseReceiptAnnotation(value: unknown): OcrExtractedReceipt {
  const annotation = asRecord(value);
  if (
    Object.keys(annotation).length === 0 ||
    !Array.isArray(annotation.items)
  ) {
    throw new MistralOcrError(
      "Mistral OCR returned no structured receipt annotation",
      true,
    );
  }

  return {
    merchant: nullableText(annotation.merchant),
    items: annotation.items.map((rawItem) => {
      const item = asRecord(rawItem);
      return {
        name: typeof item.name === "string" ? item.name : "Unknown item",
        quantity: numberOr(item.quantity, 1),
        unit_price: nullableNumeric(item.unit_price),
        total_price: numberOr(item.total_price, 0),
        discount: nullableNumeric(item.discount),
      };
    }),
    subtotal: nullableNumeric(annotation.subtotal),
    service_charge: nullableNumeric(annotation.service_charge),
    tax: nullableNumeric(annotation.tax),
    discount: nullableNumeric(annotation.discount),
    total: nullableNumeric(annotation.total),
    payment_method: nullableText(annotation.payment_method),
    cash_tendered: nullableNumeric(annotation.cash_tendered),
    change: nullableNumeric(annotation.change),
  };
}

async function readMistralError(response: Response): Promise<string | null> {
  try {
    const payload = asRecord(await response.json());
    const message = payload.message ?? payload.detail;
    if (typeof message === "string") return message.slice(0, 300);
  } catch {
    // The status code remains sufficient when the API does not return JSON.
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return nullableNumeric(value) ?? fallback;
}
