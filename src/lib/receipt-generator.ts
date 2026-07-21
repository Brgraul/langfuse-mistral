import { createServerFn } from "@tanstack/react-start";

import {
  buildClaimFromReceipt,
  type Claim,
  type ReceiptSource,
} from "./receipt-generator-core";
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

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const split = SPLITS[randomIndex(SPLITS.length)];
      const rowIndex = randomIndex(ROWS_PER_SPLIT);

      try {
        const row = await fetchCordImage(split, rowIndex);
        const ocr = await recognizeReceiptWithMistral(row.imageUrl, apiKey);
        return buildClaimFromReceipt({
          ...row,
          extractedReceipt: ocr.receipt,
          ocrModel: ocr.model,
          ocrConfidence: ocr.confidence,
        });
      } catch (error) {
        if (error instanceof MistralOcrError && !error.retryable) throw error;
        lastError = error;
      }
    }

    const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(
      `Unable to recognize a usable CORD v2 receipt after ${MAX_ATTEMPTS} attempts${detail}`,
    );
  },
);

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
