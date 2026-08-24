import type { UnifiedDiff } from '../domain/diff.js';

const MAX_HUNK_PREVIEW_LINES = 6;

export function buildHunkManifest(diff: UnifiedDiff): string {
  const parts: string[] = [];
  for (const file of diff.files) {
    parts.push(`### ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`);
    file.hunks.forEach((h, i) => {
      const body = h.body.split('\n').slice(0, MAX_HUNK_PREVIEW_LINES).join('\n');
      parts.push(`hunk #${i} @@ ${h.header}\n${body}`);
    });
  }
  return parts.join('\n\n');
}
