import { describe, expect, it } from 'vitest';
import type { UnifiedDiff } from '../domain/diff.js';
import { summariseChange } from './diff-change.js';

function fixture(): UnifiedDiff {
  return {
    baseSha: 'BASE',
    headSha: 'HEAD',
    files: [
      {
        path: 'src/a.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
        hunks: [
          {
            oldStart: 10,
            oldLines: 4,
            newStart: 10,
            newLines: 6,
            header: '',
            body: [
              ' const x = 1;',
              '-const y = 2;',
              '+const y = 20;',
              '+const z = 3;',
              '+const w = 4;',
              ' const done = true;',
            ].join('\n'),
          },
        ],
      },
      {
        path: 'src/new.ts',
        status: 'added',
        additions: 42,
        deletions: 0,
        hunks: [],
      },
      {
        path: 'src/gone.ts',
        status: 'removed',
        additions: 0,
        deletions: 5,
        hunks: [],
      },
    ],
  };
}

describe('summariseChange', () => {
  it('flags modified when the range has both + and -', () => {
    const r = summariseChange(fixture(), 'src/a.ts', 10, 14);
    expect(r.kind).toBe('modified');
    expect(r.additions).toBe(3);
    expect(r.deletions).toBe(1);
  });

  it('flags added when the file itself is new', () => {
    const r = summariseChange(fixture(), 'src/new.ts', 1, 10);
    expect(r.kind).toBe('added');
    expect(r.additions).toBe(42);
  });

  it('flags removed when the file itself is deleted', () => {
    const r = summariseChange(fixture(), 'src/gone.ts', 1, 10);
    expect(r.kind).toBe('removed');
    expect(r.deletions).toBe(5);
  });

  it('flags unchanged when the range sits outside every hunk', () => {
    const r = summariseChange(fixture(), 'src/a.ts', 100, 200);
    expect(r.kind).toBe('unchanged');
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
  });

  it('flags unknown when the file is not in the diff', () => {
    const r = summariseChange(fixture(), 'src/missing.ts', 1, 10);
    expect(r.kind).toBe('unknown');
  });
});
