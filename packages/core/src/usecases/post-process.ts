import type {
  PerspectiveDraft,
  PerspectiveKind,
  PerspectiveSet,
  IncidentalChange,
} from '../domain/perspective.js';
import { KIND_PRIORITY, isPerspectiveKind } from '../domain/perspective.js';

const MERGE_THRESHOLD = 0.5;

/** Kind the LLM falls back to when it answers with something unknown. */
const DEFAULT_KIND: PerspectiveKind = 'feature';

function filesOf(p: PerspectiveDraft): Set<string> {
  const s = new Set<string>();
  for (const h of p.hunkRefs) s.add(h.file);
  return s;
}

function fileOverlap(a: PerspectiveDraft, b: PerspectiveDraft): number {
  const setA = filesOf(a);
  const setB = filesOf(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const f of setA) if (setB.has(f)) intersection++;
  const smaller = Math.min(setA.size, setB.size);
  return smaller === 0 ? 0 : intersection / smaller;
}

function normalizeKind(kind: unknown): PerspectiveKind {
  return isPerspectiveKind(kind) ? kind : DEFAULT_KIND;
}

export function dominantKind(a: PerspectiveKind, b: PerspectiveKind): PerspectiveKind {
  const rank = (k: PerspectiveKind): number => {
    const i = KIND_PRIORITY.indexOf(k);
    return i < 0 ? KIND_PRIORITY.length : i;
  };
  return rank(a) <= rank(b) ? a : b;
}

function mergePair(a: PerspectiveDraft, b: PerspectiveDraft): PerspectiveDraft {
  const hunks = [...a.hunkRefs];
  for (const h of b.hunkRefs) {
    if (!hunks.some((x) => x.file === h.file && x.hunkIndex === h.hunkIndex)) hunks.push(h);
  }
  return {
    id: a.id,
    title: `${a.title} + ${b.title}`,
    outcome: `${a.outcome}; also: ${b.outcome}`,
    hunkRefs: hunks,
    kind: dominantKind(normalizeKind(a.kind), normalizeKind(b.kind)),
  };
}

export function mergeOverlapping(perspectives: PerspectiveDraft[]): PerspectiveDraft[] {
  const result: PerspectiveDraft[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < perspectives.length; i++) {
    if (consumed.has(i)) continue;
    let acc = perspectives[i]!;
    for (let j = i + 1; j < perspectives.length; j++) {
      if (consumed.has(j)) continue;
      if (fileOverlap(acc, perspectives[j]!) > MERGE_THRESHOLD) {
        acc = mergePair(acc, perspectives[j]!);
        consumed.add(j);
      }
    }
    result.push(acc);
  }
  return result;
}

export function demoteSingletons(set: PerspectiveSet): PerspectiveSet {
  const keep: PerspectiveDraft[] = [];
  const demoted: IncidentalChange[] = [];
  for (const p of set.perspectives) {
    if (p.hunkRefs.length === 1) {
      demoted.push({
        category: 'other',
        hunkRefs: p.hunkRefs,
        note: `demoted: ${p.title} — ${p.outcome}`,
      });
    } else {
      keep.push(p);
    }
  }
  return {
    ...set,
    perspectives: keep,
    incidental: [...set.incidental, ...demoted],
  };
}

export function postProcess(set: PerspectiveSet): PerspectiveSet {
  const merged = mergeOverlapping(set.perspectives);
  const normalized = merged.map((p) => ({ ...p, kind: normalizeKind(p.kind) }));
  return demoteSingletons({ ...set, perspectives: normalized });
}
