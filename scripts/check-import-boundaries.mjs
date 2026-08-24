#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

const RULES = [
  {
    label: 'packages/core must not import vscode',
    dir: 'packages/core/src',
    forbidden: [/from\s+['"]vscode['"]/, /require\(['"]vscode['"]\)/],
  },
  {
    label: 'packages/core must not import ink',
    dir: 'packages/core/src',
    forbidden: [/from\s+['"]ink['"]/, /require\(['"]ink['"]\)/],
  },
  {
    label: 'packages/* must not depend on apps/*',
    dir: 'packages',
    forbidden: [/from\s+['"](?:@semantic-diff-tracer\/(?:vscode|tui)|.*apps\/(?:vscode|tui))['"]/],
  },
  {
    label: 'apps/tui must not import vscode',
    dir: 'apps/tui/src',
    forbidden: [/from\s+['"]vscode['"]/, /require\(['"]vscode['"]\)/],
  },
  {
    label: 'apps/vscode must not import ink',
    dir: 'apps/vscode/src',
    forbidden: [/from\s+['"]ink['"]/, /require\(['"]ink['"]\)/],
  },
];

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'out') continue;
      out.push(...(await walk(full)));
    } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx') || e.name.endsWith('.mts')) {
      out.push(full);
    }
  }
  return out;
}

let failures = 0;
for (const rule of RULES) {
  const files = await walk(join(REPO_ROOT, rule.dir));
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const re of rule.forbidden) {
      if (re.test(src)) {
        console.error(`[boundary] ${rule.label}\n  file: ${f}\n  match: ${re}`);
        failures++;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} import-boundary violation(s) found.`);
  process.exit(1);
}
console.log('Import boundaries OK.');
