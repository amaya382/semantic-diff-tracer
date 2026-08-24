import type { HunkRef } from './diff.js';

/** Reviewer-facing label for what a perspective changes. Shown as the chip. */
export type PerspectiveKind =
  | 'feature'
  | 'fix'
  | 'refactor'
  | 'api'
  | 'schema'
  | 'config'
  | 'deps'
  | 'docs'
  | 'test';

/**
 * Shape the story-mode trace should take. Selects the mode section appended to
 * the flow system prompt; several kinds share one mode, so adding a kind does
 * not add a prompt.
 */
export type TraceMode = 'flow' | 'structural' | 'contract' | 'surface';

export const TRACE_MODE_BY_KIND: Record<PerspectiveKind, TraceMode> = {
  feature: 'flow',
  fix: 'flow',
  refactor: 'structural',
  api: 'contract',
  schema: 'contract',
  config: 'surface',
  deps: 'surface',
  docs: 'surface',
  test: 'surface',
};

/**
 * Merge tie-break order, most reviewer-attention first. When two perspectives
 * fold into one, the survivor keeps the earlier kind.
 */
export const KIND_PRIORITY: PerspectiveKind[] = [
  'feature',
  'fix',
  'api',
  'schema',
  'refactor',
  'config',
  'deps',
  'test',
  'docs',
];

export function isPerspectiveKind(value: unknown): value is PerspectiveKind {
  return typeof value === 'string' && value in TRACE_MODE_BY_KIND;
}

export function traceModeFor(kind: PerspectiveKind): TraceMode {
  return TRACE_MODE_BY_KIND[kind];
}

export interface PerspectiveDraft {
  id: string;
  title: string;
  outcome: string;
  hunkRefs: HunkRef[];
  kind: PerspectiveKind;
}

export type IncidentalCategory = 'rename' | 'format' | 'dep-bump' | 'generated' | 'other';

export interface IncidentalChange {
  category: IncidentalCategory;
  hunkRefs: HunkRef[];
  note: string;
}

export interface PerspectiveSet {
  tldr: string;
  perspectives: PerspectiveDraft[];
  incidental: IncidentalChange[];
  readingOrder?: string;
}
