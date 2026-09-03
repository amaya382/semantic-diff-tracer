import type { PrRef } from '../domain/pr-ref.js';
import type { PerspectiveDraft } from '../domain/perspective.js';
import type { FileDiff, Hunk, HunkRef, UnifiedDiff } from '../domain/diff.js';
import type { DiffPort } from '../ports/diff.js';

export interface CodeContextOptions {
  /** Byte budget for full-file embeddings. Files beyond this fall back to hunk slices. */
  maxFullFileBytes?: number;
  /** Lines of context on each side of a hunk when slicing. */
  sliceContextLines?: number;
}

export interface CodeContextResult {
  /** Ready-to-embed markdown. Empty string when nothing could be loaded. */
  text: string;
  /** Files whose full content was included. */
  fullFiles: string[];
  /** Files where hunk-anchored slices were used instead. */
  slicedFiles: string[];
  /** Files where only the raw diff hunk body was embedded (traceDepth=normal, or a full/slice read failed). */
  hunkOnlyFiles: string[];
  /** Byte length of `text` — useful for logging. */
  bytes: number;
}

const DEFAULT_MAX_FULL_FILE_BYTES = 24_000;
const DEFAULT_SLICE_CONTEXT_LINES = 40;

/**
 * Preload the source code a summariser/flow-planner needs so it can answer in
 * one shot instead of Read-tool looping. Full file content up to the byte
 * budget; anything past that (or unreadable) falls back to hunk-anchored
 * slices. When even the file read fails, the raw hunk `body` from the diff
 * carries whatever information the model can still get.
 */
