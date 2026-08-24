import { describe, it, expect } from 'vitest';
import { classifyFolder, parseWorktreeList } from './resolve-worktree.js';

describe('parseWorktreeList', () => {
  it('parses porcelain output with multiple worktrees', () => {
    const out = `worktree /repo/main
HEAD abc123
branch refs/heads/main

worktree /repo/feature/auth
HEAD def456
branch refs/heads/feature/auth
`;
    const trees = parseWorktreeList(out);
    expect(trees).toHaveLength(2);
    expect(trees[0]).toEqual({ path: '/repo/main', branch: 'main', headSha: 'abc123' });
    expect(trees[1]).toEqual({ path: '/repo/feature/auth', branch: 'feature/auth', headSha: 'def456' });
  });

  it('drops the bare entry itself', () => {
    const out = `worktree /repo
HEAD 000000
bare

worktree /repo/main
HEAD abc123
branch refs/heads/main
`;
    const trees = parseWorktreeList(out);
    expect(trees).toHaveLength(1);
    expect(trees[0]!.path).toBe('/repo/main');
  });
});

describe('classifyFolder', () => {
  it('treats a gitfile at .git as a working tree', async () => {
    const res = await classifyFolder('/repo/main', {
      fs: {
        async isFile(p) {
          return p === '/repo/main/.git';
        },
        async readFile() {
          return '';
        },
      },
      git: {
        async configBare() {
          return false;
        },
        async worktreeList() {
          return [];
        },
        async showToplevel() {
          return '/repo/main';
        },
      },
    });
    expect(res.kind).toBe('working-tree');
    if (res.kind === 'working-tree') expect(res.root).toBe('/repo/main');
  });

  it('recognises a baretree root and lists worktrees', async () => {
    const res = await classifyFolder('/repo', {
      fs: {
        async isFile() {
          return false; // .git is a directory (bare) here
        },
        async readFile() {
          return '';
        },
      },
      git: {
        async configBare(cwd) {
          expect(cwd).toBe('/repo');
          return true;
        },
        async worktreeList() {
          return [
            { path: '/repo/main', branch: 'main', headSha: 'abc' },
            { path: '/repo/feature/auth', branch: 'feature/auth', headSha: 'def' },
          ];
        },
        async showToplevel() {
          return null;
        },
      },
    });
    expect(res.kind).toBe('baretree');
    if (res.kind === 'baretree') expect(res.worktrees).toHaveLength(2);
  });

  it('returns not-git when neither a gitfile nor a repo is present', async () => {
    const res = await classifyFolder('/plain', {
      fs: {
        async isFile() {
          return false;
        },
        async readFile() {
          return '';
        },
      },
      git: {
        async configBare() {
          return null;
        },
        async worktreeList() {
          return [];
        },
        async showToplevel() {
          return null;
        },
      },
    });
    expect(res.kind).toBe('not-git');
  });

  it('follows show-toplevel for a normal working tree without a gitfile', async () => {
    const res = await classifyFolder('/repo/sub', {
      fs: {
        async isFile() {
          return false;
        },
        async readFile() {
          return '';
        },
      },
      git: {
        async configBare() {
          return false;
        },
        async worktreeList() {
          return [];
        },
        async showToplevel() {
          return '/repo';
        },
      },
    });
    expect(res.kind).toBe('working-tree');
    if (res.kind === 'working-tree') expect(res.root).toBe('/repo');
  });
});
