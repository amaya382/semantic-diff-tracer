import { accessSync, constants, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Absolute path to the `claude` CLI the Claude Agent SDK spawns.
 *
 * The SDK's own default resolves `cli.js` relative to `import.meta.url`,
 * which points at the bundled SDK — a CLI that doesn't apply the caller's
 * `~/.claude/settings.json` `env` block (e.g. Vertex/Bedrock auth), so it
 * falls back to plain API-key auth and fails. Callers must always pass an
 * explicit path. `configured` is a caller-supplied override and wins
 * unconditionally.
 */
export function resolveClaudeExecutable(configured: string | undefined): string | undefined {
  const explicit = configured?.trim();
  if (explicit) return explicit;
  return searchPath() ?? wellKnownInstallPaths().find(isExecutableFile);
}

function searchPath(): string | undefined {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of executableNames()) {
      const candidate = path.resolve(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function executableNames(): string[] {
  return process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
}

/**
 * Probed after PATH: a GUI-launched process (macOS Dock, Windows shortcut)
 * inherits the login shell's PATH only when the shell exported it, so the
 * standard installer targets are checked directly.
 */
function wellKnownInstallPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.bun', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
