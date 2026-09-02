import type {
  Flow,
  SummaryPayload,
  PerspectiveSet,
  PrRef,
  QaSection,
  TraceDepth,
  UnifiedDiff,
} from '@semantic-diff-tracer/core';
import { DEFAULT_TRACE_DEPTH } from '@semantic-diff-tracer/core';
import type { LoadingTask } from './panels/perspective-panel.js';

/** Background work in flight for one perspective, mirrored into the webview. */
export interface PerspectiveLoading {
  summary?: LoadingTask;
  flow?: LoadingTask;
}

/**
 * Snapshot of everything the panels + tree need to render. Held by `extension.ts`
 * and mutated in-place; every panel reads through `getState()` at render time
 * and subscribes to `onDidChange` for updates.
 */
export interface ExtensionState {
  workspaceRoot: string | undefined;
  ref: PrRef | undefined;
  prMeta:
    | {
        title: string;
        body: string;
        author: string;
        baseRef: string;
        headRef: string;
        url?: string;
      }
    | undefined;
  set: PerspectiveSet | undefined;
  /** Raw diff for the current PR. Kept for change-badge summarisation in Summary. */
  diff: UnifiedDiff | undefined;
  /** per-perspective, filled as Summary tabs open. */
  summaries: Map<string, SummaryPayload>;
  /** per-perspective, in-flight summarize promise so concurrent openers dedupe. */
  summaryInFlight: Map<string, Promise<void>>;
  /** per-perspective, filled by planFlow. */
  flows: Map<string, Flow>;
  /** per-perspective, in-flight planFlow promise so concurrent openers dedupe. */
  flowInFlight: Map<string, Promise<Flow | undefined>>;
  /** per-perspective progress of the two background tasks, for the spinners. */
  loading: Map<string, PerspectiveLoading>;
  /** per-perspective ordered Q&A sections. */
  qa: Map<string, QaSection[]>;
  githubToken: string | undefined;
  /**
   * Depth for the next Summary / Trace ask. Seeded from `sdt.traceDepth` when
   * the extension activates, overridden at runtime by the Perspectives-view
   * toggle. Only affects asks fired after the toggle — already-cached summaries
   * / flows keep whatever depth they were built at.
   */
  traceDepth: TraceDepth;
}

export function makeInitialState(): ExtensionState {
  return {
    workspaceRoot: undefined,
    ref: undefined,
    prMeta: undefined,
    set: undefined,
    diff: undefined,
    summaries: new Map(),
    summaryInFlight: new Map(),
    flows: new Map(),
    flowInFlight: new Map(),
    loading: new Map(),
    qa: new Map(),
    githubToken: undefined,
    traceDepth: DEFAULT_TRACE_DEPTH,
  };
}
