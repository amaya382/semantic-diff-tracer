import { el } from './dom.js';

export interface SplitterOptions {
  /** Storage key for persisting the left pane's width across reloads. */
  storageKey: string;
  /** Initial left pane width, expressed as fraction of the container (0-1). */
  initialFraction?: number;
  /** Clamp — left pane never shrinks below this fraction. */
  minFraction?: number;
  /** Clamp — left pane never grows above this fraction. */
  maxFraction?: number;
}

/**
 * Build a `.split` container with a drag handle between `left` and `right`.
 * The handle uses `flex-basis` on `left` so the ratio survives resizes of the
 * outer container.
 */
export function buildSplit(
  left: HTMLElement,
  right: HTMLElement,
  opts: SplitterOptions,
): HTMLElement {
  const min = opts.minFraction ?? 0.15;
  const max = opts.maxFraction ?? 0.85;
  const stored = readStored(opts.storageKey);
  const initial = clamp(stored ?? opts.initialFraction ?? 0.4, min, max);

  left.classList.add('split-left');
  right.classList.add('split-right');
  left.style.flex = `0 0 ${initial * 100}%`;

  const handle = el('div', {
    class: 'split-handle',
    attrs: { role: 'separator', 'aria-orientation': 'vertical', tabindex: '0' },
  });

  const container = el('div', {
    class: 'split',
    children: [left, handle, right],
  });

  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    document.body.classList.add('split-dragging');
    const rect = container.getBoundingClientRect();
    const onMove = (e: MouseEvent): void => {
      const raw = (e.clientX - rect.left) / rect.width;
      const fraction = clamp(raw, min, max);
      left.style.flex = `0 0 ${fraction * 100}%`;
    };
    const onUp = (): void => {
      document.body.classList.remove('split-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Persist the final ratio from the current basis, not the last mouse pos,
      // so a clamped drag still records the clamped value.
      const basis = parseFloat(left.style.flex.split(' ').pop() ?? '') || 0;
      writeStored(opts.storageKey, clamp(basis / 100, min, max));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Keyboard-accessible resize (arrow keys nudge by 5%).
  handle.addEventListener('keydown', (event) => {
    const step = 0.05;
    let delta = 0;
    if (event.key === 'ArrowLeft') delta = -step;
    else if (event.key === 'ArrowRight') delta = step;
    else return;
    event.preventDefault();
    const currentBasis = parseFloat(left.style.flex.split(' ').pop() ?? '') || 0;
    const next = clamp(currentBasis / 100 + delta, min, max);
    left.style.flex = `0 0 ${next * 100}%`;
    writeStored(opts.storageKey, next);
  });

  return container;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function readStored(key: string): number | undefined {
  try {
    const raw = window.localStorage?.getItem(key);
    if (!raw) return undefined;
    const num = Number.parseFloat(raw);
    return Number.isFinite(num) ? num : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: number): void {
  try {
    window.localStorage?.setItem(key, String(value));
  } catch {
    // ignore quota / disabled storage
  }
}

/** CSS the caller has to include (once per webview) so the splitter renders. */
export function splitterCss(): string {
  return `
    .split { display: flex; align-items: stretch; width: 100%; height: 100%; min-height: 0; }
    .split-left, .split-right { min-width: 0; min-height: 0; overflow: auto; }
    .split-right { flex: 1 1 auto; }
    .split-handle { flex: 0 0 6px; cursor: col-resize; background: transparent; position: relative; align-self: stretch; }
    .split-handle::after { content: ''; position: absolute; top: 0; bottom: 0; left: 2px; width: 2px; background: var(--vscode-editorWidget-border, #444); transition: background 120ms ease; }
    .split-handle:hover::after, .split-handle:focus::after, body.split-dragging .split-handle::after { background: var(--vscode-focusBorder, var(--vscode-textLink-foreground)); }
    .split-handle:focus { outline: none; }
    body.split-dragging { cursor: col-resize; user-select: none; }
    body.split-dragging iframe { pointer-events: none; }
  `;
}
