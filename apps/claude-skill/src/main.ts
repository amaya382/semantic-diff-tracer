#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrRef } from '@semantic-diff-tracer/core';
import { ensureCheckout, GitDiffAdapter } from '@semantic-diff-tracer/diff-git';
import { buildSkillDeps, resolveInput } from './boot.js';
import { runPipeline } from './pipeline.js';
import { renderReport } from './render/index.js';

interface ParsedArgs {
  input: string;
  outPath?: string;
  noMermaidCdn: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { input: '', noMermaidCdn: false, help: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-o' || a === '--out') {
      const v = argv[++i];
      if (v) out.outPath = v;
    }
    else if (a === '--no-mermaid-cdn') out.noMermaidCdn = true;
    else positional.push(a);
  }
  out.input = positional[0] ?? '';
  return out;
}

function usage(): string {
  return `trace-diff: render a PR as a single self-contained HTML report.

Usage:
  trace-diff <URL | owner/repo#N | #N | branch> [-o out.html] [--no-mermaid-cdn]

Options:
  -o, --out <path>       Output file path (default: ./sdt-report-<slug>.html)
  --no-mermaid-cdn       Skip the Mermaid CDN <script>; visuals stay as source

Environment (same as the TUI):
  SDT_LANGUAGE, SDT_CLAUDE_MODEL, SDT_CLAUDE_EXECUTABLE, SDT_FLOW_MAX_TURNS,
  GITHUB_TOKEN / GH_TOKEN
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (!args.input) {
    process.stderr.write(usage());
    process.exit(1);
  }
  const cwd = process.cwd();
  const globalStorage = path.join(os.homedir(), '.config', 'semantic-diff-tracer');
  await fs.mkdir(globalStorage, { recursive: true });
  const deps = buildSkillDeps({ cwd, globalStorage });
  const ref = await resolveInput(args.input, deps, cwd);
  if (!ref) {
    console.error(`trace-diff: could not resolve "${args.input}"`);
    process.exit(1);
  }
  if (ref.kind === 'github') {
    const checkout = await ensureCheckout(ref, { repoCwd: cwd, logger: deps.logger });
    deps.diff = new GitDiffAdapter({ cwd: checkout.worktreePath });
  }
  const result = await runPipeline(deps, ref);
  const html = renderReport({
    meta: result.meta,
    perspectives: result.perspectives,
    bundles: result.bundles,
    generatedAt: new Date(),
    language: deps.language,
    includeMermaidCdn: !args.noMermaidCdn,
  });
  const outPath = args.outPath ?? defaultOutPath(cwd, ref);
  await fs.writeFile(outPath, html, 'utf8');
  process.stdout.write(`${path.resolve(outPath)}\n`);
}

function defaultOutPath(cwd: string, ref: PrRef): string {
  const slug =
    ref.kind === 'github'
      ? `${ref.owner}-${ref.repo}-${ref.number}`
      : `${ref.baseRef.replace(/\//g, '-')}..${ref.headRef.replace(/\//g, '-')}`;
  return path.join(cwd, `sdt-report-${slug}.html`);
}

const invokedDirectly = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;
if (invokedDirectly) {
  void main().catch((err) => {
    console.error(`trace-diff: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}

export { main };