export async function buildPerspectiveCodeContext(
  ref: PrRef,
  perspective: PerspectiveDraft,
  diff: UnifiedDiff,
  diffPort: DiffPort,
  opts: CodeContextOptions = {},
): Promise<CodeContextResult> {
  const budget = opts.maxFullFileBytes ?? DEFAULT_MAX_FULL_FILE_BYTES;
  const contextLines = opts.sliceContextLines ?? DEFAULT_SLICE_CONTEXT_LINES;

  // Only preload code for hunks the planner is allowed to build blocks from.
  // Peripheral hunks may be mentioned in narrative when adjacent, but they do
  // not deserve their own file read or slice budget.
  const primaryRefs = perspective.hunkRefs.filter((r) => (r.role ?? 'primary') === 'primary');
  const primaryFiles = uniquePrimaryFiles(primaryRefs);
  const sections: string[] = [];
  const fullFiles: string[] = [];
  const slicedFiles: string[] = [];
  const hunkOnlyFiles: string[] = [];
  let usedBytes = 0;

  for (const path of primaryFiles) {
    const head = await diffPort.readFileAtSha(ref.headSha, path);
    if (head === null) {
      const fallback = buildHunkFallbackSection(path, primaryRefs, diff);
      if (fallback) {
        sections.push(fallback);
        hunkOnlyFiles.push(path);
      }
      continue;
    }

    const byteLen = Buffer.byteLength(head, 'utf8');
    if (usedBytes + byteLen <= budget) {
      sections.push(renderFullFileSection(path, head));
      fullFiles.push(path);
      usedBytes += byteLen;
      continue;
    }

    const sliced = buildSlicedSection(path, head, primaryRefs, diff, contextLines);
    if (sliced) {
      sections.push(sliced);
      slicedFiles.push(path);
    }
  }

  if (sections.length === 0) {
    return { text: '', fullFiles, slicedFiles, hunkOnlyFiles, bytes: 0 };
  }
  const text = `## Code (post-merge)\n\n${sections.join('\n\n')}`;
  return { text, fullFiles, slicedFiles, hunkOnlyFiles, bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Build the traceDepth=normal context: only the diff hunk bodies, no file
 * reads. Callers use this to keep the ask a single-turn / no-tools shot.
 */
export function buildHunkOnlyCodeContext(
  perspective: PerspectiveDraft,
  diff: UnifiedDiff,
): CodeContextResult {
  const primaryRefs = perspective.hunkRefs.filter((r) => (r.role ?? 'primary') === 'primary');
  const primaryFiles = uniquePrimaryFiles(primaryRefs);
  const sections: string[] = [];
  const hunkOnlyFiles: string[] = [];
  for (const path of primaryFiles) {
    const section = buildHunkFallbackSection(path, primaryRefs, diff);
    if (section) {
      sections.push(section);
      hunkOnlyFiles.push(path);
    }
  }
  if (sections.length === 0) {
    return { text: '', fullFiles: [], slicedFiles: [], hunkOnlyFiles, bytes: 0 };
  }
  const text = `## Diff hunks (only source available)\n\n${sections.join('\n\n')}`;
  return {
    text,
    fullFiles: [],
    slicedFiles: [],
    hunkOnlyFiles,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

function uniquePrimaryFiles(refs: readonly HunkRef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    if (!seen.has(r.file)) {
      seen.add(r.file);
      out.push(r.file);
    }
  }
  return out;
}

function renderFullFileSection(path: string, content: string): string {
  const lines = content.split('\n').length;
  const lang = languageForPath(path);
  return `### ${path} (full file, ${lines} lines)\n\`\`\`${lang}\n${content}\n\`\`\``;
}

function buildSlicedSection(
  path: string,
  head: string,
  refs: readonly HunkRef[],
  diff: UnifiedDiff,
  contextLines: number,
): string | null {
  const file = diff.files.find((f) => f.path === path);
  if (!file) return null;
  const hunkIndices = refs.filter((r) => r.file === path).map((r) => r.hunkIndex);
  const parts: string[] = [];
  const lang = languageForPath(path);
  for (const idx of hunkIndices) {
    const hunk = file.hunks[idx];
    if (!hunk) continue;
    const [start, end] = sliceRangeForHunk(hunk, contextLines, head);
    const body = sliceLines(head, start, end);
    parts.push(
      `### ${path} (slice around hunk #${idx}, lines ${start}-${end})\n\`\`\`${lang}\n${body}\n\`\`\``,
    );
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function buildHunkFallbackSection(
  path: string,
  refs: readonly HunkRef[],
  diff: UnifiedDiff,
): string | null {
  const file: FileDiff | undefined = diff.files.find((f) => f.path === path);
  if (!file) return null;
  const hunkIndices = refs.filter((r) => r.file === path).map((r) => r.hunkIndex);
  const parts: string[] = [];
  for (const idx of hunkIndices) {
    const hunk = file.hunks[idx];
    if (!hunk) continue;
    const newEnd = hunk.newLines > 0 ? hunk.newStart + hunk.newLines - 1 : hunk.newStart;
    const gutterWidth = Math.max(
      String(hunk.newStart + Math.max(hunk.newLines, 1) - 1).length,
      String(hunk.oldStart + Math.max(hunk.oldLines, 1) - 1).length,
    );
    const contextLine =
      hunk.header.trim() !== '' ? `_context: ${hunk.header.trim()}_\n` : '';
    const anchor = renderHunkAnchor(hunk);
    const body = renderGutterBody(hunk, gutterWidth);
    parts.push(
      `### ${path} — hunk #${idx}, new lines ${hunk.newStart}-${newEnd} (post-merge line-space)\n${contextLine}\`\`\`diff\n${anchor}\n${body}\n\`\`\``,
    );
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

function renderHunkAnchor(hunk: Hunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

function renderGutterBody(hunk: Hunk, gutterWidth: number): string {
  const pad = (n: number | null): string =>
    n === null ? ' '.repeat(gutterWidth) : String(n).padStart(gutterWidth, ' ');
  const lines = hunk.body === '' ? [] : hunk.body.split('\n');
  let newN = hunk.newStart;
  let oldM = hunk.oldStart;
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith('\\')) {
      out.push(line);
      continue;
    }
    if (line.startsWith('+')) {
      out.push(`${pad(newN)} ${pad(null)} + ${line.slice(1)}`);
      newN += 1;
    } else if (line.startsWith('-')) {
      out.push(`${pad(null)} ${pad(oldM)} - ${line.slice(1)}`);
      oldM += 1;
    } else if (line.startsWith(' ')) {
      out.push(`${pad(newN)} ${pad(oldM)}   ${line.slice(1)}`);
      newN += 1;
      oldM += 1;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

function sliceRangeForHunk(hunk: Hunk, contextLines: number, head: string): [number, number] {
  const totalLines = head.split('\n').length;
  const start = Math.max(1, hunk.newStart - contextLines);
  const end = Math.min(totalLines, hunk.newStart + hunk.newLines + contextLines);
  return [start, end];
}

function sliceLines(source: string, start: number, end: number): string {
  const lines = source.split('\n');
  const s = Math.max(1, Math.min(start, lines.length));
  const e = Math.max(s, Math.min(end, lines.length));
  return lines.slice(s - 1, e).join('\n');
}

function languageForPath(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = path.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    mjs: 'js',
    cjs: 'js',
    json: 'json',
    md: 'md',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    c: 'c',
    h: 'c',
    cc: 'cpp',
    cpp: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    sh: 'bash',
    zsh: 'bash',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    html: 'html',
    css: 'css',
    scss: 'scss',
  };
  return map[ext] ?? ext;
}
