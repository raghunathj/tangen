/**
 * File Name: ai-keys.ts
 * Purpose: Single source of truth for LLM provider API-key resolution. Keys come
 *          from the resolved deployment configuration first,
 *          then process env. Keys never leave the server — availability is
 *          reported to clients as booleans only.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: mirrors the jwt-secret.ts "resolve in one place" pattern.
 */
import type { AIProviderName, SecretAccessorLike } from '@tangen/types'

const KEY_VARS: Record<AIProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  // OpenAI-compatible providers.
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'MOONSHOT_API_KEY',   // Kimi / Moonshot
  qwen: 'DASHSCOPE_API_KEY',  // Qwen / Alibaba DashScope
}

/**
 * Resolves a provider's API key: per-env custom var wins, process env is the
 * fallback. Empty strings count as unset.
 * @param provider - The LLM provider name.
 * @param envVars - The environment's custom var record (WorkspaceProject.envCustom[envSlug]).
 * @returns The key, or undefined when not configured.
 */
export function resolveProviderKey(
  provider: AIProviderName,
  secrets: SecretAccessorLike | undefined,
): string | undefined {
  return secrets?.get(`ai.apiKey.${provider}`) || undefined
}
