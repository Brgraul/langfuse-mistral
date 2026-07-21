import { createServerFn } from "@tanstack/react-start";

import {
  buildClaimFromCordRow,
  type Claim,
  type CordDatasetRow,
} from "./receipt-generator-core";

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
      ground_truth?: unknown;
    };
  }>;
};

export const getRandomReceiptClaim = createServerFn({ method: "POST" }).handler(
  async (): Promise<Claim> => {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const split = SPLITS[randomIndex(SPLITS.length)];
      const rowIndex = randomIndex(ROWS_PER_SPLIT);

      try {
        const row = await fetchCordRow(split, rowIndex);
        return buildClaimFromCordRow(row);
      } catch (error) {
        lastError = error;
      }
    }

    const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(
      `Unable to load a usable CORD v2 receipt after ${MAX_ATTEMPTS} attempts${detail}`,
    );
  },
);

async function fetchCordRow(
  split: (typeof SPLITS)[number],
  rowIndex: number,
): Promise<CordDatasetRow> {
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
  const groundTruthValue = result?.row?.ground_truth;

  if (
    !result ||
    !imageUrl ||
    !imageWidth ||
    !imageHeight ||
    typeof groundTruthValue !== "string"
  ) {
    throw new Error(
      `Hugging Face returned an incomplete row for ${split}/${rowIndex}`,
    );
  }

  let groundTruth: unknown;
  try {
    groundTruth = JSON.parse(groundTruthValue);
  } catch {
    throw new Error(
      `CORD ground truth is invalid JSON for ${split}/${rowIndex}`,
    );
  }

  return {
    split,
    rowIndex: typeof result.row_idx === "number" ? result.row_idx : rowIndex,
    imageUrl,
    imageWidth,
    imageHeight,
    groundTruth,
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
