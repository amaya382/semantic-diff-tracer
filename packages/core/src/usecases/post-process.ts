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

/**
 * Path shapes that settle the kind on their own. Checked in order, and only
 * when *every* primary file matches: a perspective mixing config with source is
 * about the source, so the LLM's judgement stands.
 */
const KIND_BY_PATH: Array<{ kind: PerspectiveKind; matches: (file: string) => boolean }> = [
  {
    kind: 'test',
    matches: (f) =>
      /(^|\/)(__tests__|e2e|fixtures|testdata)\//.test(f) || /\.(test|spec)\.[^./]+$/.test(f),
  },
  {
    kind: 'docs',
    matches: (f) => /(^|\/)docs\//.test(f) || /\.mdx?$/.test(f) || /(^|\/)LICENSE$/.test(f),
  },
  {
    kind: 'deps',
    matches: (f) =>
      /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum|go\.mod|requirements\.txt)$/.test(
        f,
      ),
  },
  {
    kind: 'config',
    matches: (f) =>
      /(^|\/)\.github\//.test(f) ||
      /\.(ya?ml|toml|ini|tf)$/.test(f) ||
      /(^|\/)Dockerfile[^/]*$/.test(f) ||
      /(^|\/)tsconfig[^/]*\.json$/.test(f) ||
      /\.config\.(js|ts|mjs|cjs)$/.test(f),
  },
];

function fileOverlap(a: PerspectiveDraft, b: PerspectiveDraft): number {
  const setA = new Set(a.primaryFiles);
  const setB = new Set(b.primaryFiles);
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
  const files = Array.from(new Set([...a.primaryFiles, ...b.primaryFiles]));
  return {
    id: a.id,
    title: `${a.title} + ${b.title}`,
    outcome: `${a.outcome}; also: ${b.outcome}`,
    hunkRefs: hunks,
    primaryFiles: files,
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
    const isTrivial = p.hunkRefs.length === 1 && p.primaryFiles.length === 1;
    if (isTrivial) {
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

export function refineKind(perspectives: PerspectiveDraft[]): PerspectiveDraft[] {
  return perspectives.map((p) => {
    const files = p.primaryFiles;
    const settled = files.length > 0 && KIND_BY_PATH.find((c) => files.every(c.matches));
    return { ...p, kind: settled ? settled.kind : normalizeKind(p.kind) };
  });
}

export function postProcess(set: PerspectiveSet): PerspectiveSet {
  const merged = mergeOverlapping(set.perspectives);
  const refined = refineKind(merged);
  return demoteSingletons({ ...set, perspectives: refined });
}
