import { describe, expect, it } from 'vitest';
import type { BlockRole, FlowBlock, Focal } from '../domain/flow.js';
import {
  clipFocalBudgets,
  dedupeAdjacentBlocks,
  normalizeFromRawBlocks,
} from './plan-flow-internals.js';

function focalBlock(
  id: string,
  file: string,
  startLine: number,
  endLine: number,
  focal?: Focal,
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
  if (focal) b.focal = focal;
  return b;
}

describe('normalizeFromRawBlocks (focal coercion)', () => {
  it('accepts entry / core / contract kinds with a non-empty reason', () => {
    const [entry, core, contract] = normalizeFromRawBlocks(
      [
        { id: 'b1', focal: { kind: 'entry', reason: 'new entry after split' } },
        { id: 'b2', focal: { kind: 'core', reason: 'dispatch by event.type' } },
        { id: 'b3', focal: { kind: 'contract', reason: 'shape gained receivedAt' } },
      ],
      'p',
    );
    expect(entry?.focal).toEqual({ kind: 'entry', reason: 'new entry after split' });
    expect(core?.focal).toEqual({ kind: 'core', reason: 'dispatch by event.type' });
    expect(contract?.focal).toEqual({ kind: 'contract', reason: 'shape gained receivedAt' });
  });

  it('falls back boundary -> contract to absorb the legacy 4-kind vocab', () => {
    const [b] = normalizeFromRawBlocks(
      [{ id: 'b1', focal: { kind: 'boundary', reason: 'downstream now sees emitted event' } }],
      'p',
    );
    expect(b?.focal).toEqual({
      kind: 'contract',
      reason: 'downstream now sees emitted event',
    });
  });

  it('drops focal entirely for unsupported kinds', () => {
    const [b] = normalizeFromRawBlocks(
      [{ id: 'b1', focal: { kind: 'severity', reason: 'looks focal-shaped' } }],
      'p',
    );
    expect(b?.focal).toBeUndefined();
  });

  it('drops focal when reason is empty or whitespace', () => {
    const [empty, ws] = normalizeFromRawBlocks(
      [
        { id: 'b1', focal: { kind: 'core', reason: '' } },
        { id: 'b2', focal: { kind: 'core', reason: '   ' } },
      ],
      'p',
    );
    expect(empty?.focal).toBeUndefined();
    expect(ws?.focal).toBeUndefined();
  });

  it('trims whitespace around reason but keeps the payload', () => {
    const [b] = normalizeFromRawBlocks(
      [{ id: 'b1', focal: { kind: 'core', reason: '  dispatch by event.type  ' } }],
      'p',
    );
    expect(b?.focal?.reason).toBe('dispatch by event.type');
  });

  it('treats null / missing focal as absent', () => {
    const [nullish, missing] = normalizeFromRawBlocks(
      [
        { id: 'b1', focal: null },
        { id: 'b2' },
      ],
      'p',
    );
    expect(nullish?.focal).toBeUndefined();
    expect(missing?.focal).toBeUndefined();
  });
});

describe('clipFocalBudgets', () => {
  it('keeps focal within per-kind budgets in DFS order', () => {
    const blocks = [
      focalBlock('b1', 'a.ts', 1, 5, { kind: 'core', reason: 'first core' }, 'modified'),
      focalBlock('b2', 'a.ts', 6, 10, { kind: 'core', reason: 'second core' }, 'modified'),
      focalBlock('b3', 'a.ts', 11, 15, { kind: 'core', reason: 'third core — over budget' }, 'modified'),
    ];
    clipFocalBudgets(blocks);
    expect(blocks[0]?.focal?.reason).toBe('first core');
    expect(blocks[1]?.focal?.reason).toBe('second core');
    expect(blocks[2]?.focal).toBeUndefined();
  });

  it('shares the contract budget across shape and observable-effect uses', () => {
    const blocks = [
      focalBlock('c1', 'a.ts', 1, 5, { kind: 'contract', reason: 'shape 1' }),
      focalBlock('c2', 'a.ts', 6, 10, { kind: 'contract', reason: 'shape 2' }),
      focalBlock('c3', 'a.ts', 11, 15, { kind: 'contract', reason: 'shape 3' }),
      focalBlock('c4', 'a.ts', 16, 20, { kind: 'contract', reason: 'over budget' }),
    ];
    clipFocalBudgets(blocks);
    expect(blocks.map((b) => b.focal?.reason)).toEqual([
      'shape 1',
      'shape 2',
      'shape 3',
      undefined,
    ]);
  });

  it('drops focal on role=unchanged first when the total budget forces a cut', () => {
    const blocks = [
      focalBlock('b1', 'a.ts', 1, 5, { kind: 'core', reason: 'core' }, 'modified'),
      focalBlock('b2', 'a.ts', 6, 10, { kind: 'entry', reason: 'entry' }, 'added'),
      focalBlock('b3', 'a.ts', 11, 15, { kind: 'contract', reason: 'contract' }, 'modified'),
      focalBlock('b4', 'a.ts', 16, 20, { kind: 'contract', reason: 'contract' }, 'unchanged'),
      focalBlock('b5', 'a.ts', 21, 25, { kind: 'contract', reason: 'contract' }, 'modified'),
      focalBlock('b6', 'a.ts', 26, 30, { kind: 'entry', reason: 'entry' }, 'modified'),
    ];
    clipFocalBudgets(blocks);
    // Total budget is 5; the unchanged block loses its focal first.
    expect(blocks[3]?.focal).toBeUndefined();
    expect(blocks.filter((b) => b.focal).length).toBe(5);
  });

  it('is a no-op when no block carries focal', () => {
    const blocks = [
      focalBlock('b1', 'a.ts', 1, 5),
      focalBlock('b2', 'a.ts', 6, 10),
    ];
    clipFocalBudgets(blocks);
    expect(blocks.every((b) => !b.focal)).toBe(true);
  });

  it('walks children too', () => {
    const child1 = focalBlock('c1', 'a.ts', 3, 3, { kind: 'core', reason: 'nested core 1' });
    const child2 = focalBlock('c2', 'a.ts', 4, 4, { kind: 'core', reason: 'nested core 2' });
    const child3 = focalBlock('c3', 'a.ts', 5, 5, { kind: 'core', reason: 'nested core over budget' });
    const parent = focalBlock('p1', 'a.ts', 1, 10, undefined, 'modified', [child1, child2, child3]);
    clipFocalBudgets([parent]);
    expect(child1.focal?.reason).toBe('nested core 1');
    expect(child2.focal?.reason).toBe('nested core 2');
    expect(child3.focal).toBeUndefined();
  });
});

describe('dedupeAdjacentBlocks (focal preservation)', () => {
  it('keeps the earlier block\'s focal when merging into it', () => {
    const merged = dedupeAdjacentBlocks([
      focalBlock('a', 'x.ts', 1, 2, { kind: 'core', reason: 'kept' }, 'modified'),
      focalBlock('b', 'x.ts', 3, 4, { kind: 'entry', reason: 'dropped' }, 'modified'),
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0]?.focal).toEqual({ kind: 'core', reason: 'kept' });
  });

  it('adopts extra focal only when prev has none', () => {
    const merged = dedupeAdjacentBlocks([
      focalBlock('a', 'x.ts', 1, 2, undefined, 'modified'),
      focalBlock('b', 'x.ts', 3, 4, { kind: 'entry', reason: 'adopted from extra' }, 'modified'),
    ]);
    expect(merged.length).toBe(1);
    expect(merged[0]?.focal).toEqual({ kind: 'entry', reason: 'adopted from extra' });
  });
});
