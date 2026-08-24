import type { DiffPort, PrRef, UnifiedDiff } from '@semantic-diff-tracer/core';

export interface StubDiffOptions {
  diff: UnifiedDiff;
  /** file path → source content at head SHA. */
  filesAtHead?: Record<string, string>;
}

export class StubDiffPort implements DiffPort {
  constructor(private readonly options: StubDiffOptions) {}

  async getDiff(_ref: PrRef): Promise<UnifiedDiff> {
    return this.options.diff;
  }

  async readFileAtSha(_sha: string, path: string): Promise<string | null> {
    return this.options.filesAtHead?.[path] ?? null;
  }
}
