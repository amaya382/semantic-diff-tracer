import { describe, expect, it } from 'vitest';
import type { PerspectiveDraft, PerspectiveKind } from '../domain/perspective.js';
import { dominantKind, mergeOverlapping } from './post-process.js';

function draft(
  id: string,
  files: string[],
  kind: PerspectiveKind = 'feature',
): PerspectiveDraft {
  return {
    id,
    title: id,
    outcome: id,
    hunkRefs: files.map((f, i) => ({ file: f, hunkIndex: i })),
    kind,
  };
}

describe('dominantKind', () => {
  it('keeps the kind that needs the most reviewer attention', () => {
    expect(dominantKind('config', 'fix')).toBe('fix');
    expect(dominantKind('contract', 'refactor')).toBe('contract');
    expect(dominantKind('docs', 'test')).toBe('test');
  });
});

describe('mergeOverlapping', () => {
  it('gives the merged perspective the dominant kind', () => {
    const merged = mergeOverlapping([
      draft('a', ['src/auth.ts', 'src/session.ts'], 'refactor'),
      draft('b', ['src/auth.ts', 'src/session.ts'], 'feature'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind).toBe('feature');
  });
});
