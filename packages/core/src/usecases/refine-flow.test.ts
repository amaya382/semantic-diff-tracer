import { describe, expect, it } from 'vitest';
import type {
  Conversation,
  LlmAskInput,
  LlmAskResult,
  LlmProvider,
} from '../ports/llm-provider.js';
import type { DiffPort } from '../ports/diff.js';
import type { SessionStorePort } from '../ports/session-store.js';
import type { Flow, FlowBlock, Mock } from '../domain/flow.js';
import type { PrRef } from '../domain/pr-ref.js';
import type { UnifiedDiff } from '../domain/diff.js';
import { refineFlowFromMock } from './refine-flow.js';

function ref(): PrRef {
  return { kind: 'local', baseSha: 'b', headSha: 'h', baseRef: 'main', headRef: 'x' };
}

function block(id: string, file = 'src/auth.ts', line = 1): FlowBlock {
  return {
    id,
    title: id,
    narrative: `narrative for ${id}`,
    focus: { file, startLine: line, endLine: line + 1 },
    code: 'existing code',
    visibleVars: [],
    mocks: [],
    concerns: [],
    children: [],
  };
}

function flow(): Flow {
  return {
    flowId: 'flow-1',
    perspectiveId: 'auth',
    blocks: [block('b1', 'src/auth.ts', 1), block('b2', 'src/auth.ts', 10)],
    allMocks: [],
  };
}

function mock(): Mock {
  return {
    id: 'm1',
    symbol: 'refresh',
    file: 'src/auth.ts',
    kind: 'stub',
    reason: 'external',
    editable: true,
    userOverridden: false,
  };
}

function diff(): UnifiedDiff {
  return { baseSha: 'b', headSha: 'h', files: [] };
}

class Diff implements DiffPort {
  async getDiff(): Promise<UnifiedDiff> {
    return diff();
  }
  async readFileAtSha(): Promise<string | null> {
    return null;
  }
}

class MemStore implements SessionStorePort {
  private readonly data = new Map<string, string>();
  async get(k: string): Promise<string | undefined> {
    return this.data.get(k);
  }
  async set(k: string, v: string): Promise<void> {
    this.data.set(k, v);
  }
  async delete(k: string): Promise<void> {
    this.data.delete(k);
  }
  async listByPrefix(prefix: string): Promise<Array<{ key: string; sessionId: string }>> {
    return [...this.data.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([key, sessionId]) => ({ key, sessionId }));
  }
}

interface Capture {
  asks: LlmAskInput[];
}

function makeLlm(response: string, capture: Capture): LlmProvider {
  const makeConv = (id: string): Conversation => ({
    id,
    async ask(input: LlmAskInput): Promise<LlmAskResult> {
      capture.asks.push(input);
      return { text: response };
    },
    fork: () => makeConv(id),
  });
  return {
    startConversation() {
      return makeConv('conv-fresh');
    },
    resumeConversation(id: string) {
      return makeConv(id);
    },
  };
}

describe('refineFlowFromMock', () => {
  it('applies a replacement patch and leaves untouched blocks with their original id', async () => {
    const store = new MemStore();
    await store.set('local:main..x@h::flow:auth', 'flow-conv');
    const capture: Capture = { asks: [] };
    const patch = JSON.stringify({
      replacements: [
        {
          blockId: 'b2',
          block: {
            id: 'b2-new',
            title: 'refined',
            narrative: 'refined narrative',
            focus: { file: 'src/auth.ts', startLine: 10, endLine: 11 },
            visibleVars: [],
            mocks: [],
            concerns: [],
            children: [],
          },
        },
      ],
      removals: [],
      insertions: [],
    });
    const llm = makeLlm(patch, capture);
    const result = await refineFlowFromMock(
      { llm, diff: new Diff(), sessionStore: store },
      { ref: ref(), flow: flow(), targetMock: mock(), instruction: 'return real value' },
    );
    expect(capture.asks[0]?.tools).toEqual(['Grep']);
    expect(result.blocks).toHaveLength(2);
    // Replacement keeps the ORIGINAL id (the client applies by id).
    expect(result.blocks[1]?.id).toBe('b2');
    expect(result.blocks[1]?.narrative).toBe('refined narrative');
    // Untouched block passes through as a shallow copy — content unchanged.
    expect(result.blocks[0]?.id).toBe('b1');
    expect(result.blocks[0]?.narrative).toBe('narrative for b1');
  });

  it('drops removed blocks and inserts new root-level blocks at the given index', async () => {
    const store = new MemStore();
    await store.set('local:main..x@h::flow:auth', 'flow-conv');
    const capture: Capture = { asks: [] };
    const patch = JSON.stringify({
      replacements: [],
      removals: ['b1'],
      insertions: [
        {
          parentId: null,
          index: 0,
          block: {
            id: 'inserted-0',
            title: 'new root',
            narrative: 'new',
            focus: { file: 'src/other.ts', startLine: 1, endLine: 2 },
            visibleVars: [],
            mocks: [],
            concerns: [],
            children: [],
          },
        },
      ],
    });
    const llm = makeLlm(patch, capture);
    const result = await refineFlowFromMock(
      { llm, diff: new Diff(), sessionStore: store },
      { ref: ref(), flow: flow(), targetMock: mock(), instruction: 'drop b1' },
    );
    // b1 removed, b2 kept, inserted-0 prepended.
    expect(result.blocks.map((b) => b.id)).toEqual(['inserted-0', 'b2']);
  });

  it('throws when the flow session is not stored', async () => {
    const store = new MemStore();
    const capture: Capture = { asks: [] };
    const llm = makeLlm('{}', capture);
    await expect(
      refineFlowFromMock(
        { llm, diff: new Diff(), sessionStore: store },
        { ref: ref(), flow: flow(), targetMock: mock(), instruction: 'x' },
      ),
    ).rejects.toThrow(/No live flow session/);
  });
});
