import { describe, expect, it } from 'vitest';
import type { Flow, FlowBlock } from '../domain/flow.js';
import { blockAt, dfsPaths, stepFlow } from './step-flow.js';

function block(id: string, children: FlowBlock[] = []): FlowBlock {
  return {
    id,
    title: id,
    narrative: '',
    focus: { file: 'x.ts', startLine: 1, endLine: 1 },
    code: '',
    visibleVars: [],
    mocks: [],
    concerns: [],
    children,
  };
}

const flow: Flow = {
  flowId: 'f',
  perspectiveId: 'p',
  allMocks: [],
  blocks: [
    block('A', [block('A1'), block('A2', [block('A2a'), block('A2b')])]),
    block('B'),
    block('C', [block('C1')]),
  ],
};

describe('dfsPaths', () => {
  it('flattens in pre-order DFS', () => {
    const ids = dfsPaths(flow).map((p) => blockAt(flow, p)?.id);
    expect(ids).toEqual(['A', 'A1', 'A2', 'A2a', 'A2b', 'B', 'C', 'C1']);
  });
});

describe('stepFlow', () => {
  it('step in goes to first child, otherwise falls through to over', () => {
    // at 'A' with children → A1
    const r1 = stepFlow(flow, [0], 'in', []);
    expect(blockAt(flow, r1.next!)?.id).toBe('A1');
    // at 'A1' with no children → A2 (next sibling)
    const r2 = stepFlow(flow, [0, 0], 'in', []);
    expect(blockAt(flow, r2.next!)?.id).toBe('A2');
  });

  it('step over skips descendants of the current block', () => {
    // at 'A' → next non-descendant is B
    const r = stepFlow(flow, [0], 'over', []);
    expect(blockAt(flow, r.next!)?.id).toBe('B');
  });

  it('step out escapes the current parent', () => {
    // at 'A2a' → parent 'A2', next non-descendant of A2 is B
    const r = stepFlow(flow, [0, 1, 0], 'out', []);
    expect(blockAt(flow, r.next!)?.id).toBe('B');
  });

  it('step over at the last block ends the flow', () => {
    const r = stepFlow(flow, [2, 0], 'over', []);
    expect(r.next).toBeUndefined();
    expect(r.historyPush).toBeDefined();
  });

  it('reverse pops the caller-supplied history', () => {
    const r = stepFlow(flow, [1], 'reverse', [[0], [0, 0]]);
    expect(blockAt(flow, r.next!)?.id).toBe('A1');
    expect(r.historyPop).toBe(true);
  });

  it('reverse with empty history is a no-op', () => {
    const r = stepFlow(flow, [0], 'reverse', []);
    expect(r.next).toBeUndefined();
    expect(r.historyPush).toBeUndefined();
    expect(r.historyPop).toBeUndefined();
  });
});
