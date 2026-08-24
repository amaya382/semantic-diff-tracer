import { build } from 'esbuild';
import { chmod, rm } from 'node:fs/promises';

await rm('dist-bundle', { recursive: true, force: true });

// Single-file ESM bundle shipped via Homebrew. The tap formula symlinks this
// straight into libexec/bin, so it must be self-contained: workspace imports
// resolved statically, no runtime lookups into node_modules.
//
// `import.meta.url` is preserved as-is (esbuild's default for ESM output) so
// main.ts's invokedDirectly check keeps working. The Claude Agent SDK also
// reads import.meta.url to locate its CLI, but the TUI always passes an
// explicit `pathToClaudeCodeExecutable` via resolveClaudeExecutable, so the
// SDK's own lookup is never exercised.
//
// The shebang comes from main.ts itself; esbuild preserves it at the top of
// the bundle. No banner needed — adding one produces a duplicate `#!` that
// the Node ESM loader rejects as a syntax error on the second line.
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist-bundle/semantic-diff-tracer.mjs',
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});

await chmod('dist-bundle/semantic-diff-tracer.mjs', 0o755);
