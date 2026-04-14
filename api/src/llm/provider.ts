import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV1, EmbeddingModel } from 'ai';
import { decrypt } from '../lib/crypto.js';
import { config } from '../lib/config.js';

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface TenantLLMConfig extends LLMConfig {
  encryptedApiKey?: string;
}

export function resolveApiKey(tenantConfig: TenantLLMConfig): string {
  if (tenantConfig.encryptedApiKey) {
    return decrypt(tenantConfig.encryptedApiKey);
  }
  if (tenantConfig.apiKey) {
    return tenantConfig.apiKey;
  }
  return config.openaiApiKey;
}

export function getModel(tenantConfig: TenantLLMConfig): LanguageModelV1 {
  const apiKey = resolveApiKey(tenantConfig);

  switch (tenantConfig.provider) {
    case 'openai': {
      const provider = createOpenAI({ apiKey });
      return provider(tenantConfig.model) as LanguageModelV1;
    }

    case 'anthropic': {
      const provider = createAnthropic({ apiKey });
      return provider(tenantConfig.model) as LanguageModelV1;
    }

    case 'custom': {
      const provider = createOpenAI({
        baseURL: tenantConfig.baseUrl,
        apiKey,
      });
      return provider(tenantConfig.model) as LanguageModelV1;
    }

    default:
      throw new Error(`Unknown provider: ${tenantConfig.provider}`);
  }
}

export function getEmbeddingModel(tenantConfig: TenantLLMConfig): EmbeddingModel<string> {
  const apiKey = resolveApiKey(tenantConfig);

  switch (tenantConfig.provider) {
    case 'openai': {
      const provider = createOpenAI({ apiKey });
      return provider.embedding('text-embedding-3-small') as EmbeddingModel<string>;
    }

    case 'custom': {
      const provider = createOpenAI({
        baseURL: tenantConfig.baseUrl,
        apiKey,
      });
      return provider.embedding(tenantConfig.model || 'text-embedding-3-small') as EmbeddingModel<string>;
    }

    default: {
      const provider = createOpenAI({ apiKey: config.openaiApiKey });
      return provider.embedding('text-embedding-3-small') as EmbeddingModel<string>;
    }
  }
}

export interface ProviderWithFallback {
  primary: TenantLLMConfig;
  fallback?: TenantLLMConfig;
}

export function getModelWithFallback(
  configs: ProviderWithFallback,
  isFallback = false,
): { model: LanguageModelV1; config: TenantLLMConfig; isFallback: boolean } {
  const activeConfig = isFallback && configs.fallback ? configs.fallback : configs.primary;
  return {
    model: getModel(activeConfig),
    config: activeConfig,
    isFallback,
  };
}

export const defaultConfig: TenantLLMConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
};
