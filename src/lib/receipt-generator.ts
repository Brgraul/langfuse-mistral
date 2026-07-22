import { createServerFn } from "@tanstack/react-start";

import {
  buildClaimFromNormalizedReceipt,
  normalizeReceiptSource,
  type Claim,
  type NormalizedReceipt,
  type ReceiptSource,
} from "./receipt-generator-core";
import { traceReceiptPhase, traceReceiptReview } from "./langfuse";
import { MistralOcrError, recognizeReceiptWithMistral } from "./mistral-ocr";

const DATASET = "naver-clova-ix/cord-v2";
const ROWS_ENDPOINT = "https://datasets-server.huggingface.co/rows";
const SPLITS = ["validation", "test"] as const;
const ROWS_PER_SPLIT = 100;
const MAX_ATTEMPTS = 4;

type HuggingFaceRowsResponse = {
  rows?: Array<{
    row_idx?: unknown;
    row?: {
      image?: { src?: unknown; width?: unknown; height?: unknown };
    };
  }>;
};

type CordImageRow = Pick<
  ReceiptSource,
  "split" | "rowIndex" | "imageUrl" | "imageWidth" | "imageHeight"
>;

export const getRandomReceiptClaim = createServerFn({ method: "POST" }).handler(
  async (): Promise<Claim> => {
    const apiKey = process.env.MISTRAL_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "MISTRAL_API_KEY is required for live receipt recognition. Add it to .env or the deployment environment.",
      );
    }

    return traceReceiptReview(
      { dataset: DATASET, maxAttempts: MAX_ATTEMPTS },
      async () => generateTracedClaim(apiKey),
      summarizeClaim,
    );
  },
);

async function generateTracedClaim(apiKey: string): Promise<Claim> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const split = SPLITS[randomIndex(SPLITS.length)];
    const rowIndex = randomIndex(ROWS_PER_SPLIT);

    try {
      return await traceReceiptPhase(
        "receipt-attempt",
        "chain",
        { attempt: attempt + 1, split, rowIndex },
        async () => {
          const row = await traceReceiptPhase(
            "fetch-cord-image",
            "retriever",
            { dataset: DATASET, split, rowIndex },
            () => fetchCordImage(split, rowIndex),
            summarizeCordRow,
          );
          const ocr = await traceReceiptPhase(
            "mistral-receipt-ocr",
            "generation",
            {
              model: "mistral-ocr-latest",
              document: { dataset: DATASET, split, rowIndex: row.rowIndex },
            },
            () => recognizeReceiptWithMistral(row.imageUrl, apiKey),
            (result) => ({
              model: result.model,
              confidence: result.confidence,
              receipt: result.receipt,
            }),
            {
              model: "mistral-ocr-latest",
              metadata: { provider: "mistral", task: "receipt-ocr" },
            },
          );
          const source: ReceiptSource = {
            ...row,
            extractedReceipt: ocr.receipt,
            ocrModel: ocr.model,
            ocrConfidence: ocr.confidence,
          };
          const normalized = await traceReceiptPhase(
            "normalize-receipt-fields",
            "tool",
            { receipt: ocr.receipt },
            () => normalizeReceiptSource(source),
            (result) => result.receipt,
          );
          return traceReceiptPhase(
            "synthetic-noise-addition",
            "tool",
            { originalReceipt: summarizeNormalizedReceipt(normalized.receipt) },
            () => buildClaimFromNormalizedReceipt(normalized),
            summarizeSyntheticNoise,
          );
        },
        summarizeClaim,
      );
    } catch (error) {
      if (error instanceof MistralOcrError && !error.retryable) throw error;
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(
    `Unable to recognize a usable CORD v2 receipt after ${MAX_ATTEMPTS} attempts${detail}`,
  );
}

function summarizeCordRow(row: CordImageRow) {
  return {
    split: row.split,
    rowIndex: row.rowIndex,
    imageWidth: row.imageWidth,
    imageHeight: row.imageHeight,
  };
}

function summarizeNormalizedReceipt(receipt: NormalizedReceipt) {
  return {
    merchant: receipt.merchant,
    items: receipt.items,
    subtotal: receipt.subtotal,
    tax: receipt.tax,
    serviceCharge: receipt.service,
    discount: receipt.discount,
    total: receipt.total,
    cashTendered: receipt.cash,
    change: receipt.change,
  };
}

function summarizeSyntheticNoise(claim: Claim) {
  return {
    noiseType: claim.provenance.permutation,
    original: {
      total: claim.totalOcr,
    },
    syntheticClaim: {
      total: claim.totalClaim,
      totalDelta: claim.totalClaim - claim.totalOcr,
      comparisons: claim.lines,
    },
    injectedFinding: claim.findings[0],
    recommendation: {
      verdict: claim.verdict,
      reimburseAmount: claim.reimburseAmount,
      rationale: claim.rationale,
      policies: claim.policies,
      evidence: claim.evidence,
    },
  };
}

function summarizeClaim(claim: Claim) {
  return {
    claimId: claim.id,
    dataset: claim.provenance.dataset,
    split: claim.provenance.split,
    rowIndex: claim.provenance.rowIndex,
    ocrModel: claim.provenance.ocrModel,
    ocrConfidence: claim.provenance.ocrConfidence,
    noiseType: claim.provenance.permutation,
    receiptTotal: claim.totalOcr,
    claimedTotal: claim.totalClaim,
    verdict: claim.verdict,
    reimburseAmount: claim.reimburseAmount,
  };
}

async function fetchCordImage(
  split: (typeof SPLITS)[number],
  rowIndex: number,
): Promise<CordImageRow> {
  const url = new URL(ROWS_ENDPOINT);
  url.searchParams.set("dataset", DATASET);
  url.searchParams.set("config", "default");
  url.searchParams.set("split", split);
  url.searchParams.set("offset", String(rowIndex));
  url.searchParams.set("length", "1");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      `Hugging Face rows API returned ${response.status} for ${split}/${rowIndex}`,
    );
  }

  const payload = (await response.json()) as HuggingFaceRowsResponse;
  const result = payload.rows?.[0];
  const image = result?.row?.image;
  const imageUrl = typeof image?.src === "string" ? image.src : null;
  const imageWidth = typeof image?.width === "number" ? image.width : null;
  const imageHeight = typeof image?.height === "number" ? image.height : null;

  if (!result || !imageUrl || !imageWidth || !imageHeight) {
    throw new Error(
      `Hugging Face returned an incomplete row for ${split}/${rowIndex}`,
    );
  }

  return {
    split,
    rowIndex: typeof result.row_idx === "number" ? result.row_idx : rowIndex,
    imageUrl,
    imageWidth,
    imageHeight,
  };
}

function randomIndex(length: number): number {
  return Math.floor(Math.random() * length);
}

export type {
  Claim,
  Finding,
  Severity,
  Verdict,
} from "./receipt-generator-core";
