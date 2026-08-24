import type { PrRef } from '../domain/pr-ref.js';
import type { UnifiedDiff } from '../domain/diff.js';

export interface DiffPort {
  getDiff(ref: PrRef): Promise<UnifiedDiff>;
  readFileAtSha(sha: string, path: string): Promise<string | null>;
}
