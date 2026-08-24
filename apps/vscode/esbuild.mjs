import { build } from 'esbuild';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

await rm('dist', { recursive: true, force: true });

// Extension host bundle. VSCode expects CJS; drop a nested package.json with
// `"type": "commonjs"` next to the bundle so Node parses dist/extension.js as
// CJS despite the app package declaring `"type": "module"`. A `.cjs` extension
// would work too, but vsce's LaunchEntryPointProcessor appends `.js` to any
// `main` that doesn't already end in `.js`, and would then look for a
// non-existent `dist/extension.cjs.js`.
//
// Everything except `vscode` must be bundled: `vsce package --no-dependencies`
// ships no node_modules, and vsce excludes `node_modules/**` at the glob level
// so no .vscodeignore negation can bring a package back. A `require()` left in
// the bundle therefore throws MODULE_NOT_FOUND before `activate` runs.
//
// The Claude Agent SDK reads `import.meta.url` to locate the `claude` CLI it
// spawns. That lookup is dead once bundled, so the extension always passes an
// explicit `pathToClaudeCodeExecutable` (see src/llm/claude-executable.ts);
// the define below only keeps the expression valid in CJS output.
await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: {
    js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  sourcemap: true,
  logLevel: 'info',
});

await writeFile('dist/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

// Perspective panel webview bundle — one bundle drives both Summary and
// Trace tabs. ESM + splitting so mermaid — dynamic-imported by
// buildVisualCard only when the LLM emits a diagram — lives in its own
// chunk. A single IIFE bundle would run mermaid's top-level setup on every
// panel open and, if it threw under the strict webview CSP, would blank the
// whole panel before the bootstrap try/catch could paint anything.
await build({
  entryPoints: ['src/webview-ui/perspective.ts'],
  bundle: true,
  outdir: 'dist/webview-ui/perspective',
  entryNames: 'main',
  chunkNames: 'chunks/[name]-[hash]',
  platform: 'browser',
  format: 'esm',
  splitting: true,
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
});

// Side panel webview bundle.
await build({
  entryPoints: ['src/webview-ui/side.ts'],
  bundle: true,
  outfile: 'dist/webview-ui/side.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
});

// Copy @vscode/codicons CSS + font next to the perspective webview bundle so
// the panel can use `<i class="codicon codicon-*">` — the icon slot the
// focal chips, focal card, and CodeView gutter marker all render through.
// The CSS references `codicon.ttf` by relative path, so they must land in the
// same directory.
const require = createRequire(import.meta.url);
const codiconRoot = dirname(require.resolve('@vscode/codicons/package.json'));
const codiconOutDir = 'dist/webview-ui/perspective/codicons';
await mkdir(codiconOutDir, { recursive: true });
await copyFile(join(codiconRoot, 'dist/codicon.css'), join(codiconOutDir, 'codicon.css'));
await copyFile(join(codiconRoot, 'dist/codicon.ttf'), join(codiconOutDir, 'codicon.ttf'));
