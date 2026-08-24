import type { FileDiff, Hunk, UnifiedDiff } from '../domain/diff.js';

export type ChangeKind = 'added' | 'removed' | 'modified' | 'unchanged' | 'unknown';

export interface ChangeSummary {
  kind: ChangeKind;
  /** New-file lines within the queried range that this PR adds. */
  additions: number;
  /** Old-file lines that this PR removes near the queried range (mapped to the new-file line). */
  deletions: number;
}

/**
 * Classify what kind of change the PR makes inside `file`:`startLine..endLine`
 * against the base. Used to badge Flow blocks so a reviewer can see at a glance
 * whether they're looking at freshly-added code, a modification of existing
 * code, a pure deletion site, or unchanged context.
 *
 * Line numbers are in the new file (post-merge) — the same numbers Flow blocks
 * use. Unknown means we don't have diff info for the file (renamed, missing).
 */
export function summariseChange(
  diff: UnifiedDiff,
  file: string,
  startLine: number,
  endLine: number,
): ChangeSummary {
  const fd = diff.files.find((f) => f.path === file);
  if (!fd) return { kind: 'unknown', additions: 0, deletions: 0 };
  if (fd.status === 'added') return { kind: 'added', additions: fd.additions, deletions: 0 };
  if (fd.status === 'removed') return { kind: 'removed', additions: 0, deletions: fd.deletions };
  return countInRange(fd, startLine, endLine);
}

function countInRange(fd: FileDiff, startLine: number, endLine: number): ChangeSummary {
  let additions = 0;
  let deletions = 0;
  for (const hunk of fd.hunks) {
    const overlap = hunkOverlap(hunk, startLine, endLine);
    additions += overlap.additions;
    deletions += overlap.deletions;
  }
  const kind: ChangeKind =
    additions > 0 && deletions > 0
      ? 'modified'
      : additions > 0
        ? 'added'
        : deletions > 0
          ? 'removed'
          : 'unchanged';
  return { kind, additions, deletions };
}

/**
 * Walk one hunk line-by-line and count +/- lines that fall inside the range.
 * `-` lines don't consume a new-file line; we attribute them to the current
 * new-file cursor (they're “removals landing at that spot”). `+` lines are
 * only counted while the cursor is inside the range.
 */
/**
 * Best-effort mapping of a new-side line range `[newStart..newEnd]` back to
 * the old-side (base) file's line range. Used when we want to show the
 * Before pane of a Flow block whose `beforeFocus` wasn't provided by the LLM.
 *
 * Rules:
 *   - Outside any hunk: old_line = new_line - accumulated_shift (where
 *     shift = additions_before - deletions_before across preceding hunks).
 *   - Inside a hunk: the mapping is fuzzy. We snap `newStart` to the hunk's
 *     `oldStart` and `newEnd` to `oldStart + oldLines - 1`, so the whole
 *     modified block on the old side is shown.
 * Returns `undefined` when the file is `added` (there is no base side to map
 * to). Callers should treat `undefined` as "no Before available".
 */
export function mapNewToOldRange(
  fd: FileDiff,
  newStart: number,
  newEnd: number,
): { file: string; startLine: number; endLine: number } | undefined {
  if (fd.status === 'added') return undefined;
  const file = fd.oldPath ?? fd.path;
  const oldStart = mapNewLineToOld(fd, newStart);
  const oldEnd = mapNewLineToOld(fd, newEnd);
  return { file, startLine: oldStart, endLine: Math.max(oldStart, oldEnd) };
}

function mapNewLineToOld(fd: FileDiff, newLine: number): number {
  let old = newLine;
  for (const h of fd.hunks) {
    // Hunk hasn't been reached yet — mapping is line-for-line so far.
    if (newLine < h.newStart) return old;
    const newHunkEnd = h.newStart + Math.max(0, h.newLines) - 1;
    if (newLine <= newHunkEnd) {
      // Inside the modified region: snap to the old-side start of this hunk.
      // Not exact, but keeps the Before pane pointing at the right neighbourhood.
      const relative = newLine - h.newStart;
      const oldHunkLen = Math.max(0, h.oldLines);
      const clamped = Math.min(relative, Math.max(0, oldHunkLen - 1));
      return h.oldStart + clamped;
    }
    // Past this hunk: apply its net shift and keep walking.
    old = newLine - (h.newStart - h.oldStart) - (h.newLines - h.oldLines);
  }
  return Math.max(1, old);
}

function hunkOverlap(
  hunk: Hunk,
  startLine: number,
  endLine: number,
): { additions: number; deletions: number } {
  // Fast-reject: the hunk is entirely outside the range.
  const hunkEnd = hunk.newStart + Math.max(0, hunk.newLines) - 1;
  if (hunkEnd < startLine || hunk.newStart > endLine) {
    return { additions: 0, deletions: 0 };
  }
  let cursor = hunk.newStart;
  let additions = 0;
  let deletions = 0;
  const lines = hunk.body.split('\n');
  for (const raw of lines) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    const head = raw.charAt(0);
    if (head === '+') {
      if (cursor >= startLine && cursor <= endLine) additions++;
      cursor++;
    } else if (head === '-') {
      // Deletion doesn't advance the new-file cursor; charge it to the current
      // cursor position (or the last line inside range if we've stepped past).
      const attributeTo = Math.min(cursor, endLine);
      if (attributeTo >= startLine && attributeTo <= endLine) deletions++;
    } else {
      // context line (' ' or empty)
      cursor++;
    }
  }
  return { additions, deletions };
}
