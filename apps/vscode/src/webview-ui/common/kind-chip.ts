import type { PerspectiveKind } from '@semantic-diff-tracer/core';
import { traceModeFor } from '@semantic-diff-tracer/core';
import { el } from './dom.js';

/**
 * The chip prints the kind but is coloured by its trace mode, so nine labels
 * still read as four groups: behaviour to walk, restructure to verify, contract
 * whose consumers must follow, and surface a reviewer can skim.
 */
export function kindChip(kind: PerspectiveKind): HTMLElement {
  return el('span', { class: `chip kind mode-${traceModeFor(kind)}`, text: kind });
}

export function kindChipCss(): string {
  return `
    .chip.kind.mode-flow { background: var(--vscode-charts-blue, #4a90e2); color: #fff; }
    .chip.kind.mode-contract { background: var(--vscode-charts-orange, #d9822b); color: #fff; }
    .chip.kind.mode-structural { background: var(--vscode-charts-purple, #b180d7); color: #fff; }
    .chip.kind.mode-surface { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); opacity: 0.85; }
  `;
}
