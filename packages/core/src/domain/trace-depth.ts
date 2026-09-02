/**
 * How much source the summary / flow pipeline lets the LLM look at.
 *
 * - `normal`: only the diff hunks reach the model, tools are disabled, and the
 *   ask is capped at a single turn. Cheap and fully offline w.r.t. file reads.
 * - `deep`: full-file (or hunk-sliced) context is preloaded and Grep is
 *   enabled, so the model can chase symbols across the primary files.
 */
export type TraceDepth = 'normal' | 'deep';

export const DEFAULT_TRACE_DEPTH: TraceDepth = 'normal';

export function isTraceDepth(value: unknown): value is TraceDepth {
  return value === 'normal' || value === 'deep';
}

/** Parse a free-form input (env var, CLI arg, settings value). Falls back to the default on anything unrecognised. */
export function parseTraceDepth(value: unknown): TraceDepth {
  if (typeof value !== 'string') return DEFAULT_TRACE_DEPTH;
  const lowered = value.trim().toLowerCase();
  if (lowered === 'normal' || lowered === 'deep') return lowered;
  return DEFAULT_TRACE_DEPTH;
}
