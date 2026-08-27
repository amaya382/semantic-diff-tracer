export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

/** JSON safe to embed inside a `<script type="application/json">` block. */
export function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * Shorten a path to at most `max` characters, keeping the tail so the file
 * name identifies the target.
 */
export function truncatePath(filePath: string, max = 32): string {
  if (filePath.length <= max) return filePath;
  const parts = filePath.split('/');
  const base = parts[parts.length - 1] ?? filePath;
  const parent = parts.length > 1 ? parts[parts.length - 2] : undefined;
  if (parent !== undefined) {
    const withParent = `…/${parent}/${base}`;
    if (withParent.length <= max) return withParent;
    const bare = `…/${base}`;
    if (bare.length <= max) return bare;
  }
  return base.length <= max ? base : `${base.slice(0, max - 1)}…`;
}

export function formatAnchor(file: string, line: number, max = 32): string {
  return `${truncatePath(file, max)}:${line}`;
}

/** Slug for anchor / id attributes; kept ASCII to avoid encoding surprises. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';
}
