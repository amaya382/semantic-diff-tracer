import type {
  PerspectiveDraft,
  PerspectiveKind,
  PerspectiveSet,
  IncidentalChange,
} from '../domain/perspective.js';
import type { HunkRef, HunkRole } from '../domain/diff.js';
import { KIND_PRIORITY, coercePerspectiveKind } from '../domain/perspective.js';

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
  return coercePerspectiveKind(kind) ?? DEFAULT_KIND;
}

function normalizeHunkRole(value: unknown): HunkRole | undefined {
  return value === 'primary' || value === 'peripheral' ? value : undefined;
}

function normalizeHunkRefs(refs: readonly HunkRef[]): HunkRef[] {
  return refs.map((r) => {
    const role = normalizeHunkRole((r as { role?: unknown }).role);
    const out: HunkRef = { file: r.file, hunkIndex: r.hunkIndex };
    if (role) out.role = role;
    return out;
  });
}

export function dominantKind(a: PerspectiveKind, b: PerspectiveKind): PerspectiveKind {
  const rank = (k: PerspectiveKind): number => {
    const i = KIND_PRIORITY.indexOf(k);
    return i < 0 ? KIND_PRIORITY.length : i;
  };
  return rank(a) <= rank(b) ? a : b;
}

function dominantRole(a: HunkRole | undefined, b: HunkRole | undefined): HunkRole | undefined {
  // primary beats peripheral: a hunk marked primary by either side needs the
  // reviewer's attention, so keep it primary after the merge.
  if (a === 'primary' || b === 'primary') return 'primary';
  if (a === 'peripheral' || b === 'peripheral') return 'peripheral';
  return undefined;
}

function mergePair(a: PerspectiveDraft, b: PerspectiveDraft): PerspectiveDraft {
  const hunks: HunkRef[] = a.hunkRefs.map((h) => ({ ...h }));
  for (const h of b.hunkRefs) {
    const existing = hunks.find((x) => x.file === h.file && x.hunkIndex === h.hunkIndex);
    if (existing) {
      const role = dominantRole(existing.role, h.role);
      if (role) existing.role = role;
      else delete existing.role;
    } else {
      hunks.push({ ...h });
    }
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
  const cleaned = set.perspectives.map((p) => ({
    ...p,
    hunkRefs: normalizeHunkRefs(p.hunkRefs),
  }));
  const merged = mergeOverlapping(cleaned);
  const normalized = merged.map((p) => ({ ...p, kind: normalizeKind(p.kind) }));
  return demoteSingletons({ ...set, perspectives: normalized });
}
