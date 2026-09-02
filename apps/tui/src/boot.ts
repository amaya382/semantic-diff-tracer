import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type {
  DiffPort,
  LlmProvider,
  LoggerPort,
  PrPort,
  PrRef,
  SessionStorePort,
  TraceDepth,
} from '@semantic-diff-tracer/core';
import { parseTraceDepth } from '@semantic-diff-tracer/core';
import { GitDiffAdapter, resolveLocalRef } from '@semantic-diff-tracer/diff-git';
import {
  OctokitPrAdapter,
  parseGithubPrUrl,
  parseNumberOnly,
  parseOwnerRepoNumber,
  parseRemoteUrl,
} from '@semantic-diff-tracer/github-octokit';
import {
  ClaudeLlmProvider,
  clampFlowMaxTurns,
  formatUsageForLog,
  resolveClaudeExecutable,
} from '@semantic-diff-tracer/llm-claude';
import { FileSessionStore } from '@semantic-diff-tracer/session-store-fs';
import { runGit } from '@semantic-diff-tracer/diff-git';

export interface TuiDeps {
  cwd: string;
  llm: LlmProvider;
  diff: DiffPort;
  sessionStore: SessionStorePort;
  logger: LoggerPort;
  pr: PrPort;
  language: string;
  flowMaxTurns: number;
  /** Default trace depth used before the user toggles it in the perspective screen. */
  traceDepth: TraceDepth;
}

export interface BuildOptions {
  cwd: string;
  globalStorage: string;
}

export function buildTuiDeps(opts: BuildOptions): TuiDeps {
  const language = (process.env['SDT_LANGUAGE'] ?? 'en').trim() || 'en';
  const model = process.env['SDT_CLAUDE_MODEL']
    ? { model: process.env['SDT_CLAUDE_MODEL'] }
    : {};
  const claudeExecutable = resolveClaudeExecutable(process.env['SDT_CLAUDE_EXECUTABLE']);
  const llm = new ClaudeLlmProvider({
    cwd: opts.cwd,
    ...(claudeExecutable ? { pathToClaudeCodeExecutable: claudeExecutable } : {}),
    ...model,
    onStderr: (chunk) => console.error(`[warn] llm: claude stderr ${chunk.trim()}`),
    onUsage: (usage) => {
      console.error(`[info] llm: tokens ${JSON.stringify(formatUsageForLog(usage))}`);
    },
  });
  const diff = new GitDiffAdapter({ cwd: opts.cwd });
  const sessionStore = new FileSessionStore({
    filePath: path.join(opts.globalStorage, 'sessions.json'),
  });
  const token = resolveGithubToken();
  const pr = new OctokitPrAdapter({ token });
  const logger: LoggerPort = {
    info: (scope, msg, data) =>
      console.error(`[info] ${scope}: ${msg}${data ? ' ' + JSON.stringify(data) : ''}`),
    warn: (scope, msg) => console.error(`[warn] ${scope}: ${msg}`),
    error: (scope, msg) => console.error(`[error] ${scope}: ${msg}`),
    async time(_scope, _msg, task) {
      return task();
    },
  };
  const flowMaxTurns = clampFlowMaxTurns(process.env['SDT_FLOW_MAX_TURNS']);
  const traceDepth = parseTraceDepth(process.env['SDT_TRACE_DEPTH']);
  return { cwd: opts.cwd, llm, diff, sessionStore, logger, pr, language, flowMaxTurns, traceDepth };
}

// Falls back to `gh auth token` so a logged-in gh CLI works without exporting
// GITHUB_TOKEN/GH_TOKEN; otherwise requests to private repos 404 as unauthenticated.
function resolveGithubToken(): string {
  const envToken = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (envToken) return envToken;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export async function resolveInput(input: string, deps: TuiDeps, cwd: string): Promise<PrRef | undefined> {
  const url = parseGithubPrUrl(input);
  if (url) return deps.pr.resolve({ kind: 'number', ...url });
  const or = parseOwnerRepoNumber(input);
  if (or) return deps.pr.resolve({ kind: 'number', ...or });
  const defaultRepo = await inferDefaultRepo(cwd);
  const num = parseNumberOnly(input, defaultRepo);
  if (num) return deps.pr.resolve({ kind: 'number', ...num });
  // Fall back to local branch review.
  const base = process.env['SDT_BASE'] ?? 'main';
  try {
    return await resolveLocalRef({ cwd, base, head: input });
  } catch {
    return undefined;
  }
}

async function inferDefaultRepo(cwd: string): Promise<{ owner: string; repo: string } | undefined> {
  try {
    const raw = await runGit(['remote', 'get-url', 'origin'], { cwd });
    return parseRemoteUrl(raw.trim()) ?? undefined;
  } catch {
    return undefined;
  }
}
