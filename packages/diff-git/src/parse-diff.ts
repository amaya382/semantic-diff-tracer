import type { FileDiff, Hunk, UnifiedDiff } from '@semantic-diff-tracer/core';

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(text: string, baseSha: string, headSha: string): UnifiedDiff {
  const lines = text.split('\n');
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let currentHunk: Hunk | null = null;
  let renameFrom: string | null = null;

  const finalizeHunk = () => {
    if (current && currentHunk) {
      current.hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  const finalizeFile = () => {
    finalizeHunk();
    if (current) files.push(current);
    current = null;
    renameFrom = null;
  };

  for (const line of lines) {
    const headerMatch = line.match(FILE_HEADER);
    if (headerMatch) {
      finalizeFile();
      const [, oldPath, newPath] = headerMatch;
      current = {
        path: newPath!,
        oldPath: oldPath === newPath ? undefined as unknown as string : oldPath!,
        status: 'modified',
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      if (oldPath === newPath) delete (current as { oldPath?: string }).oldPath;
      continue;
    }

    if (!current) continue;

    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'removed';
    else if (line.startsWith('rename from ')) {
      renameFrom = line.slice('rename from '.length);
      current.status = 'renamed';
    } else if (line.startsWith('rename to ')) {
      if (renameFrom) current.oldPath = renameFrom;
    }

    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch) {
      finalizeHunk();
      const [, oldStart, oldLines, newStart, newLines, header] = hunkMatch;
      currentHunk = {
        oldStart: Number(oldStart),
        oldLines: oldLines ? Number(oldLines) : 1,
        newStart: Number(newStart),
        newLines: newLines ? Number(newLines) : 1,
        header: (header ?? '').trim(),
        body: '',
      };
      continue;
    }

    if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.body += (currentHunk.body ? '\n' : '') + line;
      if (line.startsWith('+') && !line.startsWith('+++')) current.additions++;
      if (line.startsWith('-') && !line.startsWith('---')) current.deletions++;
    }
  }
  finalizeFile();

  return { baseSha, headSha, files };
}
