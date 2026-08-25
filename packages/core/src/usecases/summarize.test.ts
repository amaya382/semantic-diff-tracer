import { describe, expect, it } from 'vitest';
import type {
  Conversation,
  LlmAskInput,
  LlmAskResult,
  LlmProvider,
} from '../ports/llm-provider.js';
import type { DiffPort } from '../ports/diff.js';
import type { SessionStorePort } from '../ports/session-store.js';
import type { PerspectiveDraft } from '../domain/perspective.js';
import type { PrRef } from '../domain/pr-ref.js';
import type { UnifiedDiff } from '../domain/diff.js';
import { summarize } from './summarize.js';

function ref(): PrRef {
  return { kind: 'local', baseSha: 'b', headSha: 'h', baseRef: 'main', headRef: 'x' };
}

function perspective(): PerspectiveDraft {
  return {
    id: 'auth-refresh',
    title: 'Auth refresh',
    outcome: 'refresh reuses cached token',
    hunkRefs: [{ file: 'src/auth.ts', hunkIndex: 0 }],
    kind: 'feature',
  };
}

function diff(): UnifiedDiff {
  return {
    baseSha: 'b',
    headSha: 'h',
    files: [
      {
        path: 'src/auth.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            header: '@@ -1,1 +1,2 @@',
            body: '+new line',
          },
        ],
      },
    ],
  };
}

class RecorderDiff implements DiffPort {
  constructor(
    private readonly d: UnifiedDiff,
    private readonly files: Record<string, string>,
  ) {}
  async getDiff(): Promise<UnifiedDiff> {
    return this.d;
  }
  async readFileAtSha(_sha: string, path: string): Promise<string | null> {
    return this.files[path] ?? null;
  }
}

interface Capture {
  asks: LlmAskInput[];
  starts: number;
  resumes: number;
}

function makeLlm(response: string): { llm: LlmProvider; capture: Capture } {
  const capture: Capture = { asks: [], starts: 0, resumes: 0 };
  let counter = 0;
  const makeConv = (id: string): Conversation => ({
    id,
    async ask(input: LlmAskInput): Promise<LlmAskResult> {
      capture.asks.push(input);
      return { text: response };
    },
    fork: () => makeConv(id),
  });
  const llm: LlmProvider = {
    startConversation() {
      capture.starts += 1;
      counter += 1;
      return makeConv(`conv-${counter}`);
    },
    resumeConversation(id: string) {
      capture.resumes += 1;
      return makeConv(id);
    },
  };
  return { llm, capture };
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
  entries(): Array<[string, string]> {
    return [...this.data.entries()];
  }
}

const SUMMARY_RESPONSE = JSON.stringify({
  perspectiveId: 'auth-refresh',
  outcome: 'refresh reuses cached token',
  tests: [],
  watchFor: [],
  visuals: [],
});

describe('summarize', () => {
  it('embeds preloaded code and restricts tools to Grep', async () => {
    const store = new MemStore();
    const { llm, capture } = makeLlm(SUMMARY_RESPONSE);
    const diffPort = new RecorderDiff(diff(), {
      'src/auth.ts': 'export function refresh() { return "ok"; }',
    });
    await summarize(
      { llm, diff: diffPort, sessionStore: store },
      { ref: ref(), perspective: perspective() },
    );
    expect(capture.asks).toHaveLength(1);
    const [ask] = capture.asks;
    expect(ask?.tools).toEqual(['Grep']);
    expect(ask?.user).toContain('src/auth.ts');
    expect(ask?.user).toContain('export function refresh');
  });

  it('starts a fresh conversation instead of forking a base session', async () => {
    const store = new MemStore();
    const { llm, capture } = makeLlm(SUMMARY_RESPONSE);
    const diffPort = new RecorderDiff(diff(), {
      'src/auth.ts': 'refresh',
    });
    await summarize(
      { llm, diff: diffPort, sessionStore: store },
      { ref: ref(), perspective: perspective() },
    );
    expect(capture.starts).toBe(1);
    expect(capture.resumes).toBe(0);
    const keys = store.entries().map(([k]) => k);
    expect(keys.some((k) => k.includes('::summary:auth-refresh'))).toBe(true);
    expect(keys.some((k) => k.endsWith('::base'))).toBe(false);
  });

  it('resumes the cached summary session on the second call', async () => {
    const store = new MemStore();
    await store.set('local:main..x@h::summary:auth-refresh', 'existing-summary-conv');
    const { llm, capture } = makeLlm(SUMMARY_RESPONSE);
    const diffPort = new RecorderDiff(diff(), {
      'src/auth.ts': 'refresh',
    });
    await summarize(
      { llm, diff: diffPort, sessionStore: store },
      { ref: ref(), perspective: perspective() },
    );
    expect(capture.starts).toBe(0);
    expect(capture.resumes).toBe(1);
  });
});
