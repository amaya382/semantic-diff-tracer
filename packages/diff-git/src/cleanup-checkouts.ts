import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { commonGitDir, listWorktrees, worktreeRemove } from './git.js';
import { SDT_DIR, removeExcludeEntry } from './ensure-checkout.js';

export interface CheckoutEntry {
  worktreePath: string;
  prNumber: number;
  head: string;
}

/**
 * List every worktree under `<repoRoot>/.sdt/` that semantic-diff-tracer created,
 * along with the PR number embedded in the path.
 */
export async function listSdtCheckouts(repoCwd: string): Promise<CheckoutEntry[]> {
  const gitCommonDir = await commonGitDir(repoCwd);
  const repoRoot = path.dirname(gitCommonDir);
  const prefix = path.join(repoRoot, SDT_DIR) + path.sep;
  const worktrees = await listWorktrees(repoCwd);
  const entries: CheckoutEntry[] = [];
  for (const w of worktrees) {
    if (!w.path.startsWith(prefix)) continue;
    const leaf = path.basename(w.path);
    const match = leaf.match(/^pr-(\d+)$/);
    if (!match) continue;
    entries.push({ worktreePath: w.path, prNumber: Number(match[1]!), head: w.head });
  }
  return entries;
}

export interface CleanupResult {
  removed: string[];
  failed: Array<{ path: string; error: string }>;
  excludeRemoved: boolean;
}

/**
 * Remove the given worktree paths and, if the .sdt directory becomes
 * empty, strip the exclude entry too. Never touches worktrees outside
 * `.sdt/`.
 */
export async function cleanupCheckouts(
  repoCwd: string,
  worktreePaths: string[],
): Promise<CleanupResult> {
  const gitCommonDir = await commonGitDir(repoCwd);
  const repoRoot = path.dirname(gitCommonDir);
  const sdtRoot = path.join(repoRoot, SDT_DIR);

  const removed: string[] = [];
  const failed: CleanupResult['failed'] = [];
  for (const p of worktreePaths) {
    if (!p.startsWith(sdtRoot + path.sep)) {
      failed.push({ path: p, error: 'refusing to remove worktree outside .sdt/' });
      continue;
    }
    try {
      await worktreeRemove(p, repoCwd, { force: true });
      removed.push(p);
    } catch (e) {
      failed.push({ path: p, error: (e as Error).message });
    }
  }

  let excludeRemoved = false;
  const remaining = await listSdtCheckouts(repoCwd);
  if (remaining.length === 0) {
    // Best-effort: remove the (now-empty) .sdt/ dir and the exclude block.
    try {
      await fs.rm(sdtRoot, { recursive: true, force: true });
    } catch {
      // leave the dir if some non-worktree file remains inside
    }
    await removeExcludeEntry(gitCommonDir);
    excludeRemoved = true;
  }

  return { removed, failed, excludeRemoved };
}
