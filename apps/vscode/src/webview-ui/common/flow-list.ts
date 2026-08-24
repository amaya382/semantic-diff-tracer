import type { BlockRole, FlowBlock } from '@semantic-diff-tracer/core';
import { el } from './dom.js';
import { formatAnchor } from './paths.js';

/**
 * Tighter than the default budget: a flow row already spends space on the
 * marker, role, index, and chips, and the title has first claim on the rest.
 */
const FLOW_ANCHOR_MAX_CHARS = 18;

export interface FlowListOptions {
  /**
   * If given, the row whose block path matches (compared to `pathOf(block)`)
   * gets the 'current' class. Used by the Trace tab to point at the cursor.
   */
  current?: string;
  onSelect: (block: FlowBlock, blockPath: number[]) => void;
  /**
   * Optional per-row trailing chips (mocks / concerns / focal markers). Set
   * `icon` to a codicon name (without the `codicon-` prefix); omit `text` for
   * an icon-only chip. The caller is responsible for ensuring the codicon CSS
   * is loaded in the surrounding webview.
   */
  chips?: (
    block: FlowBlock,
  ) => Array<{ text?: string; kind?: string; title?: string; icon?: string }>;
}

/**
 * Compact hierarchical list of flow blocks used by the Trace tab. Kept
 * intentionally small: one row per block, colour rail on the left carries the
 * role, no drop-shadows or big paddings.
 */
export function buildFlowList(blocks: FlowBlock[], opts: FlowListOptions): HTMLElement {
  const container = el('div', { class: 'flow-list' });
  let visibleIndex = 0;
  const walk = (nodes: FlowBlock[], parentPath: number[], depth: number): void => {
    nodes.forEach((b, i) => {
      const path = [...parentPath, i];
      visibleIndex += 1;
      container.append(buildRow(b, path, depth, visibleIndex, opts));
      walk(b.children, path, depth + 1);
    });
  };
  walk(blocks, [], 0);
  return container;
}

function buildRow(
  block: FlowBlock,
  path: number[],
  depth: number,
  index: number,
  opts: FlowListOptions,
): HTMLElement {
  const key = path.join('.');
  const isCurrent = opts.current === key;
  const role = block.role ?? 'unchanged';
  const chips = opts.chips ? opts.chips(block) : [];
  return el('div', {
    class: [
      'flow-list-row',
      `depth-${Math.min(depth, 4)}`,
      `role-${role}`,
      isCurrent ? 'current' : '',
    ]
      .filter(Boolean)
      .join(' '),
    attrs: { title: describeBlock(block, role) },
    dataset: { blockId: block.id },
    onClick: () => opts.onSelect(block, path),
    children: [
      el('span', { class: 'flow-list-marker', text: isCurrent ? '▶' : '' }),
      el('span', { class: 'flow-list-role', text: roleSymbol(role) }),
      el('span', { class: 'flow-list-index', text: String(index) }),
      el('span', { class: 'flow-list-title', text: block.title }),
      el('code', {
        class: 'flow-list-anchor',
        text: formatAnchor(block.focus.file, block.focus.startLine, FLOW_ANCHOR_MAX_CHARS),
      }),
      chips.length > 0
        ? el('span', {
            class: 'flow-list-chips',
            children: chips.map((c) => {
              const children: Node[] = [];
              if (c.icon) {
                children.push(
                  el('i', { class: `codicon codicon-${c.icon} flow-list-chip-icon` }),
                );
              }
              if (c.text) {
                children.push(el('span', { class: 'flow-list-chip-text', text: c.text }));
              }
              const iconOnly = !!c.icon && !c.text;
              return el('span', {
                class:
                  `flow-list-chip${c.kind ? ' ' + c.kind : ''}` +
                  (iconOnly ? ' icon-only' : ''),
                children,
                ...(c.title ? { attrs: { title: c.title } } : {}),
              });
            }),
          })
        : el('span'),
    ],
  });
}

function roleSymbol(role: BlockRole): string {
  switch (role) {
    case 'added':
      return '+';
    case 'modified':
      return '±';
    case 'removed':
      return '−';
    case 'unchanged':
      return '·';
  }
}

function describeBlock(block: FlowBlock, role: BlockRole): string {
  const loc = `${block.focus.file}:${block.focus.startLine}-${block.focus.endLine}`;
  const before = block.beforeFocus
    ? `\nbefore: ${block.beforeFocus.file}:${block.beforeFocus.startLine}-${block.beforeFocus.endLine}`
    : '';
  return `${block.title}\n${loc}${before}\nrole: ${role}`;
}

