export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  body: string;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  hunks: Hunk[];
}

export interface UnifiedDiff {
  baseSha: string;
  headSha: string;
  files: FileDiff[];
}

/**
 * How a hunk relates to the perspective that owns it. `primary` is the change
 * the reviewer opened this perspective to read; `peripheral` is a supporting
 * hunk (comment tweak, adjacent format, follow-up rename) that belongs to the
 * same idea but does not carry it. Absent = primary — the LLM only needs to
 * mark the peripheral ones.
 */
export type HunkRole = 'primary' | 'peripheral';

export interface HunkRef {
  file: string;
  hunkIndex: number;
  role?: HunkRole;
}
