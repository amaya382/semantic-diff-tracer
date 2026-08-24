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

export interface HunkRef {
  file: string;
  hunkIndex: number;
}
