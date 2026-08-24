import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

export interface GitRunOptions {
  cwd: string;
  maxBuffer?: number;
}

export async function runGit(args: string[], options: GitRunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: options.cwd });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let size = 0;
    const limit = options.maxBuffer ?? 32 * 1024 * 1024;

    proc.stdout.on('data', (data: Buffer) => {
      size += data.length;
      if (size > limit) {
        proc.kill('SIGKILL');
        reject(new Error(`git ${args[0]} output exceeded ${limit} bytes`));
        return;
      }
      chunks.push(data);
    });
    proc.stderr.on('data', (data: Buffer) => errChunks.push(data));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`git ${args.join(' ')} exited ${code}: ${Buffer.concat(errChunks).toString('utf8')}`));
    });
  });
}

export async function revParse(revision: string, cwd: string): Promise<string> {
  const out = await runGit(['rev-parse', revision], { cwd });
  return out.trim();
}

export async function mergeBase(a: string, b: string, cwd: string): Promise<string> {
  const out = await runGit(['merge-base', a, b], { cwd });
  return out.trim();
}

export async function diffRange(base: string, head: string, cwd: string): Promise<string> {
  return runGit(['diff', '--no-color', '--no-ext-diff', `${base}...${head}`], { cwd });
}

export async function showBlob(sha: string, path: string, cwd: string): Promise<string | null> {
  try {
    return await runGit(['show', `${sha}:${path}`], { cwd });
  } catch {
    return null;
  }
}

/**
 * Path to the .git directory (or the bare repo itself when in a baretree root).
 * We resolve exclude / worktree paths against this so the same helpers work in
 * both regular and bare repositories.
 */
export async function commonGitDir(cwd: string): Promise<string> {
  const out = await runGit(['rev-parse', '--git-common-dir'], { cwd });
  const raw = out.trim();
  if (!raw) throw new Error(`git rev-parse --git-common-dir returned empty in ${cwd}`);
  return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

/**
 * True if the repo at `cwd` already has `sha` as a resolvable object.
 */
export async function hasCommit(sha: string, cwd: string): Promise<boolean> {
  try {
    await runGit(['cat-file', '-e', `${sha}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a ref by its remote name (or clone URL). Uses the `git fetch <remote> <refspec>`
 * form so branches don't leak into the local branch namespace; the resulting SHA is
 * reachable via FETCH_HEAD or any explicit refspec the caller passes.
 */
export async function fetchRef(
  remoteOrUrl: string,
  refspec: string,
  cwd: string,
): Promise<void> {
  await runGit(['fetch', remoteOrUrl, refspec], { cwd });
}

export async function listWorktrees(cwd: string): Promise<Array<{ path: string; head: string; branch?: string; isBare: boolean }>> {
  const raw = await runGit(['worktree', 'list', '--porcelain'], { cwd });
  const trees: Array<{ path: string; head: string; branch?: string; isBare: boolean }> = [];
  interface Draft { path?: string; head?: string; branch?: string; isBare?: boolean }
  let cur: Draft = {};
  const flush = () => {
    if (cur.path) {
      const entry: { path: string; head: string; branch?: string; isBare: boolean } = {
        path: cur.path,
        head: cur.head ?? '',
        isBare: cur.isBare === true,
      };
      if (cur.branch) entry.branch = cur.branch;
      trees.push(entry);
    }
    cur = {};
  };
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      cur.path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch refs/heads/'.length).trim();
    } else if (line === 'bare') {
      cur.isBare = true;
    }
  }
  flush();
  return trees;
}

export async function worktreeAdd(path: string, sha: string, cwd: string): Promise<void> {
  // --detach: no branch is created, HEAD points directly at sha.
  await runGit(['worktree', 'add', '--detach', path, sha], { cwd });
}

export async function worktreeRemove(path: string, cwd: string, options: { force?: boolean } = {}): Promise<void> {
  const args = ['worktree', 'remove'];
  if (options.force) args.push('--force');
  args.push(path);
  await runGit(args, { cwd });
}

export async function resetHardTo(sha: string, cwd: string): Promise<void> {
  await runGit(['reset', '--hard', sha], { cwd });
}

export async function worktreePrune(cwd: string): Promise<void> {
  await runGit(['worktree', 'prune'], { cwd });
}
