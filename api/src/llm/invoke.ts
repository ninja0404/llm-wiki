import { generateObject, generateText, streamText, embed } from 'ai';
import type { LanguageModelV1 } from 'ai';
import type { z } from 'zod';
import { getModel, getEmbeddingModel, type TenantLLMConfig, type ProviderWithFallback } from './provider.js';
import { isCircuitOpen, recordFailure, recordSuccess } from './circuit-breaker.js';
import { reserveTokens, adjustTokens, reserveIngestTokens } from './token-budget.js';
import { db } from '../lib/db.js';
import { llmInvocations, workspaceUsage } from '../db/schema/index.js';
import { publishMessage } from '../lib/ws.js';
import { logger } from '../lib/logger.js';
import { sql, eq, and } from 'drizzle-orm';
import {
  LLM_TIMEOUT_MS,
  DEFAULT_TOKEN_BUDGET_MONTHLY,
  DEFAULT_TOKEN_BUDGET_PER_INGEST,
  CIRCUIT_BREAKER_TTL_S,
  BUDGET_ALERT_THRESHOLD,
} from '@llm-wiki/shared';

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
    'gpt-4.1-mini': { input: 0.4 / 1_000_000, output: 1.6 / 1_000_000 },
    'gpt-4.1': { input: 2 / 1_000_000, output: 8 / 1_000_000 },
  };
  const rate = pricing[model] || pricing['gpt-4o-mini'];
  return inputTokens * rate.input + outputTokens * rate.output;
}

export class CircuitBreakerOpenError extends Error {
  constructor(public provider: string) {
    super(`Circuit breaker open for provider: ${provider}`);
    this.name = 'CircuitBreakerOpenError';
  }
}

interface InvokeOptions<T extends z.ZodType> {
  config: TenantLLMConfig;
  fallbackConfig?: TenantLLMConfig;
  workspaceId: string;
  system: string;
  prompt: string;
  schema: T;
  step: string;
  promptVersion: string;
  traceId?: string;
  sourceId?: string;
  batchIndex?: number;
  estimatedTokens?: number;
}

async function updateWorkspaceUsage(workspaceId: string, tokensUsed: number) {
  const period = new Date().toISOString().slice(0, 7).replace('-', '');
  await db
    .insert(workspaceUsage)
    .values({ workspaceId, period, tokensUsed, apiCalls: 1 })
    .onConflictDoUpdate({
      target: [workspaceUsage.workspaceId, workspaceUsage.period],
      set: {
        tokensUsed: sql`${workspaceUsage.tokensUsed} + ${tokensUsed}`,
        apiCalls: sql`${workspaceUsage.apiCalls} + 1`,
        updatedAt: new Date(),
      },
    });
}

export async function invokeStructured<T extends z.ZodType>(
  opts: InvokeOptions<T>,
): Promise<z.infer<T>> {
  const {
    config: llmConfig,
    workspaceId,
    system,
    prompt,
    schema,
    step,
    promptVersion,
    traceId,
    sourceId,
    batchIndex,
    estimatedTokens = 2000,
  } = opts;

  if (await isCircuitOpen(llmConfig.provider)) {
    if (opts.fallbackConfig && !(await isCircuitOpen(opts.fallbackConfig.provider))) {
      logger.warn({ primary: llmConfig.provider, fallback: opts.fallbackConfig.provider }, 'Primary provider circuit open, using fallback');
      return invokeStructured({ ...opts, config: opts.fallbackConfig, fallbackConfig: undefined });
    }
    throw new CircuitBreakerOpenError(llmConfig.provider);
  }

  const budgetOk = await reserveTokens(workspaceId, estimatedTokens, DEFAULT_TOKEN_BUDGET_MONTHLY);
  if (!budgetOk) {
    throw new Error('Monthly token budget exceeded');
  }

  if (opts.sourceId) {
    const ingestOk = await reserveIngestTokens(opts.sourceId, estimatedTokens, DEFAULT_TOKEN_BUDGET_PER_INGEST);
    if (!ingestOk) {
      await adjustTokens(workspaceId, estimatedTokens, 0);
      throw new Error('Per-ingest token budget exceeded');
    }
  }

  const model = getModel(llmConfig);
  const startTime = Date.now();

  try {
    const result = await generateObject({
      model: model as LanguageModelV1,
      schema,
      system,
      prompt,
      abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    const durationMs = Date.now() - startTime;
    const inputTokens = result.usage?.promptTokens ?? 0;
    const outputTokens = result.usage?.completionTokens ?? 0;
    const actualTokens = inputTokens + outputTokens;

    await adjustTokens(workspaceId, estimatedTokens, actualTokens);
    await recordSuccess(llmConfig.provider);
    await updateWorkspaceUsage(workspaceId, actualTokens);

    // Budget alert at 80%
    const { getCurrentUsage } = await import('./token-budget.js');
    const currentUsage = await getCurrentUsage(workspaceId);
    const usagePercent = currentUsage / DEFAULT_TOKEN_BUDGET_MONTHLY;
    if (usagePercent >= BUDGET_ALERT_THRESHOLD) {
      await publishMessage(workspaceId, {
        type: 'budget:alert',
        payload: { workspaceId, usagePercent, tokensUsed: currentUsage, tokensBudget: DEFAULT_TOKEN_BUDGET_MONTHLY },
      });
    }

    const costUsd = estimateCostUsd(llmConfig.model, inputTokens, outputTokens);

    await db.insert(llmInvocations).values({
      workspaceId,
      provider: llmConfig.provider,
      model: llmConfig.model,
      step,
      inputTokens,
      outputTokens,
      costUsd: costUsd.toFixed(6),
      durationMs,
      promptVersion,
      traceId,
      sourceId,
      batchIndex,
    }).onConflictDoNothing();

    return result.object;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    await adjustTokens(workspaceId, estimatedTokens, 0);
    const circuitTripped = await recordFailure(llmConfig.provider);

    if (circuitTripped) {
      const { activityLogs } = await import('../db/schema/index.js');
      await db.insert(activityLogs).values({
        workspaceId,
        action: 'circuit_breaker_open',
        entityType: 'llm_provider',
        details: { provider: llmConfig.provider, model: llmConfig.model },
        traceId,
      });
    }

    const errMsg = error instanceof Error ? error.message : String(error);

    await db.insert(llmInvocations).values({
      workspaceId,
      provider: llmConfig.provider,
      model: llmConfig.model,
      step,
      durationMs,
      promptVersion,
      traceId,
      sourceId,
      batchIndex,
      errorMessage: errMsg,
    }).onConflictDoNothing();

    logger.error({ err: error, step, provider: llmConfig.provider }, 'LLM invocation failed');
    throw error;
  }
}

export async function invokeStream(opts: {
  config: TenantLLMConfig;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}) {
  const model = getModel(opts.config);
  return streamText({
    model: model as LanguageModelV1,
    system: opts.system,
    messages: opts.messages,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
}

export async function generateEmbedding(
  config: TenantLLMConfig,
  text: string,
): Promise<number[]> {
  const model = getEmbeddingModel(config);
  const result = await embed({
    model,
    value: text,
  });
  return result.embedding;
}
