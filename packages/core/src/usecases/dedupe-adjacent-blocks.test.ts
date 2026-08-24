import { describe, expect, it } from 'vitest';
import type { BlockRole, FlowBlock } from '../domain/flow.js';
import { dedupeAdjacentBlocks } from './plan-flow-internals.js';

function block(
  id: string,
  file: string,
  startLine: number,
  endLine: number,
  role?: BlockRole,
  children: FlowBlock[] = [],
): FlowBlock {
  const b: FlowBlock = {
    id,
    title: id,
    narrative: id,
    focus: { file, startLine, endLine },
    code: '',
    visibleVars: [],
    mocks: [],
    concerns: [],
    children,
  };
  if (role) b.role = role;
  return b;
}

describe('dedupeAdjacentBlocks', () => {
  it('merges adjacent same-file same-role blocks', () => {
    const merged = dedupeAdjacentBlocks([
      block('a', 'src/foo.ts', 10, 12, 'removed'),
      block('b', 'src/foo.ts', 14, 16, 'removed'),
      block('c', 'src/foo.ts', 18, 20, 'removed'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe('a');
    expect(merged[0]!.focus.endLine).toBe(20);
    expect(merged[0]!.narrative).toContain('also at src/foo.ts:14');
    expect(merged[0]!.narrative).toContain('also at src/foo.ts:18');
  });

  it('does not merge across a large gap', () => {
    const merged = dedupeAdjacentBlocks([
      block('a', 'src/foo.ts', 10, 12, 'removed'),
      block('b', 'src/foo.ts', 200, 210, 'removed'),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('does not merge different files', () => {
    const merged = dedupeAdjacentBlocks([
      block('a', 'src/foo.ts', 10, 12, 'removed'),
      block('b', 'src/bar.ts', 12, 14, 'removed'),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('does not merge different roles', () => {
    const merged = dedupeAdjacentBlocks([
      block('a', 'src/foo.ts', 10, 12, 'removed'),
      block('b', 'src/foo.ts', 13, 15, 'modified'),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('dedupes recursively inside children', () => {
    const merged = dedupeAdjacentBlocks([
      block('parent', 'src/foo.ts', 1, 5, 'modified', [
        block('c1', 'src/foo.ts', 100, 101, 'removed'),
        block('c2', 'src/foo.ts', 103, 105, 'removed'),
      ]),
    ]);
    expect(merged[0]!.children).toHaveLength(1);
    expect(merged[0]!.children[0]!.focus.endLine).toBe(105);
  });
});
