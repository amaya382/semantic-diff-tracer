#!/usr/bin/env node
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureCheckout, GitDiffAdapter } from '@semantic-diff-tracer/diff-git';
import { runPerspectiveScreen } from './screens/perspective-screen.js';
import { runSummaryScreen } from './screens/summary-screen.js';
import { runTraceScreen } from './screens/trace-screen.js';
import { buildTuiDeps, resolveInput } from './boot.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }
  const cwd = process.cwd();
  const globalStorage = path.join(os.homedir(), '.config', 'semantic-diff-tracer');
  const deps = buildTuiDeps({ cwd, globalStorage });
  const ref = await resolveInput(args[0]!, deps, cwd);
  if (!ref) {
    console.error(`semantic-diff-tracer: could not resolve "${args[0]}"`);
    process.exit(1);
  }
  if (ref.kind === 'github') {
    const checkout = await ensureCheckout(ref, { repoCwd: cwd, logger: deps.logger });
    deps.diff = new GitDiffAdapter({ cwd: checkout.worktreePath });
  }
  const perspective = await runPerspectiveScreen(deps, ref);
  if (!perspective) return;
  const nextScreen = await runSummaryScreen(deps, ref, perspective);
  if (nextScreen === 'trace') {
    await runTraceScreen(deps, ref, perspective);
  }
}

function printHelp(): void {
  console.log(`semantic-diff-tracer TUI

Usage:
  semantic-diff-tracer <URL | owner/repo#N | #N | branch>

Environment:
  SDT_LANGUAGE          Free-form language hint appended to every LLM prompt (default: en)
  SDT_CLAUDE_MODEL      sonnet | opus | haiku | inherit | <full-id> (default: SDK default)
  SDT_CLAUDE_EXECUTABLE Absolute path to the claude CLI (default: resolved from PATH)
`);
}

// Only run when invoked directly, not when imported.
const invokedDirectly = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;
if (invokedDirectly) {
  void main();
}
