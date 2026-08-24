import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { LoggerPort, PrRef } from '@semantic-diff-tracer/core';
import { nullLogger } from '@semantic-diff-tracer/core';
import {
  commonGitDir,
  fetchRef,
  hasCommit,
  listWorktrees,
  resetHardTo,
  worktreeAdd,
  worktreePrune,
} from './git.js';

const EXCLUDE_MARKER_START = '# BEGIN semantic-diff-tracer (do not edit — managed by the Semantic Diff Tracer VSCode extension)';
const EXCLUDE_MARKER_END = '# END semantic-diff-tracer';
const EXCLUDE_BODY = '.sdt/';

export const SDT_DIR = '.sdt';

export interface EnsureCheckoutOptions {
  /**
   * Directory that identifies the repository. Can be a working tree, a baretree
   * root (bare .git dir), or a subdirectory of either — anything git accepts as
   * `cwd`.
   */
  repoCwd: string;
  /** Optional logger; falls back to nullLogger when omitted. */
  logger?: LoggerPort;
}

export interface EnsureCheckoutResult {
  /**
   * Absolute path of the checked-out worktree. Callers use this as the `cwd`
   * for subsequent diff/blob reads.
   */
  worktreePath: string;
  /** True when a new worktree was created (as opposed to reusing/resetting). */
  created: boolean;
  /** True when an existing worktree was reset to a new SHA. */
  reset: boolean;
  /** True when we did a `git fetch` (not just reused a cached SHA). */
  fetched: boolean;
}

/**
 * Ensure a dedicated read-only worktree exists at `<repoRoot>/.sdt/pr-<n>`
 * pointing at the PR head SHA. Idempotent across `Open PR` invocations — a
 * follow-up call refreshes the worktree to the current SHA (fetching if
 * necessary), useful when the PR gets force-pushed or receives new commits.
 *
 * Also keeps `.git/info/exclude` in sync so `.sdt/` doesn't leak into
 * user-facing status / commits.
 */
export async function ensureCheckout(
  ref: Extract<PrRef, { kind: 'github' }>,
  options: EnsureCheckoutOptions,
): Promise<EnsureCheckoutResult> {
  if (!options.repoCwd) throw new Error('ensureCheckout: repoCwd is required');
  if (!ref.headSha) throw new Error('ensureCheckout: ref.headSha is required');
  if (typeof ref.number !== 'number') {
    throw new Error(`ensureCheckout: ref.number must be a number, got ${typeof ref.number}`);
  }
  const log = options.logger ?? nullLogger;
  const gitCommonDir = await commonGitDir(options.repoCwd);
  const repoRoot = path.dirname(gitCommonDir);
  const worktreeParent = path.join(repoRoot, SDT_DIR);
  const worktreePath = path.join(worktreeParent, `pr-${ref.number}`);
  log.info('checkout', 'ensureCheckout', {
    prNumber: ref.number,
    headSha: ref.headSha.slice(0, 12),
    worktreePath,
    repoRoot,
  });

  await fs.mkdir(worktreeParent, { recursive: true });
  await ensureExcludeEntry(gitCommonDir);

  const fetched = await ensureHeadCommit(ref, options.repoCwd, log);

  const worktrees = await listWorktrees(options.repoCwd);
  const existing = worktrees.find((w) => w.path === worktreePath);

  if (!existing) {
    await log.time('checkout', 'git worktree add', () =>
      worktreeAdd(worktreePath, ref.headSha, options.repoCwd),
    );
    log.info('checkout', 'worktree created', { worktreePath });
    return { worktreePath, created: true, reset: false, fetched };
  }
  if (existing.head === ref.headSha) {
    log.info('checkout', 'worktree already at head sha', { worktreePath });
    return { worktreePath, created: false, reset: false, fetched };
  }
  await log.time('checkout', 'git reset --hard', () => resetHardTo(ref.headSha, worktreePath));
  log.info('checkout', 'worktree reset', {
    worktreePath,
    fromHead: existing.head.slice(0, 12),
    toHead: ref.headSha.slice(0, 12),
  });
  return { worktreePath, created: false, reset: true, fetched };
}

/**
 * Ensures the PR head commit exists locally. First checks if it's already in
 * the object DB; if not, tries `origin`, then the PR's base repo directly
 * (covers cwd's `origin` being unrelated to the PR, and merged PRs whose head
 * branch was deleted — `refs/pull/N/head` on the base repo survives that),
 * and finally the head repo's clone URL (covers fork PRs whose branch is
 * still live) without touching the user's remote list.
 */
async function ensureHeadCommit(
  ref: Extract<PrRef, { kind: 'github' }>,
  cwd: string,
  log: LoggerPort,
): Promise<boolean> {
  if (await hasCommit(ref.headSha, cwd)) {
    log.info('checkout', 'head sha already in object db', {
      headSha: ref.headSha.slice(0, 12),
    });
    return false;
  }
  // Best-effort: try origin's PR ref first (works for same-repo PRs and any
  // origin whose refspec includes `refs/pull/*`).
  const attempts: Array<{ remote: string; refspec: string }> = [
    { remote: 'origin', refspec: `refs/pull/${ref.number}/head` },
  ];
  if (ref.headRef) {
    attempts.push({ remote: 'origin', refspec: ref.headRef });
  }
  attempts.push({
    remote: `https://github.com/${ref.owner}/${ref.repo}.git`,
    refspec: `refs/pull/${ref.number}/head`,
  });
  if (ref.headCloneUrl && ref.headRef) {
    attempts.push({ remote: ref.headCloneUrl, refspec: ref.headRef });
  }
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      await log.time('checkout', `git fetch ${attempt.remote} ${attempt.refspec}`, () =>
        fetchRef(attempt.remote, attempt.refspec, cwd),
      );
      if (await hasCommit(ref.headSha, cwd)) return true;
    } catch (e) {
      log.warn('checkout', 'fetch attempt failed', {
        remote: attempt.remote,
        refspec: attempt.refspec,
        error: (e as Error).message,
      });
      lastError = e;
    }
  }
  throw new Error(
    `Could not fetch PR head SHA ${ref.headSha}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function ensureExcludeEntry(gitCommonDir: string): Promise<void> {
  const infoDir = path.join(gitCommonDir, 'info');
  const excludePath = path.join(infoDir, 'exclude');
  await fs.mkdir(infoDir, { recursive: true });
  let current = '';
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  if (current.includes(EXCLUDE_MARKER_START)) return;
  const trimmed = current.replace(/\s+$/, '');
  const block = `${EXCLUDE_MARKER_START}\n${EXCLUDE_BODY}\n${EXCLUDE_MARKER_END}\n`;
  const next = trimmed.length === 0 ? block : `${trimmed}\n\n${block}`;
  await fs.writeFile(excludePath, next, 'utf8');
}

/**
 * Remove the semantic-diff-tracer managed block from .git/info/exclude, and delete the
 * file if it becomes empty.
 */
export async function removeExcludeEntry(gitCommonDir: string): Promise<void> {
  const excludePath = path.join(gitCommonDir, 'info', 'exclude');
  let current: string;
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  const block = new RegExp(
    `\\n*${escapeRegExp(EXCLUDE_MARKER_START)}[\\s\\S]*?${escapeRegExp(EXCLUDE_MARKER_END)}\\n?`,
    'g',
  );
  const next = current.replace(block, '').replace(/\s+$/, '');
  if (next.trim().length === 0) {
    await fs.rm(excludePath, { force: true });
  } else {
    await fs.writeFile(excludePath, `${next}\n`, 'utf8');
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { worktreePrune };
