import type { SummaryVisual } from '@semantic-diff-tracer/core';
import { escapeHtml } from './escape.js';

/**
 * Server-render a single `SummaryVisual` into a card. Mermaid stays as a
 * `<pre class="mermaid">` block; the CDN mermaid script (loaded in the head)
 * upgrades it on the client. When the CDN is unreachable, the source remains
 * legible as monospace text — chosen over silently swallowing the visual.
 */
export function renderVisual(v: SummaryVisual): string {
  const caption = `<div class="caption">${escapeHtml(v.caption)}</div>`;
  switch (v.kind) {
    case 'mermaid':
      return wrap(`<pre class="mermaid">${escapeHtml(v.source)}</pre>${caption}`);
    case 'diff':
      return wrap(`<pre class="diff">${renderDiff(v.source)}</pre>${caption}`);
    case 'code': {
      const lang = v.language ? ` data-language="${escapeHtml(v.language)}"` : '';
      return wrap(`<pre class="code"${lang}>${escapeHtml(v.source)}</pre>${caption}`);
    }
    case 'pseudocode':
    case 'call-tree':
    case 'component-tree':
    case 'file-tree':
      return wrap(`<pre class="${escapeHtml(v.kind)}">${escapeHtml(v.source)}</pre>${caption}`);
    default:
      return '';
  }
}

function wrap(inner: string): string {
  return `<div class="visual">${inner}</div>`;
}

/**
 * Colour a unified-diff block by prefix. Not a full parser — hunks and
 * add/del/context are enough for the reviewer's eye to catch the shape.
 */
function renderDiff(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
        return `<span class="hunk">${escapeHtml(line)}</span>`;
      }
      if (line.startsWith('@@')) return `<span class="hunk">${escapeHtml(line)}</span>`;
      if (line.startsWith('+')) return `<span class="add">${escapeHtml(line)}</span>`;
      if (line.startsWith('-')) return `<span class="del">${escapeHtml(line)}</span>`;
      return escapeHtml(line);
    })
    .join('\n');
}
