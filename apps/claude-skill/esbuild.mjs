import { build } from 'esbuild';
import { chmod, mkdir, rm } from 'node:fs/promises';

const OUT_DIR = '../../skills/trace-diff/bin';
const OUT_FILE = `${OUT_DIR}/render.mjs`;

// Single-file ESM bundle shipped inside `skills/trace-diff/`. The skills
// directory is what `npx skills add amaya382/semantic-diff-tracer` copies (or
// symlinks) into the user's `~/.claude/skills/trace-diff/`, so the bundle
// must be self-contained: no lookups into node_modules at runtime.
//
// Same pattern the TUI's dist-bundle uses. Notes carried over:
//   - `import.meta.url` is preserved so main.ts's invokedDirectly check keeps
//     working after bundling.
//   - The Claude Agent SDK reads `import.meta.url` to locate its own CLI, but
//     the skill always passes an explicit `pathToClaudeCodeExecutable` via
//     `resolveClaudeExecutable`, so the SDK's default lookup is never taken.
//   - The shebang comes from main.ts and esbuild preserves it at the top; no
//     banner needed, which would produce a duplicate `#!` and a syntax error.

await rm(OUT_FILE, { force: true });
await mkdir(OUT_DIR, { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: OUT_FILE,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
});
await chmod(OUT_FILE, 0o755);
