import type { LlmCallUsage } from './adapter.js';

/**
 * Clamps a user-supplied `maxTurns` into the range this codebase considers
 * safe for one-shot structured tasks. `NaN` / non-positive / non-finite input
 * falls back to `fallback`. Both surfaces read this from user config, so
 * keeping the bounds in one place avoids drift.
 */
export function clampFlowMaxTurns(raw: unknown, fallback = 20): number {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(200, Math.round(n)));
}

/**
 * Maps the four canonical effort levels to `maxThinkingTokens`. Returns
 * `undefined` for anything else (including `'default'`), leaving the SDK
 * default in place. Kept here rather than in each surface so a new adapter
 * caller doesn't reinvent the mapping.
 */
export function effortToMaxThinkingTokens(effort: string | undefined): number | undefined {
  switch (effort) {
    case 'low':
      return 1024;
    case 'medium':
      return 4096;
    case 'high':
      return 16384;
    case 'max':
      return 32768;
    default:
      return undefined;
  }
}

/**
 * Flattens `LlmCallUsage` into a log-line-friendly record with per-model
 * costs rounded to 6 decimals. Both the VSCode extension and the TUI want
 * the exact same log shape; centralising it here keeps them from drifting.
 */
export function formatUsageForLog(usage: LlmCallUsage): Record<string, unknown> {
  const models = Object.entries(usage.models).map(([name, mu]) => ({
    model: name,
    in: mu.inputTokens,
    out: mu.outputTokens,
    cacheRead: mu.cacheReadInputTokens,
    cacheCreate: mu.cacheCreationInputTokens,
    costUsd: Number(mu.costUSD.toFixed(6)),
  }));
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheCreate: usage.cacheCreationInputTokens,
    cacheRead: usage.cacheReadInputTokens,
    total: usage.totalTokens,
    turns: usage.numTurns,
    durationMs: usage.durationMs,
    durationApiMs: usage.durationApiMs,
    costUsd: Number(usage.totalCostUsd.toFixed(6)),
    models,
  };
}
