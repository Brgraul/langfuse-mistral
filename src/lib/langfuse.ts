import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  startActiveObservation,
  type LangfuseObservation,
  type LangfuseObservationAttributes,
  type LangfuseObservationType,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

type LangfuseRuntime = {
  enabled: boolean;
  processor?: LangfuseSpanProcessor;
  sdk?: NodeSDK;
};

type LangfuseGlobal = typeof globalThis & {
  __receiptLangfuseRuntime?: LangfuseRuntime;
};

const runtime = initializeLangfuse();

export type ReceiptTraceInput = {
  dataset: string;
  maxAttempts: number;
};

export async function traceReceiptReview<T>(
  input: ReceiptTraceInput,
  operation: () => Promise<T>,
  summarize: (result: T) => unknown,
): Promise<T> {
  if (!runtime.enabled) return operation();

  try {
    return await propagateAttributes(
      {
        traceName: "live-receipt-review",
        tags: ["cord-v2", "mistral-ocr", "synthetic-claim"],
        metadata: {
          workflow: "live-receipt-review",
          dataset: input.dataset,
          runtime: "tanstack-start-server",
        },
      },
      () =>
        startActiveObservation(
          "receipt-review-pipeline",
          async (observation) => {
            observation.update({ input });
            const result = await operation();
            observation.update({ output: summarize(result) });
            return result;
          },
          { asType: "chain" },
        ),
    );
  } finally {
    await flushLangfuse();
  }
}

export async function traceReceiptPhase<T>(
  name: string,
  asType: LangfuseObservationType,
  input: unknown,
  operation: () => Promise<T> | T,
  summarize: (result: T) => unknown = (result) => result,
  attributes: LangfuseObservationAttributes = {},
): Promise<T> {
  if (!runtime.enabled) return operation();

  return startTypedActiveObservation(
    name,
    async (observation) => {
      observation.update({ ...attributes, input });
      try {
        const result = await operation();
        observation.update({ output: summarize(result) });
        return result;
      } catch (error) {
        observation.update({
          level: "ERROR",
          statusMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    { asType },
  );
}

export function isLangfuseTracingEnabled(): boolean {
  return runtime.enabled;
}

async function flushLangfuse(): Promise<void> {
  if (!runtime.processor) return;
  try {
    await runtime.processor.forceFlush();
  } catch (error) {
    console.warn(
      "Langfuse trace export failed; the receipt workflow still completed.",
      error,
    );
  }
}

function initializeLangfuse(): LangfuseRuntime {
  const globalRuntime = globalThis as LangfuseGlobal;
  if (globalRuntime.__receiptLangfuseRuntime) {
    return globalRuntime.__receiptLangfuseRuntime;
  }

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    const disabled = { enabled: false } satisfies LangfuseRuntime;
    globalRuntime.__receiptLangfuseRuntime = disabled;
    return disabled;
  }

  const processor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_HOST?.trim() || "https://cloud.langfuse.com",
    environment:
      process.env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || "development",
    exportMode: "immediate",
    mediaUploadEnabled: false,
  });
  const sdk = new NodeSDK({ spanProcessors: [processor] });
  sdk.start();

  const enabled = { enabled: true, processor, sdk } satisfies LangfuseRuntime;
  globalRuntime.__receiptLangfuseRuntime = enabled;
  return enabled;
}

const startTypedActiveObservation = startActiveObservation as unknown as <T>(
  name: string,
  operation: (observation: LangfuseObservation) => Promise<T>,
  options: { asType: LangfuseObservationType },
) => Promise<T>;
