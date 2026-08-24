import type { HunkRef } from './diff.js';

export interface WatchForItem {
  anchor?: { file: string; line: number };
  note: string;
}

export interface TestPointer {
  file: string;
  line: number;
  description: string;
}

/**
 * Zero-or-more small figures the LLM may attach to the summary. An empty
 * `visuals` array means it decided nothing was worth drawing — the reviewer's
 * questions, tests, and watchFor already carry the shape.
 *
 * `source` holds the raw content of the chosen form (mermaid text, unified
 * diff, code, an indented tree, …). `caption` is required for every kind
 * and states the one claim the figure makes. `language` is a hint for
 * highlighters on the `diff` and `code` kinds.
 */
export type SummaryVisual =
  | { kind: 'mermaid'; source: string; caption: string }
  | { kind: 'diff'; source: string; caption: string; language?: string | null }
  | { kind: 'code'; source: string; caption: string; language?: string | null }
  | { kind: 'pseudocode'; source: string; caption: string }
  | { kind: 'call-tree'; source: string; caption: string }
  | { kind: 'component-tree'; source: string; caption: string }
  | { kind: 'file-tree'; source: string; caption: string };

export type SummaryVisualKind = SummaryVisual['kind'];

const SUMMARY_VISUAL_KINDS: readonly SummaryVisualKind[] = [
  'mermaid',
  'diff',
  'code',
  'pseudocode',
  'call-tree',
  'component-tree',
  'file-tree',
];

/**
 * Keep only the visuals the UI can draw. The LLM occasionally invents a kind
 * outside the schema (e.g. `sequence`) or ships a visual whose `source` is
 * empty; both cases render as a card with a caption but no title and an
 * empty box, so we drop them at the boundary rather than surprise the UI.
 */
export function sanitizeSummaryVisuals(raw: unknown): SummaryVisual[] {
  if (!Array.isArray(raw)) return [];
  const out: SummaryVisual[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const kind = record['kind'];
    const source = record['source'];
    const caption = record['caption'];
    if (typeof kind !== 'string' || typeof source !== 'string' || typeof caption !== 'string') continue;
    if (!source.trim() || !caption.trim()) continue;
    if (!SUMMARY_VISUAL_KINDS.includes(kind as SummaryVisualKind)) continue;
    if (kind === 'diff' || kind === 'code') {
      const language = record['language'];
      out.push({
        kind,
        source,
        caption,
        language: typeof language === 'string' ? language : null,
      });
    } else {
      out.push({ kind: kind as Exclude<SummaryVisualKind, 'diff' | 'code'>, source, caption });
    }
  }
  return out;
}

export interface PerspectiveSummary {
  perspectiveId: string;
  outcome: string;
  tests: TestPointer[];
  watchFor: WatchForItem[];
  visuals: SummaryVisual[];
}

export interface SummaryPayload {
  summary: PerspectiveSummary;
  hunkRefs: HunkRef[];
}
