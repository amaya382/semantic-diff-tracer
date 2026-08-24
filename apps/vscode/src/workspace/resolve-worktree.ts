import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runGit } from '@semantic-diff-tracer/diff-git';

/**
 * VSCode is happiest when opened on a git working tree, but baretree stores the
 * bare repo at the folder VSCode wants to open (e.g. `~/baretree/github.com/user/repo/`)
 * and puts the actual working trees one level down (`main/`, `feature/xxx/`).
 *
 * This module classifies the folder VSCode opened and — for a baretree root — picks
 * the working tree the reviewer wants to target.
 */

export type Classification =
  | { kind: 'working-tree'; root: string }
  | { kind: 'baretree'; root: string; worktrees: BaretreeWorktree[] }
  | { kind: 'not-git'; root: string; reason: string };

export interface BaretreeWorktree {
  path: string;
  branch: string;
  headSha: string;
}

interface FsLike {
  isFile: (p: string) => Promise<boolean>;
  readFile: (p: string) => Promise<string>;
}

interface GitLike {
  configBare: (cwd: string) => Promise<boolean | null>;
  worktreeList: (cwd: string) => Promise<BaretreeWorktree[]>;
  showToplevel: (cwd: string) => Promise<string | null>;
}

const realFs: FsLike = {
  async isFile(p) {
    try {
      const st = await fs.stat(p);
      return st.isFile();
    } catch {
      return false;
    }
  },
  async readFile(p) {
    return fs.readFile(p, 'utf8');
  },
};

const realGit: GitLike = {
  async configBare(cwd) {
    try {
      const out = await runGit(['config', '--bool', 'core.bare'], { cwd });
      const s = out.trim();
      if (s === 'true') return true;
      if (s === 'false') return false;
      return null;
    } catch {
      return null;
    }
  },
  async worktreeList(cwd) {
    const out = await runGit(['worktree', 'list', '--porcelain'], { cwd });
    return parseWorktreeList(out);
  },
  async showToplevel(cwd) {
    try {
      const out = await runGit(['rev-parse', '--show-toplevel'], { cwd });
      return out.trim() || null;
    } catch {
      return null;
    }
  },
};

export function parseWorktreeList(text: string): BaretreeWorktree[] {
  interface Draft {
    path?: string;
    branch?: string;
    headSha?: string;
    isBare?: boolean;
  }
  const trees: BaretreeWorktree[] = [];
  let current: Draft = {};
  const flush = () => {
    if (current.path && !current.isBare) {
      trees.push({
        path: current.path,
        branch: current.branch ?? '(detached)',
        headSha: current.headSha ?? '',
      });
    }
    current = {};
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current.path = line.slice('worktree '.length).trim();
    } else if (line.startsWith('HEAD ')) {
      current.headSha = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch refs/heads/'.length).trim();
    } else if (line === 'bare') {
      current.isBare = true;
    }
  }
  flush();
  return trees;
}

export async function classifyFolder(
  root: string,
  deps: { fs?: FsLike; git?: GitLike } = {},
): Promise<Classification> {
  const fsDep = deps.fs ?? realFs;
  const gitDep = deps.git ?? realGit;

  const gitEntry = path.join(root, '.git');
  const gitIsFile = await fsDep.isFile(gitEntry);
  if (gitIsFile) {
    // gitfile → worktree owned by a bare repo elsewhere. Treat as working tree.
    return { kind: 'working-tree', root };
  }

  // Either root is not a git anything, or it's a directory .git (regular or bare).
  const bare = await gitDep.configBare(root);
  if (bare === null) {
    return { kind: 'not-git', root, reason: 'No git repository at this folder.' };
  }
  if (bare === true) {
    const worktrees = await gitDep.worktreeList(root);
    return { kind: 'baretree', root, worktrees };
  }
  // core.bare === false → normal working tree. Confirm via rev-parse for safety.
  const top = await gitDep.showToplevel(root);
  if (!top) return { kind: 'not-git', root, reason: 'git rev-parse failed.' };
  return { kind: 'working-tree', root: top };
}
