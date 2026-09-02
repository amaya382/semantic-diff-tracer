import { describe, expect, it } from 'vitest';
import type { PerspectiveDraft } from '../domain/perspective.js';
import type { UnifiedDiff } from '../domain/diff.js';
import type { DiffPort } from '../ports/diff.js';
import type { PrRef } from '../domain/pr-ref.js';
import {
  buildHunkOnlyCodeContext,
  buildPerspectiveCodeContext,
} from './perspective-code-context.js';

function draft(files: Array<{ file: string; hunkIndex: number }>): PerspectiveDraft {
  return {
    id: 'p1',
    title: 't',
    outcome: 'o',
    hunkRefs: files,
    kind: 'feature',
  };
}

function ref(): PrRef {
  return {
    kind: 'local',
    baseSha: 'base-sha',
    headSha: 'head-sha',
    baseRef: 'main',
    headRef: 'branch',
  };
}

function diffFor(files: string[]): UnifiedDiff {
  return {
    baseSha: 'base-sha',
    headSha: 'head-sha',
    files: files.map((path) => ({
      path,
      status: 'modified',
      additions: 1,
      deletions: 0,
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 10,
          newLines: 3,
          header: `@@ -1,1 +10,3 @@`,
          body: '+added line\n context\n context',
        },
      ],
    })),
  };
}

class InMemoryDiff implements DiffPort {
  constructor(
    private readonly diff: UnifiedDiff,
    private readonly files: Record<string, string | null>,
  ) {}
  async getDiff(): Promise<UnifiedDiff> {
    return this.diff;
  }
  async readFileAtSha(_sha: string, path: string): Promise<string | null> {
    return this.files[path] ?? null;
  }
}

describe('buildPerspectiveCodeContext', () => {
  it('embeds full file content when it fits the byte budget', async () => {
    const content = 'export const answer = 42;\n';
    const diff = diffFor(['a.ts']);
    const port = new InMemoryDiff(diff, { 'a.ts': content });
    const result = await buildPerspectiveCodeContext(
      ref(),
      draft([{ file: 'a.ts', hunkIndex: 0 }]),
      diff,
      port,
    );
    expect(result.fullFiles).toEqual(['a.ts']);
    expect(result.slicedFiles).toEqual([]);
    expect(result.text).toContain('a.ts (full file');
    expect(result.text).toContain('export const answer = 42;');
  });

  it('falls back to hunk-anchored slices when the byte budget overflows', async () => {
    const big = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
    const diff = diffFor(['big.ts']);
    const port = new InMemoryDiff(diff, { 'big.ts': big });
    const result = await buildPerspectiveCodeContext(
      ref(),
      draft([{ file: 'big.ts', hunkIndex: 0 }]),
      diff,
      port,
      { maxFullFileBytes: 10, sliceContextLines: 2 },
    );
    expect(result.fullFiles).toEqual([]);
    expect(result.slicedFiles).toEqual(['big.ts']);
    expect(result.text).toContain('big.ts (slice around hunk #0');
    expect(result.text).toContain('line 10');
    expect(result.text).not.toContain('line 1\n');
  });

  it('falls back to raw hunk body when readFileAtSha returns null', async () => {
    const diff = diffFor(['gone.ts']);
    const port = new InMemoryDiff(diff, { 'gone.ts': null });
    const result = await buildPerspectiveCodeContext(
      ref(),
      draft([{ file: 'gone.ts', hunkIndex: 0 }]),
      diff,
      port,
    );
    expect(result.fullFiles).toEqual([]);
    expect(result.slicedFiles).toEqual([]);
    expect(result.hunkOnlyFiles).toEqual(['gone.ts']);
    expect(result.text).toContain('gone.ts (diff hunk #0');
    expect(result.text).toContain('+added line');
  });

  it('returns empty text when no file yields content', async () => {
    const diff = diffFor([]);
    const port = new InMemoryDiff(diff, {});
    const result = await buildPerspectiveCodeContext(
      ref(),
      draft([{ file: 'nope.ts', hunkIndex: 0 }]),
      diff,
      port,
    );
    expect(result.text).toBe('');
    expect(result.bytes).toBe(0);
  });
});

describe('buildHunkOnlyCodeContext', () => {
  it('embeds only the raw diff hunk bodies without reading any file', () => {
    const diff = diffFor(['a.ts']);
    const result = buildHunkOnlyCodeContext(
      draft([{ file: 'a.ts', hunkIndex: 0 }]),
      diff,
    );
    expect(result.fullFiles).toEqual([]);
    expect(result.slicedFiles).toEqual([]);
    expect(result.hunkOnlyFiles).toEqual(['a.ts']);
    expect(result.text).toContain('## Diff hunks');
    expect(result.text).toContain('a.ts (diff hunk #0');
    expect(result.text).toContain('+added line');
  });

  it('ignores peripheral hunks the same way the deep path does', () => {
    const diff = diffFor(['primary.ts', 'peripheral.ts']);
    const persp: PerspectiveDraft = {
      id: 'p1',
      title: 't',
      outcome: 'o',
      kind: 'feature',
      hunkRefs: [
        { file: 'primary.ts', hunkIndex: 0, role: 'primary' },
        { file: 'peripheral.ts', hunkIndex: 0, role: 'peripheral' },
      ],
    };
    const result = buildHunkOnlyCodeContext(persp, diff);
    expect(result.hunkOnlyFiles).toEqual(['primary.ts']);
    expect(result.text).not.toContain('peripheral.ts');
  });

  it('returns empty result when no primary hunks match a file in the diff', () => {
    const diff = diffFor([]);
    const result = buildHunkOnlyCodeContext(
      draft([{ file: 'nope.ts', hunkIndex: 0 }]),
      diff,
    );
    expect(result.text).toBe('');
    expect(result.bytes).toBe(0);
    expect(result.hunkOnlyFiles).toEqual([]);
  });
});
