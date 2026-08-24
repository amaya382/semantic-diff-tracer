import { describe, expect, it } from 'vitest';
import type { PerspectiveDraft, PerspectiveKind } from '../domain/perspective.js';
import { dominantKind, mergeOverlapping, refineKind } from './post-process.js';

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
    primaryFiles: files,
    kind,
  };
}

describe('refineKind', () => {
  it('forces the kind when every primary file matches one path shape', () => {
    const refined = refineKind([
      draft('a', ['src/foo.test.ts', 'e2e/bar.ts'], 'feature'),
      draft('b', ['README.md', 'docs/design.md'], 'feature'),
      draft('c', ['package-lock.json'], 'feature'),
      draft('d', ['.github/workflows/ci.yml', 'Dockerfile'], 'feature'),
    ]);
    expect(refined.map((p) => p.kind)).toEqual(['test', 'docs', 'deps', 'config']);
  });

  it('keeps the LLM kind when source files are mixed in', () => {
    const refined = refineKind([draft('a', ['src/auth.ts', 'src/auth.test.ts'], 'fix')]);
    expect(refined[0]!.kind).toBe('fix');
  });

  it('falls back to feature for an unknown kind', () => {
    const bogus = { ...draft('a', ['src/auth.ts']), kind: 'chore' as PerspectiveKind };
    expect(refineKind([bogus])[0]!.kind).toBe('feature');
  });

  it('leaves a perspective with no primary files to the LLM kind', () => {
    expect(refineKind([draft('a', [], 'refactor')])[0]!.kind).toBe('refactor');
  });
});

describe('dominantKind', () => {
  it('keeps the kind that needs the most reviewer attention', () => {
    expect(dominantKind('config', 'fix')).toBe('fix');
    expect(dominantKind('api', 'refactor')).toBe('api');
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
