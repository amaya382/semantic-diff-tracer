/**
 * Rendering rules for the `file:line` locators that trail a label — flow rows,
 * Watch-for and Tests entries, concern jumps. The label is what the reviewer
 * reads; the locator only has to stay recognisable, so it gets a hard character
 * budget and yields space rather than pushing the label out of the row.
 */
export const ANCHOR_MAX_CHARS = 24;

/**
 * Shorten a path to at most `max` characters, keeping the end — the file name
 * identifies the target, the leading directories rarely do.
 */
export function truncatePath(filePath: string, max: number = ANCHOR_MAX_CHARS): string {
  if (filePath.length <= max) return filePath;
  const parts = filePath.split('/');
  const base = parts[parts.length - 1] ?? filePath;
  const parent = parts.length > 1 ? parts[parts.length - 2] : undefined;
  if (parent !== undefined) {
    // One directory disambiguates the common index.ts / adapter.ts collisions.
    const withParent = `…/${parent}/${base}`;
    if (withParent.length <= max) return withParent;
    const bare = `…/${base}`;
    if (bare.length <= max) return bare;
  }
  return ellipsizeMiddle(base, max);
}

/** Elide the middle so both the prefix and the extension stay readable. */
function ellipsizeMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return tail > 0 ? `${text.slice(0, head)}…${text.slice(-tail)}` : `${text.slice(0, head)}…`;
}

export function formatAnchor(file: string, line: number, max: number = ANCHOR_MAX_CHARS): string {
  return `${truncatePath(file, max)}:${line}`;
}