export function pathKey(path: number[]): string {
  return path.join('.');
}

/** CSS for the shared list. Include once per webview. */
export function flowListCss(): string {
  return `
    .flow-list { display: flex; flex-direction: column; gap: 1px; }
    /* The title track keeps a floor and the anchor track is allowed to shrink
       past its content, so a deep path ellipsizes instead of squeezing the
       title out of the row. */
    .flow-list-row { display: grid; grid-template-columns: 10px 12px 18px minmax(3.5rem, 1fr) minmax(0, auto) auto; align-items: center; gap: 0.25rem; padding: 0.15rem 0.3rem; border-radius: 3px; cursor: pointer; font-size: 0.8rem; line-height: 1.35; color: var(--vscode-foreground); border-left: 3px solid var(--role-accent); }
    .flow-list-row:hover { background: var(--vscode-list-hoverBackground); }
    .flow-list-row.current { background: var(--vscode-list-activeSelectionBackground, var(--vscode-editor-selectionBackground)); color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground)); }
    .flow-list-row.depth-1 { padding-left: 0.85rem; }
    .flow-list-row.depth-2 { padding-left: 1.4rem; }
    .flow-list-row.depth-3 { padding-left: 1.95rem; }
    .flow-list-row.depth-4 { padding-left: 2.5rem; }
    .flow-list-row.role-added { --role-accent: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); }
    .flow-list-row.role-modified { --role-accent: var(--vscode-gitDecoration-modifiedResourceForeground, #d19a66); }
    .flow-list-row.role-removed { --role-accent: var(--vscode-gitDecoration-deletedResourceForeground, #e06c75); }
    .flow-list-row.role-unchanged { --role-accent: var(--vscode-editorWidget-border, #555); }
    .flow-list-marker { color: var(--role-accent); font-family: var(--vscode-editor-font-family, monospace); font-size: 0.7rem; }
    .flow-list-role { color: var(--role-accent); font-family: var(--vscode-editor-font-family, monospace); font-weight: 700; text-align: center; }
    .flow-list-index { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 0.7rem; text-align: right; }
    .flow-list-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .flow-list-row.current .flow-list-title { font-weight: 500; }
    .flow-list-anchor { font-size: 0.68rem; opacity: 0.6; font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .flow-list-chips { display: flex; gap: 0.15rem; flex-shrink: 0; }
    .flow-list-chip { padding: 0.02rem 0.3rem; border-radius: 999px; font-size: 0.62rem; white-space: nowrap; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); display: inline-flex; align-items: center; gap: 0.2rem; }
    .flow-list-chip .flow-list-chip-icon { font-size: 0.78rem; line-height: 1; }
    /* Icon-only chips shrink to a square badge — no room for text padding. */
    .flow-list-chip.icon-only { padding: 0.05rem 0.22rem; }
    .flow-list-chip.warn { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
    .flow-list-chip.error { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
    .flow-list-chip.info { background: var(--vscode-editorInfo-foreground, var(--vscode-badge-background)); color: var(--vscode-editor-background); }
    /* Mock chips: one codicon per kind, colour carries the kind. Substituted
       behaviour is blue, a pinned constant green, an untaken path grey. */
    .flow-list-chip.mock-stub { background: var(--vscode-charts-blue, #4a90e2); color: var(--vscode-editor-background); }
    .flow-list-chip.mock-value { background: var(--vscode-charts-green, #4caf50); color: var(--vscode-editor-background); }
    .flow-list-chip.mock-skip { background: var(--vscode-descriptionForeground, #888); color: var(--vscode-editor-background); }
    /* Focal chips: value-neutral "this is where the change lives" marker. Kind
       drives the colour; core is the strongest, entry the entry point of the
       changed path, contract the outward-facing surface. Icon-only in the
       Flow list — the label lives in the tooltip and in the Focal card. */
    .flow-list-chip.focal-core { background: var(--vscode-charts-blue, #4a90e2); color: #fff; }
    .flow-list-chip.focal-entry { background: var(--vscode-charts-green, #4caf50); color: #fff; }
    .flow-list-chip.focal-contract { background: var(--vscode-charts-orange, #d9822b); color: #fff; }
  `;
}
