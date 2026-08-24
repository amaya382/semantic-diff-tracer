import type { DiffPort, PrRef, UnifiedDiff } from '@semantic-diff-tracer/core';
import { diffRange, showBlob } from './git.js';
import { parseUnifiedDiff } from './parse-diff.js';

export interface GitDiffAdapterOptions {
  cwd: string;
}

export class GitDiffAdapter implements DiffPort {
  constructor(private readonly options: GitDiffAdapterOptions) {}

  async getDiff(ref: PrRef): Promise<UnifiedDiff> {
    const raw = await diffRange(ref.baseSha, ref.headSha, this.options.cwd);
    return parseUnifiedDiff(raw, ref.baseSha, ref.headSha);
  }

  async readFileAtSha(sha: string, path: string): Promise<string | null> {
    return showBlob(sha, path, this.options.cwd);
  }
}
