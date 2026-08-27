import type {
  Flow,
  FlowBlock,
  PerspectiveDraft,
  PerspectiveKind,
  SummaryPayload,
} from '@semantic-diff-tracer/core';
import { traceModeFor } from '@semantic-diff-tracer/core';
import { escapeHtml, formatAnchor, slugify } from './escape.js';
import { renderVisual } from './visuals.js';

export interface PerspectiveBundle {
  perspective: PerspectiveDraft;
  summary?: SummaryPayload;
  flow?: Flow;
}

/**
 * Render one perspective as a self-contained section. The Trace tab's block
 * detail is left empty here — the client script hydrates it from the JSON
 * payload once the DOM is ready, so a viewer stepping through the flow sees
 * live-updated content without a full re-render.
 */
export function renderPerspective(bundle: PerspectiveBundle, index: number): string {
  const { perspective: p, summary, flow } = bundle;
  const anchorId = anchorFor(p.id, p.title);
  const summaryTab = renderSummaryPanel(p, summary);
  const traceTab = renderTracePanel(flow);
  const kindChip = renderKindChip(p.kind);
  const tabs = `
    <div class="tabs" role="tablist">
      <button class="tab-btn active" data-tab="summary" role="tab">Summary</button>
      <button class="tab-btn" data-tab="trace" role="tab" ${flow ? '' : 'disabled title="No flow available"'}>Trace</button>
    </div>
    <div class="tab-panel active" data-tab-panel="summary">${summaryTab}</div>
    <div class="tab-panel" data-tab-panel="trace">${traceTab}</div>
  `;
  return `
    <section class="persp" id="${escapeHtml(anchorId)}" data-persp-id="${escapeHtml(p.id)}">
      <div class="persp-header">
        <span class="persp-num">${index + 1}.</span>
        <h2>${escapeHtml(p.title)}</h2>
        ${kindChip}
      </div>
      <div class="outcome">${escapeHtml(p.outcome)}</div>
      ${tabs}
    </section>
  `;
}

export function anchorFor(id: string, title: string): string {
  return `persp-${slugify(id + '-' + title)}`;
}

function renderKindChip(kind: PerspectiveKind): string {
  const mode = traceModeFor(kind);
  return `<span class="chip kind mode-${escapeHtml(mode)}" title="mode: ${escapeHtml(mode)}">${escapeHtml(kind)}</span>`;
}

function renderSummaryPanel(p: PerspectiveDraft, summary: SummaryPayload | undefined): string {
  if (!summary) {
    return `<div class="card"><p class="empty">Summary is unavailable for this perspective.</p></div>`;
  }
  const s = summary.summary;
  const outcome = s.outcome && s.outcome !== p.outcome
    ? `<div class="card"><h3>Outcome</h3><p>${escapeHtml(s.outcome)}</p></div>`
    : '';
  const visuals = s.visuals.length
    ? s.visuals.map((v) => renderVisual(v)).join('')
    : '';
  const visualsCard = visuals
    ? `<div class="card"><h3>Visualization</h3>${visuals}</div>`
    : '';
  const watch = s.watchFor.length
    ? `<div class="card"><h3>Watch for</h3><ul class="plain">${s.watchFor
        .map((w) => {
          const anchor = w.anchor
            ? `<span class="anchor">${escapeHtml(formatAnchor(w.anchor.file, w.anchor.line))}</span>`
            : '';
          return `<li class="watch-item"><span>${escapeHtml(w.note)}</span>${anchor}</li>`;
        })
        .join('')}</ul></div>`
    : '';
  const tests = s.tests.length
    ? `<div class="card"><h3>Tests</h3><ul class="plain">${s.tests
        .map(
          (t) =>
            `<li class="test-item"><span>${escapeHtml(t.description)}</span><span class="anchor">${escapeHtml(
              formatAnchor(t.file, t.line),
            )}</span></li>`,
        )
        .join('')}</ul></div>`
    : '';
  return `${outcome}${visualsCard}${watch}${tests}`;
}

function renderTracePanel(flow: Flow | undefined): string {
  if (!flow) {
    return `<div class="card"><p class="empty">Trace not planned for this perspective.</p></div>`;
  }
  const toolbar = `
    <div class="trace-toolbar">
      <button data-step-action="in" title="Step In (i / F11)">Step In</button>
      <button data-step-action="over" title="Step Over (s / F10)">Step Over</button>
      <button data-step-action="out" title="Step Out (o / F12)">Step Out</button>
      <button data-step-action="reverse" title="Back (b)" disabled>Back</button>
      <span class="position" data-trace-position>1 / ${countBlocks(flow.blocks)}</span>
    </div>
  `;
  const outline = renderFlowOutline(flow);
  return `
    ${toolbar}
    <div class="trace-layout">
      <div class="flow-outline">${outline}</div>
      <div class="block-detail" data-trace-detail>
        <p class="empty">Loading first block…</p>
      </div>
    </div>
  `;
}

function renderFlowOutline(flow: Flow): string {
  return `<ul>${flow.blocks.map((b, i) => renderOutlineNode(b, [i])).join('')}</ul>`;
}

function renderOutlineNode(block: FlowBlock, path: number[]): string {
  const chips: string[] = [];
  if (block.focal) {
    chips.push(
      `<span class="chip focal focal-${escapeHtml(block.focal.kind)}" title="${escapeHtml(block.focal.reason)}">${escapeHtml(block.focal.kind)}</span>`,
    );
  }
  if (block.role && block.role !== 'unchanged') {
    chips.push(`<span class="chip role role-${escapeHtml(block.role)}">${escapeHtml(block.role)}</span>`);
  }
  if (block.mocks.length) chips.push(`<span class="chip role" title="${block.mocks.length} mock(s)">M×${block.mocks.length}</span>`);
  if (block.concerns.length) {
    const worst = worstSeverity(block.concerns);
    chips.push(`<span class="chip sev-${escapeHtml(worst)}" title="${block.concerns.length} concern(s)">!×${block.concerns.length}</span>`);
  }
  const chipHtml = chips.length ? `<span class="row-chips">${chips.join('')}</span>` : '';
  const style = `padding-left:${10 + (path.length - 1) * 14}px`;
  const row = `
    <div class="row" data-path="${escapeHtml(path.join('.'))}" style="${style}" role="button" tabindex="0">
      <span class="title" title="${escapeHtml(block.title)}">${escapeHtml(block.title)}</span>
      ${chipHtml}
    </div>
  `;
  const children = block.children.length
    ? `<ul>${block.children.map((c, i) => renderOutlineNode(c, [...path, i])).join('')}</ul>`
    : '';
  return `<li>${row}${children}</li>`;
}

function worstSeverity(concerns: FlowBlock['concerns']): 'info' | 'warn' | 'error' {
  let out: 'info' | 'warn' | 'error' = 'info';
  for (const c of concerns) {
    if (c.severity === 'error') return 'error';
    if (c.severity === 'warn') out = 'warn';
  }
  return out;
}

function countBlocks(blocks: FlowBlock[]): number {
  let n = 0;
  const walk = (bs: FlowBlock[]): void => {
    for (const b of bs) {
      n += 1;
      walk(b.children);
    }
  };
  walk(blocks);
  return n;
}
