import type {
  Flow,
  IncidentalChange,
  PerspectiveDraft,
  PerspectiveSet,
  SummaryPayload,
} from '@semantic-diff-tracer/core';
import type { PrMeta } from '@semantic-diff-tracer/core';
import { escapeHtml, embedJson, truncatePath } from './escape.js';
import { styles } from './styles.js';
import { clientScript } from './client.js';
import { anchorFor, renderPerspective, type PerspectiveBundle } from './perspective.js';

export interface ReportInput {
  meta: PrMeta;
  perspectives: PerspectiveSet;
  bundles: PerspectiveBundle[];
  generatedAt: Date;
  language: string;
  /** Loaded from CDN if allowed by the offline flag. */
  includeMermaidCdn: boolean;
}

export function renderReport(input: ReportInput): string {
  const title = input.meta.title || 'PR report';
  const sidebar = renderSidebar(input.bundles);
  const header = renderHeader(input);
  const persps = input.bundles
    .map((b, i) => renderPerspective(b, i))
    .join('');
  const incidental = renderIncidental(input.perspectives.incidental);
  const payload = embedJson({
    perspectives: input.bundles.map((b) => serializeBundle(b)),
  });
  const mermaidScript = input.includeMermaidCdn
    ? '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js" crossorigin="anonymous"></script>'
    : '';
  const toc = `
    <div class="top-toc">
      <span>${input.perspectives.perspectives.length} perspectives</span>
      <span>·</span>
      <span>Generated ${escapeHtml(formatTimestamp(input.generatedAt))}</span>
      <span class="theme-toggle">
        Theme:
        <button data-theme-set="system">system</button>
        <button data-theme-set="light">light</button>
        <button data-theme-set="dark">dark</button>
      </span>
    </div>
  `;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${styles()}</style>
${mermaidScript}
</head>
<body>
<div class="shell">
${sidebar}
<main class="main">
${toc}
${header}
${persps}
${incidental}
</main>
</div>
<script id="sdt-payload" type="application/json">${payload}</script>
<script>${clientScript()}</script>
</body>
</html>`;
}

function renderSidebar(bundles: PerspectiveBundle[]): string {
  const items = bundles
    .map((b, i) => {
      const p = b.perspective;
      const href = `#${anchorFor(p.id, p.title)}`;
      return `<li><a href="${escapeHtml(href)}"><span class="persp-num">${i + 1}</span><span class="persp-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span></a></li>`;
    })
    .join('');
  return `
    <aside class="sidebar">
      <h1>Perspectives</h1>
      <p class="subtitle">outcome-based groups</p>
      <ul class="persp-list">${items}</ul>
    </aside>
  `;
}

function renderHeader(input: ReportInput): string {
  const { meta, perspectives } = input;
  const url = meta.url
    ? `<a href="${escapeHtml(meta.url)}" target="_blank" rel="noopener">${escapeHtml(meta.url)}</a>`
    : '';
  const readingOrder = perspectives.readingOrder
    ? `<p class="reading-order"><strong>Reading order:</strong> ${escapeHtml(perspectives.readingOrder)}</p>`
    : '';
  return `
    <header class="header">
      <h1 style="margin:0;font-size:22px">${escapeHtml(meta.title)}</h1>
      <p class="tldr">${escapeHtml(perspectives.tldr || '')}</p>
      <div class="meta">
        by ${escapeHtml(meta.author || 'unknown')}
        · <code>${escapeHtml(meta.baseRef)}</code> ← <code>${escapeHtml(meta.headRef)}</code>
        ${url ? '· ' + url : ''}
      </div>
      ${readingOrder}
    </header>
  `;
}

function renderIncidental(items: IncidentalChange[]): string {
  if (!items.length) return '';
  const rows = items
    .map((c) => {
      const files = c.hunkRefs
        .map((h) => truncatePath(h.file))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ');
      return `<li><span class="category">${escapeHtml(c.category)}</span>: ${escapeHtml(c.note)}<br/><small>${escapeHtml(files)}</small></li>`;
    })
    .join('');
  return `
    <section class="incidental">
      <h2>Incidental changes</h2>
      <ul>${rows}</ul>
    </section>
  `;
}

function formatTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Trim the block payload so the embedded JSON stays lean; the client script
 * only reads what it renders.
 */
function serializeBundle(b: PerspectiveBundle): SerializedPerspective {
  return {
    id: b.perspective.id,
    title: b.perspective.title,
    flow: b.flow ? serializeFlow(b.flow) : undefined,
  };
}

interface SerializedFlow {
  blocks: SerializedBlock[];
}
interface SerializedBlock {
  id: string;
  title: string;
  narrative: string;
  focus: Flow['blocks'][number]['focus'];
  code: string;
  beforeFocus?: Flow['blocks'][number]['beforeFocus'];
  beforeCode?: string;
  role?: Flow['blocks'][number]['role'];
  focal?: Flow['blocks'][number]['focal'];
  visibleVars: Flow['blocks'][number]['visibleVars'];
  mocks: Flow['blocks'][number]['mocks'];
  concerns: Flow['blocks'][number]['concerns'];
  children: SerializedBlock[];
}
interface SerializedPerspective {
  id: string;
  title: string;
  flow: SerializedFlow | undefined;
}

function serializeFlow(f: Flow): SerializedFlow {
  return { blocks: f.blocks.map(serializeBlock) };
}
function serializeBlock(b: Flow['blocks'][number]): SerializedBlock {
  return {
    id: b.id,
    title: b.title,
    narrative: b.narrative,
    focus: b.focus,
    code: b.code,
    ...(b.beforeFocus ? { beforeFocus: b.beforeFocus } : {}),
    ...(b.beforeCode ? { beforeCode: b.beforeCode } : {}),
    ...(b.role ? { role: b.role } : {}),
    ...(b.focal ? { focal: b.focal } : {}),
    visibleVars: b.visibleVars,
    mocks: b.mocks,
    concerns: b.concerns,
    children: b.children.map(serializeBlock),
  };
}
