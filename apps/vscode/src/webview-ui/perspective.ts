import type {
  BlockPath,
  Flow,
  FlowBlock,
  FocalKind,
  Mock,
  SummaryPayload,
  SummaryVisual,
  PerspectiveDraft,
  QaSection,
  Severity,
  StepAction,
  Variable,
} from '@semantic-diff-tracer/core';
import { el, empty, renderMarkdown } from './common/dom.js';
import { highlightCss, highlightLine, languageForFile } from './common/highlight.js';
import { buildFlowList, flowListCss, pathKey } from './common/flow-list.js';
import { kindChip, kindChipCss } from './common/kind-chip.js';
import { formatAnchor } from './common/paths.js';

// ---------- types ----------

type CodeSide = 'before' | 'after';
type MockKind = Mock['kind'];
type TopTab = 'summary' | 'trace';

/**
 * Codicon per mock kind, plus a colour that carries the kind. Substituted
 * behaviour is a replace glyph, a pinned constant is a pin, an untaken path
 * is a slashed circle.
 */
const MOCK_KINDS: MockKind[] = ['stub', 'value', 'skip'];
const MOCK_CODICON: Record<MockKind, string> = {
  stub: 'replace',
  value: 'pin',
  skip: 'circle-slash',
};
const MOCK_LABEL: Record<MockKind, string> = {
  stub: 'stubbed call',
  value: 'pinned value',
  skip: 'skipped path',
};

/**
 * Codicon glyphs for the focal chip / card / gutter marker. Kept in one place
 * so the Flow list chip, the Focal card in the left pane, and the CodeView
 * gutter icon all pick the same icon per kind.
 */
const FOCAL_CODICON: Record<FocalKind, string> = {
  core: 'target',
  entry: 'debug-start',
  contract: 'symbol-interface',
};
const FOCAL_LABEL: Record<FocalKind, string> = {
  core: 'core',
  entry: 'entry',
  contract: 'contract',
};

/**
 * Codicon per concern severity, matching VS Code's Problems view: info, warning,
 * error. The chip's background colour still carries the severity, so the icon
 * only needs to be unambiguous, not colour-critical.
 */
const CONCERN_CODICON: Record<Severity, string> = {
  info: 'info',
  warn: 'warning',
  error: 'error',
};
type TraceSubTab = 'flow' | 'mocks';
type ForkOrigin = 'summary' | 'flow';

/** Mirrors `LoadingTask` in panels/perspective-panel.ts. */
interface LoadingTask {
  phase: string;
  /** Completed stages; the bar fills to `step / steps`. */
  step: number;
  /** `<= 1` means no reportable milestone — render an indeterminate bar. */
  steps: number;
  startedAt: number;
}

interface Snapshot {
  perspective: PerspectiveDraft;
  summary?: SummaryPayload;
  flow?: Flow;
  sections: QaSection[];
  loading: { summary?: LoadingTask; flow?: LoadingTask };
  trace: {
    cursor: BlockPath;
    history: BlockPath[];
    fullCodeByFile: Record<string, string>;
    fullBeforeCodeByFile: Record<string, string>;
    refinementInFlight?: string | null;
  };
  activeTab?: TopTab;
}

interface SelectionContext {
  selection: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  /**
   * `flow` when the selection originated from a Trace-side element (code
   * pane, flow list, block narrative) — those threads fork the flow session
   * so the answer can talk about blocks and mocks by name.
   */
  origin: ForkOrigin;
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(s: unknown): void;
  getState(): unknown;
};

// ---------- state ----------

const vscode = acquireVsCodeApi();
const bootstrap = JSON.parse(
  document.getElementById('bootstrap')!.textContent || '{}',
) as { perspective: PerspectiveDraft };

let snapshot: Snapshot = {
  perspective: bootstrap.perspective,
  sections: [],
  loading: {},
  trace: {
    cursor: [0],
    history: [],
    fullCodeByFile: {},
    fullBeforeCodeByFile: {},
  },
};

/** Which top-level tab is showing. Persisted across state pushes below. */
let topTab: TopTab = 'summary';
let traceSubTab: TraceSubTab = 'flow';
let expandedMockId: string | undefined;
const preferredSide = new Map<string, CodeSide>();
/** Per-conversation collapsed state. sectionId → collapsed. */
const collapsedSections = new Set<string>();

let selectionContext: SelectionContext | undefined;
/** Composer text, kept across the redraws that loading updates trigger. */
let composerDraft = '';

const CITATION_HIGHLIGHT = 'sdt-citation';

/**
 * Keep the dragged range visibly marked after the mouse-up. Focusing the
 * composer collapses the document selection, so the native highlight vanishes
 * exactly when the reviewer starts typing about the text they picked. A custom
 * highlight is independent of focus and reads as "cited" rather than "selected".
 *
 * The range dies when a state push rebuilds the DOM under it; the citation chip
 * above the composer is what carries the citation from then on.
 */
function setCitationHighlight(range: Range | undefined): void {
  const registry = CSS.highlights as HighlightRegistry | undefined;
  if (!registry || typeof Highlight === 'undefined') return;
  if (!range) {
    registry.delete(CITATION_HIGHLIGHT);
    return;
  }
  registry.set(CITATION_HIGHLIGHT, new Highlight(range));
}

function clearCitation(): void {
  selectionContext = undefined;
  setCitationHighlight(undefined);
  refreshSelectionChip();
}
/**
 * Persisted split ratios.
 * - Trace-row: height of the top-left pane vs. Chat on the Trace tab.
 * - Left-col: width of the left column (Trace/Chat) vs. right pane. Applies
 *   on both tabs — even on Summary the reviewer might want more Chat width.
 */
const TRACE_ROW_STORAGE_KEY = 'sdt.perspective.traceRow';
const LEFT_COL_STORAGE_KEY = 'sdt.perspective.leftCol';
const FRACTION_MIN = 0.15;
const FRACTION_MAX = 0.85;
let traceRowFraction: number = readStoredFraction(TRACE_ROW_STORAGE_KEY, 0.55);
let leftColFraction: number = readStoredFraction(LEFT_COL_STORAGE_KEY, 0.4);

function readStoredFraction(key: string, fallback: number): number {
  try {
    const raw = window.localStorage?.getItem(key);
    const v = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(v)) return clampFraction(v);
  } catch {
    // ignore quota / disabled storage
  }
  return fallback;
}
function writeStoredFraction(key: string, v: number): void {
  try {
    window.localStorage?.setItem(key, String(v));
  } catch {
    // ignore
  }
}
function clampFraction(v: number): number {
  return Math.max(FRACTION_MIN, Math.min(FRACTION_MAX, v));
}

installStyles();
render();

window.addEventListener('message', (event) => {
  const msg = event.data as { type: string; snapshot?: Snapshot };
  if (msg.type === 'state' && msg.snapshot) {
    snapshot = msg.snapshot;
    // Server-provided activeTab lets the host preselect a tab on first show
    // (e.g. Open Trace opens on the Trace tab). It is authoritative when set —
    // user clicks after that mutate `topTab` alone.
    if (snapshot.activeTab) topTab = snapshot.activeTab;
    render();
  }
});

document.addEventListener('keydown', (e) => {
  if (topTab !== 'trace') return;
  if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  if (e.key === 'F10' || e.key === 's') sendStep('over');
  if (e.key === 'F11' || e.key === 'i') sendStep('in');
  if (e.key === 'F12' || e.key === 'o') sendStep('out');
  if (e.key === 'b') sendStep('reverse');
});

// ---------- top-level layout ----------

/**
 * Full redraw. The host pushes a snapshot on every stage change of the two
 * background loads, so whatever the reviewer had typed must survive the
 * rebuild — hence the composer draft and focus restore.
 */
function render(): void {
  const root = document.getElementById('root')!;
  captureComposerDraft();
  const composerHadFocus = document.activeElement?.id === 'composer-input';
  empty(root);
  root.append(buildShell());
  installGlobalSelectionCapture();
  syncElapsedTicker();
  if (composerHadFocus) {
    const ta = document.getElementById('composer-input') as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }
}

function captureComposerDraft(): void {
  const ta = document.getElementById('composer-input') as HTMLTextAreaElement | null;
  if (ta) composerDraft = ta.value;
}

function buildShell(): HTMLElement {
  const shell = el('div', { class: `shell topTab-${topTab}` });
  applyGridSizes(shell);
  shell.append(buildTopLeftPane());
  shell.append(buildRowSplitter(shell));
  shell.append(buildBottomLeftPane());
  shell.append(buildColSplitter(shell));
  shell.append(buildRightPane());
  return shell;
}

/**
 * Write the current row/column fractions onto the shell's inline styles.
 * Called on first render and after every splitter drag. Summary tab keeps
 * `grid-template-rows` on its CSS default (auto/0/1fr) — only the column
 * width is JS-driven there.
 */
function applyGridSizes(shell: HTMLElement): void {
  const colPct = (leftColFraction * 100).toFixed(3);
  shell.style.gridTemplateColumns = `${colPct}% 6px calc(${100 - Number(colPct)}% - 6px)`;
  if (topTab === 'trace') {
    const rowPct = (traceRowFraction * 100).toFixed(3);
    shell.style.gridTemplateRows = `${rowPct}% 6px calc(${100 - Number(rowPct)}% - 6px)`;
  } else {
    // Summary tab: let the stylesheet's `auto 0 1fr` fall through.
    shell.style.removeProperty('grid-template-rows');
  }
}

/**
 * Horizontal divider between the top-left (Summary/Trace) and the Chat pane.
 * Only interactive on the Trace tab — Summary pins its own row height so the
 * user isn't tempted to expand a pane that has nothing in it.
 */
function buildRowSplitter(shell: HTMLElement): HTMLElement {
  const handle = el('div', {
    class: `row-splitter ${topTab === 'trace' ? '' : 'disabled'}`,
    attrs: {
      role: 'separator',
      'aria-orientation': 'horizontal',
      tabindex: topTab === 'trace' ? '0' : '-1',
      title:
        topTab === 'trace'
          ? 'Drag to resize the Trace / Chat panes'
          : 'Chat auto-expands on the Summary tab',
    },
  });
  if (topTab !== 'trace') return handle;

  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    document.body.classList.add('row-splitter-dragging');
    const rect = shell.getBoundingClientRect();
    const onMove = (e: MouseEvent): void => {
      traceRowFraction = clampFraction((e.clientY - rect.top) / rect.height);
      applyGridSizes(shell);
    };
    const onUp = (): void => {
      document.body.classList.remove('row-splitter-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      writeStoredFraction(TRACE_ROW_STORAGE_KEY, traceRowFraction);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  handle.addEventListener('keydown', (event) => {
    const step = 0.05;
    let delta = 0;
    if (event.key === 'ArrowUp') delta = -step;
    else if (event.key === 'ArrowDown') delta = step;
    else return;
    event.preventDefault();
    traceRowFraction = clampFraction(traceRowFraction + delta);
    applyGridSizes(shell);
    writeStoredFraction(TRACE_ROW_STORAGE_KEY, traceRowFraction);
  });
  return handle;
}

/**
 * Vertical divider between the left column (Trace/Chat) and the right pane.
 * Always interactive — even on Summary the reviewer might want more Chat width.
 */
function buildColSplitter(shell: HTMLElement): HTMLElement {
  const handle = el('div', {
    class: 'col-splitter',
    attrs: {
      role: 'separator',
      'aria-orientation': 'vertical',
      tabindex: '0',
      title: 'Drag to resize the left column',
    },
  });
  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    document.body.classList.add('col-splitter-dragging');
    const rect = shell.getBoundingClientRect();
    const onMove = (e: MouseEvent): void => {
      leftColFraction = clampFraction((e.clientX - rect.left) / rect.width);
      applyGridSizes(shell);
    };
    const onUp = (): void => {
      document.body.classList.remove('col-splitter-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      writeStoredFraction(LEFT_COL_STORAGE_KEY, leftColFraction);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  handle.addEventListener('keydown', (event) => {
    const step = 0.05;
    let delta = 0;
    if (event.key === 'ArrowLeft') delta = -step;
    else if (event.key === 'ArrowRight') delta = step;
    else return;
    event.preventDefault();
    leftColFraction = clampFraction(leftColFraction + delta);
    applyGridSizes(shell);
    writeStoredFraction(LEFT_COL_STORAGE_KEY, leftColFraction);
  });
  return handle;
}

// ---------- top-left pane ----------

function buildTopLeftPane(): HTMLElement {
  const pane = el('div', { class: 'pane pane-topleft' });
  pane.append(buildTopTabs());
  const body = el('div', { class: 'tab-body' });
  if (topTab === 'summary') {
    body.append(buildSummaryLeftBody());
  } else {
    body.append(buildTraceLeftBody());
  }
  pane.append(body);
  return pane;
}

function buildTopTabs(): HTMLElement {
  const tabs = el('div', { class: 'tabs top-tabs', attrs: { role: 'tablist' } });
  tabs.append(topTabButton('summary', 'Summary'));
  tabs.append(topTabButton('trace', 'Trace'));
  return tabs;
}

function topTabButton(id: TopTab, label: string): HTMLElement {
  // Both halves load together, so the inactive tab needs its own spinner —
  // otherwise the reviewer can't tell that switching over would still wait.
  const task = id === 'summary' ? snapshot.loading.summary : snapshot.loading.flow;
  const children: Node[] = [el('span', { text: label })];
  if (task) children.push(el('span', { class: 'spinner tab-spinner' }));
  return el('button', {
    class: `tab ${topTab === id ? 'active' : ''}`,
    attrs: task ? { title: `${task.phase}…` } : {},
    children,
    onClick: () => {
      if (topTab === id) return;
      topTab = id;
      // Ask the host to hydrate the flow / summary lazily as needed.
      vscode.postMessage({
        type: 'tabChange',
        perspectiveId: snapshot.perspective.id,
        tab: id,
      });
      render();
    },
  });
}

// ---------- loading indicator ----------

/**
 * Spinner + stage label + elapsed clock, with a filled bar once the task has
 * more than one stage to report. `fallback` covers the window between a tab
 * having no data and the host publishing the task that will produce it.
 */
function buildLoadingBlock(task: LoadingTask | undefined, fallback: string): HTMLElement {
  const phase = task?.phase ?? fallback;
  const head = el('div', {
    class: 'loading-head',
    children: [
      el('span', { class: 'spinner' }),
      el('span', { class: 'loading-phase', text: `${phase}…` }),
    ],
  });
  if (task) {
    head.append(
      el('span', {
        class: 'loading-elapsed',
        text: formatElapsed(task.startedAt),
        dataset: { startedAt: String(task.startedAt) },
      }),
    );
  }
  // A single-stage task has nothing honest to show as a fraction, so it gets
  // the sweeping bar instead of one frozen at 0%.
  const staged = task && task.steps > 1 ? task : undefined;
  const bar = el('div', {
    class: `loading-bar ${staged ? '' : 'indeterminate'}`,
    children: staged
      ? [
          el('span', {
            class: 'loading-bar-fill',
            attrs: { style: `width: ${Math.round((staged.step / staged.steps) * 100)}%` },
          }),
        ]
      : [el('span', { class: 'loading-bar-sweep' })],
  });
  const children: Node[] = [head, bar];
  if (staged) {
    children.push(
      el('div', {
        class: 'loading-steps',
        text: `step ${Math.min(staged.step + 1, staged.steps)} of ${staged.steps}`,
      }),
    );
  }
  return el('div', { class: 'loading-block', children });
}

function formatElapsed(startedAt: number): string {
  const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}

/**
 * One interval drives every elapsed counter on screen. It writes text into the
 * existing nodes instead of re-rendering, so a per-second tick can't clobber
 * the composer or scroll position.
 */
let elapsedTicker: number | undefined;
function syncElapsedTicker(): void {
  const running = document.querySelectorAll('[data-started-at]').length > 0;
  if (running && elapsedTicker === undefined) {
    elapsedTicker = window.setInterval(tickElapsed, 1000);
  } else if (!running && elapsedTicker !== undefined) {
    window.clearInterval(elapsedTicker);
    elapsedTicker = undefined;
  }
}

function tickElapsed(): void {
  const nodes = document.querySelectorAll<HTMLElement>('[data-started-at]');
  if (nodes.length === 0) {
    syncElapsedTicker();
    return;
  }
  for (const node of nodes) {
    node.textContent = formatElapsed(Number(node.dataset['startedAt']));
  }
}

/**
 * Summary tab's top-left pane. Deliberately empty — the summary view puts
 * everything into the right pane and lets the Chat below stretch. A minimal
 * header keeps the top-left from looking like a bug when the pane is small.
 */
function buildSummaryLeftBody(): HTMLElement {
  return el('div', {
    class: 'summary-left',
    children: [
      el('p', {
        class: 'summary-left-hint',
        text:
          'Summary lives on the right. Ask about the perspective below — or drag-select any prose to cite it.',
      }),
    ],
  });
}

// ---------- trace tab's top-left pane (Flow / Mocks) ----------

function buildTraceLeftBody(): HTMLElement {
  const wrap = el('div', { class: 'trace-left' });
  wrap.append(buildTraceSubTabs());
  if (traceSubTab === 'flow') wrap.append(buildTraceFlowBody());
  else wrap.append(buildTraceMocksBody());
  return wrap;
}

function buildTraceSubTabs(): HTMLElement {
  const tabs = el('div', { class: 'tabs sub-tabs', attrs: { role: 'tablist' } });
  const mockCount = snapshot.flow?.allMocks.length ?? 0;
  tabs.append(traceSubTabButton('flow', 'Flow'));
  tabs.append(traceSubTabButton('mocks', `Mocks (${mockCount})`));
  return tabs;
}

function traceSubTabButton(id: TraceSubTab, label: string): HTMLElement {
  return el('button', {
    class: `tab ${traceSubTab === id ? 'active' : ''}`,
    text: label,
    onClick: () => {
      if (traceSubTab === id) return;
      traceSubTab = id;
      render();
    },
  });
}

function buildTraceFlowBody(): HTMLElement {
  const body = el('div', { class: 'trace-flow-body' });
  body.append(buildTraceToolbar());
  if (!snapshot.flow) {
    body.append(buildLoadingBlock(snapshot.loading.flow, 'Planning the flow'));
    return body;
  }
  body.append(buildTraceFlowOutline(snapshot.flow, snapshot.trace.cursor));
  const block = blockAtPath(snapshot.flow.blocks, snapshot.trace.cursor);
  if (!block) {
    body.append(el('p', { class: 'loading', text: 'End of flow.' }));
    return body;
  }
  body.append(
    el('div', {
      class: 'trace-current',
      children: [
        el('h2', { class: 'block-title', text: block.title }),
        el('p', { class: 'block-narrative', text: block.narrative }),
      ],
    }),
    buildTraceVariables(block.visibleVars, previousBlockInFlow()?.visibleVars ?? []),
    buildTraceFocal(block),
    buildTraceConcerns(block),
  );
  return body;
}

/**
 * Focal card — mirrors the chip in the Flow list but with the reason readable
 * in full. Placed between Variables and Concerns so the reading order is
 * "what values are live → why this block matters → what to worry about".
 */
function buildTraceFocal(block: FlowBlock): HTMLElement {
  if (!block.focal) return el('div');
  const focal = block.focal;
  return el('section', {
    class: `card small focal focal-${focal.kind}`,
    children: [
      el('h3', {
        class: 'focal-heading',
        children: [
          el('i', { class: `codicon codicon-${FOCAL_CODICON[focal.kind]} focal-heading-icon` }),
          el('span', { class: 'focal-heading-text', text: `Focal · ${FOCAL_LABEL[focal.kind]}` }),
        ],
      }),
      el('p', { class: 'focal-reason', text: focal.reason }),
    ],
  });
}

function buildTraceToolbar(): HTMLElement {
  return el('div', {
    class: 'toolbar',
    children: [
      stepBtn('Step In', 'in', 'i'),
      stepBtn('Step Over', 'over', 's'),
      stepBtn('Step Out', 'out', 'o'),
      stepBtn('Reverse', 'reverse', 'b'),
    ],
  });
}

function stepBtn(label: string, action: StepAction, key: string): HTMLElement {
  return el('button', {
    class: 'step-btn',
    text: `${label} (${key})`,
    onClick: () => sendStep(action),
  });
}

function sendStep(action: StepAction): void {
  vscode.postMessage({
    type: 'step',
    perspectiveId: snapshot.perspective.id,
    action,
  });
}

function buildTraceFlowOutline(flow: Flow, cursor: BlockPath): HTMLElement {
  const list = buildFlowList(flow.blocks, {
    current: pathKey(cursor),
    onSelect: (b) =>
      vscode.postMessage({
        type: 'goto',
        perspectiveId: snapshot.perspective.id,
        blockId: b.id,
      }),
    chips: (b) => {
      const cs: Array<{ text?: string; kind?: string; title?: string; icon?: string }> = [];
      if (b.focal) {
        cs.push({
          kind: `focal focal-${b.focal.kind}`,
          title: `Focal · ${FOCAL_LABEL[b.focal.kind]} — ${b.focal.reason}`,
          icon: FOCAL_CODICON[b.focal.kind],
        });
      }
      const byKind = new Map<MockKind, number>();
      for (const m of b.mocks) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
      for (const kind of MOCK_KINDS) {
        const n = byKind.get(kind);
        if (!n) continue;
        cs.push({
          text: n > 1 ? String(n) : undefined,
          kind: `mock mock-${kind}`,
          title: `${n} ${MOCK_LABEL[kind]}${n === 1 ? '' : 's'}`,
          icon: MOCK_CODICON[kind],
        });
      }
      for (const c of b.concerns) {
        cs.push({
          kind: c.severity,
          title: c.message,
          icon: CONCERN_CODICON[c.severity],
        });
      }
      return cs;
    },
  });
  return el('section', {
    class: 'card flow-outline-card',
    children: [el('h3', { text: 'Flow' }), list],
  });
}

/**
 * Variables at the cursor, diffed against the previous block in DFS order so
 * the reader can see a value enter the trace and change as it propagates.
 */
function buildTraceVariables(vars: Variable[], previous: Variable[]): HTMLElement {
  const section = el('section', {
    class: 'card small',
    children: [el('h3', { text: 'Variables' })],
  });
  if (vars.length === 0) {
    section.append(
      el('p', { class: 'muted', text: 'No values in scope for this step.' }),
    );
    return section;
  }
  const before = new Map(previous.map((v) => [v.name, v.value]));
  const list = el('ul', { class: 'var-list' });
  for (const v of vars) {
    const priorValue = before.get(v.name);
    // First block of the flow has nothing to compare against, so nothing is
    // "new" there — every value is simply the starting state.
    const status =
      previous.length === 0
        ? undefined
        : priorValue === undefined
          ? 'new'
          : priorValue !== v.value
            ? 'changed'
            : undefined;
    const head = el('div', {
      class: 'var-head',
      children: [
        el('code', { class: 'var-name', text: v.name }),
        el('span', { class: 'var-eq', text: '=' }),
        el('code', { class: 'var-value', text: v.value }),
      ],
    });
    if (status) head.append(el('span', { class: `var-flag ${status}`, text: status }));
    const li = el('li', { class: 'var-row', children: [head] });
    if (status === 'changed' && priorValue !== undefined) {
      li.append(
        el('div', {
          class: 'var-was',
          children: [
            el('span', { text: 'was ' }),
            el('code', { class: 'var-old-value', text: priorValue }),
          ],
        }),
      );
    }
    if (v.note) li.append(el('div', { class: 'var-note', text: v.note }));
    list.append(li);
  }
  section.append(list);
  return section;
}

/** Flow blocks in DFS order — the sequence the Step buttons walk. */
function dfsBlocks(blocks: FlowBlock[]): FlowBlock[] {
  const out: FlowBlock[] = [];
  const walk = (nodes: FlowBlock[]): void => {
    for (const b of nodes) {
      out.push(b);
      walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

function previousBlockInFlow(): FlowBlock | undefined {
  if (!snapshot.flow) return undefined;
  const current = blockAtPath(snapshot.flow.blocks, snapshot.trace.cursor);
  if (!current) return undefined;
  const ordered = dfsBlocks(snapshot.flow.blocks);
  const idx = ordered.findIndex((b) => b.id === current.id);
  return idx > 0 ? ordered[idx - 1] : undefined;
}

/** Concerns rendered under the block narrative on the Trace tab. */
function buildTraceConcerns(block: FlowBlock): HTMLElement {
  if (block.concerns.length === 0) return el('div');
  const section = el('section', {
    class: 'card small concerns',
    children: [el('h3', { text: 'Concerns' })],
  });
  const list = el('ul', { class: 'concern-list' });
  for (const c of block.concerns) {
    list.append(
      el('li', {
        class: `concern sev-${c.severity}`,
        children: [
          el('span', {
            class: 'sev-chip',
            children: [
              el('i', {
                class: `codicon codicon-${CONCERN_CODICON[c.severity]} sev-chip-icon`,
              }),
              el('span', { text: c.severity }),
            ],
          }),
          el('span', { class: 'concern-msg', text: c.message }),
          el('a', {
            class: 'concern-jump',
            text: formatAnchor(c.anchor.file, c.anchor.line),
            attrs: { href: '#' },
            onClick: (e) => {
              e.preventDefault();
              vscode.postMessage({
                type: 'openFile',
                file: c.anchor.file,
                line: c.anchor.line,
              });
            },
          }),
        ],
      }),
    );
  }
  section.append(list);
  return section;
}

function buildTraceMocksBody(): HTMLElement {
  const body = el('div', { class: 'trace-mocks-body' });
  if (!snapshot.flow) {
    body.append(buildLoadingBlock(snapshot.loading.flow, 'Planning the flow'));
    return body;
  }
  if (snapshot.flow.allMocks.length === 0) {
    body.append(el('p', { class: 'muted', text: 'No auto-mocks in this flow.' }));
    return body;
  }
  const list = el('ul', { class: 'mock-list' });
  for (const m of snapshot.flow.allMocks) list.append(buildMockRow(m));
  body.append(list);
  return body;
}

function buildMockRow(m: Mock): HTMLElement {
  const expanded = expandedMockId === m.id;
  const header = el('div', {
    class: 'mock-header',
    onClick: () => {
      expandedMockId = expanded ? undefined : m.id;
      render();
    },
    children: [
      el('code', { class: 'mock-symbol', text: m.symbol || m.id }),
      // Same codicon and colour the flow rows use, so the chips are readable
      // without a legend.
      el('span', {
        class: `mock-kind mock-${m.kind}`,
        attrs: { title: MOCK_LABEL[m.kind] },
        children: [
          el('i', { class: `codicon codicon-${MOCK_CODICON[m.kind]} mock-kind-icon` }),
          el('span', { text: m.kind }),
        ],
      }),
      el('span', { class: 'mock-reason', text: m.reason }),
    ],
  });
  const row = el('li', { class: `mock-row ${expanded ? 'open' : ''}`, children: [header] });
  if (!expanded) return row;
  const currentValue = el('div', {
    class: 'mock-current',
    children: [el('span', { text: 'current: ' }), el('code', { text: m.value ?? '(none)' })],
  });
  const instruction = el('textarea', {
    class: 'refine-input',
    attrs: {
      placeholder: 'e.g. "return a 401 response" or "drop the mock, follow real code"',
      rows: '2',
    },
  });
  const pending = snapshot.trace.refinementInFlight === m.id;
  const submit = el('button', {
    class: 'primary',
    text: pending ? 'Refining…' : 'Apply',
    attrs: pending ? { disabled: 'true' } : {},
    onClick: () => {
      const value = instruction.value.trim();
      if (!value) return;
      vscode.postMessage({
        type: 'refineMock',
        perspectiveId: snapshot.perspective.id,
        mockId: m.id,
        instruction: value,
      });
    },
  });
  row.append(
    currentValue,
    el('div', { class: 'mock-file', text: `defined in ${m.file}` }),
    instruction,
    el('div', { class: 'refine-actions', children: [submit] }),
  );
  return row;
}

// ---------- bottom-left pane: Chat (stacked, foldable) ----------

function buildBottomLeftPane(): HTMLElement {
  const pane = el('div', { class: 'pane pane-bottomleft' });
  pane.append(
    el('div', {
      class: 'pane-header',
      children: [
        el('span', { class: 'pane-title', text: 'Chat' }),
        el('span', {
          class: 'pane-subtitle',
          text: buildChatSubtitle(),
        }),
      ],
    }),
  );
  pane.append(buildChatBody());
  pane.append(buildComposer());
  return pane;
}

function buildChatSubtitle(): string {
  if (topTab === 'trace') return 'Trace context · new threads fork the flow session';
  return 'Summary context · new threads fork the summary session';
}

function buildChatBody(): HTMLElement {
  const body = el('div', { class: 'chat-body' });
  if (snapshot.sections.length === 0) {
    body.append(
      el('p', {
        class: 'chat-empty',
        text:
          'Ask about this perspective — type below to send to the current tab\'s context, or drag-select any prose (chat, summary, code) and hit Send to include it as a quote.',
      }),
    );
    return body;
  }
  const stack = el('div', { class: 'chat-stack' });
  for (const s of snapshot.sections) stack.append(buildConversation(s));
  body.append(stack);
  return body;
}

function buildConversation(section: QaSection): HTMLElement {
  const collapsed = collapsedSections.has(section.sectionId);
  const originLabel: 'trace' | 'summary' =
    section.forkOrigin === 'flow' ? 'trace' : 'summary';
  const previewText =
    section.turns[0]?.question.slice(0, 90) ??
    section.contextRef?.selection.slice(0, 70) ??
    '(new question)';
  const chevron = collapsed ? '▸' : '▾';
  const header = el('div', {
    class: 'conv-header',
    onClick: () => {
      if (collapsed) collapsedSections.delete(section.sectionId);
      else collapsedSections.add(section.sectionId);
      render();
    },
    children: [
      el('span', { class: 'conv-chevron', text: chevron }),
      el('span', {
        class: `conv-origin origin-${originLabel}`,
        text: originLabel,
        attrs: {
          title:
            originLabel === 'trace'
              ? 'Started from the Trace tab — the LLM sees the flow, blocks, and mocks.'
              : 'Started from the Summary tab — the LLM sees the summary.',
        },
      }),
      el('span', { class: 'conv-preview', text: previewText }),
      el('span', {
        class: 'conv-turn-count',
        text: `${section.turns.length} turn${section.turns.length === 1 ? '' : 's'}`,
      }),
      el('button', {
        class: 'conv-delete',
        text: '×',
        attrs: { title: 'Delete this conversation' },
        onClick: (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'deleteSection',
            perspectiveId: snapshot.perspective.id,
            sectionId: section.sectionId,
          });
        },
      }),
    ],
  });
  if (collapsed) return el('section', { class: 'conv folded', children: [header] });

  const body = el('div', { class: 'conv-body' });
  if (section.contextRef) {
    body.append(
      el('blockquote', {
        class: 'conv-context',
        children: [
          section.contextRef.file
            ? el('div', {
                class: 'conv-context-locator',
                text: `${section.contextRef.file}:${section.contextRef.startLine ?? '?'}`,
              })
            : el('div'),
          el('div', {
            class: 'conv-context-text',
            text: section.contextRef.selection.slice(0, 400),
          }),
        ],
      }),
    );
  }
  for (const turn of section.turns) {
    body.append(
      el('div', {
        class: 'turn',
        children: [
          el('div', { class: 'turn-q', text: turn.question }),
          el('div', { class: 'turn-a', html: renderMarkdown(turn.answer) }),
        ],
      }),
    );
  }
  const followInput = el('textarea', {
    class: 'follow-input',
    attrs: { placeholder: 'Follow up… (Enter to send, Shift+Enter for newline)', rows: '1' },
  });
  const sendFollow = (): void => {
    const value = followInput.value.trim();
    if (!value) return;
    vscode.postMessage({
      type: 'followUp',
      perspectiveId: snapshot.perspective.id,
      sectionId: section.sectionId,
      question: value,
    });
    followInput.value = '';
  };
  followInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendFollow();
    }
  });
  const followBtn = el('button', {
    class: 'primary follow-btn',
    text: 'Send',
    attrs: { title: 'Send (Enter)' },
    onClick: sendFollow,
  });
  body.append(el('div', { class: 'follow-row', children: [followInput, followBtn] }));
  return el('section', { class: 'conv', children: [header, body] });
}

function buildComposer(): HTMLElement {
  const wrap = el('div', { class: 'composer' });
  const chip = el('div', {
    class: 'context-chip',
    attrs: { id: 'context-chip' },
  });
  const textarea = el('textarea', {
    class: 'composer-input',
    attrs: {
      id: 'composer-input',
      placeholder:
        'New conversation… (drag-select prose/code first to cite it; Enter sends, Shift+Enter for newline)',
      rows: '2',
    },
  });
  textarea.value = composerDraft;
  // Enter sends, Shift+Enter inserts a newline — matches chat convention.
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitComposer(textarea);
    }
  });
  const submit = el('button', {
    class: 'primary composer-send',
    text: 'Send',
    attrs: { title: 'Send (Enter)' },
    onClick: () => submitComposer(textarea),
  });
  // Input row: textarea flexes, Send pinned to its right edge.
  wrap.append(chip, el('div', { class: 'composer-input-row', children: [textarea, submit] }));
  refreshSelectionChipIn(chip);
  return wrap;
}

function submitComposer(textarea: HTMLTextAreaElement): void {
  const value = textarea.value.trim();
  if (!value && !selectionContext) return;
  // Auto-cite: prepend the drag-selected quote as a markdown blockquote.
  const question = selectionContext
    ? `${quoteBlock(selectionContext)}\n\n${value || 'Explain this in context.'}`
    : value;
  const forkOrigin: ForkOrigin =
    selectionContext?.origin ?? (topTab === 'trace' ? 'flow' : 'summary');
  const contextRef = selectionContext
    ? {
        selection: selectionContext.selection,
        ...(selectionContext.file ? { file: selectionContext.file } : {}),
        ...(selectionContext.startLine !== undefined
          ? { startLine: selectionContext.startLine }
          : {}),
        ...(selectionContext.endLine !== undefined ? { endLine: selectionContext.endLine } : {}),
      }
    : undefined;
  vscode.postMessage({
    type: 'ask',
    perspectiveId: snapshot.perspective.id,
    question,
    context: contextRef,
    forkOrigin,
  });
  textarea.value = '';
  composerDraft = '';
  clearCitation();
}

function quoteBlock(ctx: SelectionContext): string {
  const locator = ctx.file
    ? ctx.endLine && ctx.endLine !== ctx.startLine
      ? `${ctx.file}:${ctx.startLine}-${ctx.endLine}`
      : `${ctx.file}${ctx.startLine !== undefined ? ':' + ctx.startLine : ''}`
    : undefined;
  const header = locator ? `> **From ${locator}**\n> \n` : '';
  const quoted = ctx.selection
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return `${header}${quoted}`;
}

function refreshSelectionChip(): void {
  const chip = document.getElementById('context-chip');
  if (chip) refreshSelectionChipIn(chip);
}

function refreshSelectionChipIn(chip: HTMLElement): void {
  empty(chip);
  if (!selectionContext) {
    chip.style.display = 'none';
    return;
  }
  // Same shape as a folded conversation header — origin badge / locator /
  // preview / × — rendered denser to signal "pending, not yet sent".
  chip.style.display = 'grid';
  const originLabel: 'trace' | 'summary' =
    selectionContext.origin === 'flow' ? 'trace' : 'summary';
  const locator = selectionContext.file
    ? selectionContext.endLine && selectionContext.endLine !== selectionContext.startLine
      ? `${selectionContext.file}:${selectionContext.startLine}-${selectionContext.endLine}`
      : `${selectionContext.file}${selectionContext.startLine !== undefined ? ':' + selectionContext.startLine : ''}`
    : undefined;
  const previewSource = selectionContext.selection.replace(/\s+/g, ' ').trim();
  const preview =
    previewSource.length > 120 ? previewSource.slice(0, 118) + '…' : previewSource;
  chip.append(
    el('span', {
      class: `conv-origin origin-${originLabel}`,
      text: originLabel,
      attrs: {
        title:
          originLabel === 'trace'
            ? 'Will fork the Trace / flow session'
            : 'Will fork the Summary session',
      },
    }),
    locator
      ? el('span', { class: 'context-locator', text: locator })
      : el('span', { class: 'context-quote', text: '>' }),
    el('span', { class: 'context-preview', text: preview }),
    el('button', {
      class: 'context-clear',
      text: '×',
      attrs: { title: 'Remove citation' },
      onClick: () => clearCitation(),
    }),
  );
}

// ---------- selection capture (drag anywhere in the panel) ----------

/**
 * Runs once per render but uses `document`-level listeners so it doesn't
 * duplicate handlers when the DOM redraws. Selections are classified by the
 * ancestor element they land in — code cells (Trace right pane) or flow-list
 * rows contribute a file/line locator, and the origin drives the fork.
 */
let selectionCaptureInstalled = false;
function installGlobalSelectionCapture(): void {
  if (selectionCaptureInstalled) return;
  selectionCaptureInstalled = true;

  document.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;

    // Ignore selections inside the composer or existing turn-body inputs.
    const anchor = (sel.anchorNode?.parentElement ?? sel.anchorNode) as HTMLElement | null;
    if (!anchor) return;
    if (anchor.closest('.composer, .follow-row, textarea, input')) return;

    // Decide origin + locator by the DOM area the selection lives in.
    const codeCell = anchor.closest('tr.code-line');
    const flowRow = anchor.closest('.flow-list-row') as HTMLElement | null;
    const traceArea = anchor.closest('.pane-topleft .trace-left, .pane-right.trace, .code-wrap');
    const summaryArea = anchor.closest('.pane-right.summary');

    let ctx: SelectionContext | undefined;

    if (codeCell) {
      // Prefer the inner .gutter-line span (added when the focal marker landed
      // in the gutter cell); fall back to the cell's textContent for rows
      // without a marker where the cell has only the number.
      const gutterCell = codeCell.querySelector('.gutter');
      const lineText =
        gutterCell?.querySelector('.gutter-line')?.textContent ?? gutterCell?.textContent ?? '';
      const ln = Number(lineText) || undefined;
      const block =
        snapshot.flow && snapshot.trace
          ? blockAtPath(snapshot.flow.blocks, snapshot.trace.cursor)
          : undefined;
      if (block) {
        ctx = {
          selection: text,
          file: block.focus.file,
          ...(ln !== undefined ? { startLine: ln, endLine: ln } : {}),
          origin: 'flow',
        };
      } else {
        ctx = { selection: text, origin: 'flow' };
      }
    } else if (flowRow) {
      const blockId = flowRow.dataset['blockId'];
      const block = snapshot.flow && blockId ? findBlock(snapshot.flow.blocks, blockId) : undefined;
      ctx = block
        ? {
            selection: text,
            file: block.focus.file,
            startLine: block.focus.startLine,
            endLine: block.focus.endLine,
            origin: 'flow',
          }
        : { selection: text, origin: 'flow' };
    } else if (traceArea) {
      ctx = { selection: text, origin: 'flow' };
    } else if (summaryArea) {
      ctx = { selection: text, origin: 'summary' };
    } else {
      // Anything else (e.g. chat turn body) — fall back to the current top tab.
      ctx = { selection: text, origin: topTab === 'trace' ? 'flow' : 'summary' };
    }

    selectionContext = ctx;
    setCitationHighlight(sel.getRangeAt(0).cloneRange());
    refreshSelectionChip();
    // Nudge focus into the composer so the reviewer can just start typing.
    // This collapses `sel`, which is why the highlight was captured first.
    const ta = document.getElementById('composer-input') as HTMLTextAreaElement | null;
    ta?.focus();
  });
}

// ---------- right pane ----------

function buildRightPane(): HTMLElement {
  const pane = el('div', { class: `pane pane-right ${topTab === 'trace' ? 'trace' : 'summary'}` });
  if (topTab === 'summary') buildRightSummary(pane);
  else buildRightTrace(pane);
  return pane;
}

// ---------- right pane: Summary ----------

function buildRightSummary(pane: HTMLElement): void {
  pane.append(buildSummaryHeader());
  if (!snapshot.summary) {
    pane.append(buildLoadingBlock(snapshot.loading.summary, 'Summarising the perspective'));
    return;
  }
  pane.append(buildOutcomeCard(snapshot.summary));
  for (const v of snapshot.summary.summary.visuals) {
    pane.append(buildVisualCard(v));
  }
  const files = buildFilesTouchedCard(snapshot.perspective, snapshot.flow);
  if (files) pane.append(files);
  if (snapshot.summary.summary.watchFor.length > 0) {
    pane.append(buildWatchForCard(snapshot.summary));
  }
  if (snapshot.summary.summary.tests.length > 0) {
    pane.append(buildTestsCard(snapshot.summary));
  }
  // The Flow strip that used to live here moves into the Trace tab — the
  // right-pane summary no longer duplicates it.
}

/**
 * Title only. The perspective's own one-liner used to sit here, but the
 * Outcome card restates the same sentence — the summary prompt is told to
 * refine that very line — so the header would say it twice.
 */
function buildSummaryHeader(): HTMLElement {
  const p = snapshot.perspective;
  return el('header', {
    class: 'summary-header',
    children: [
      el('div', {
        class: 'title-row',
        children: [
          el('h1', { text: p.title }),
          kindChip(p.kind),
        ],
      }),
    ],
  });
}

function buildOutcomeCard(payload: SummaryPayload): HTMLElement {
  return el('section', {
    class: 'card outcome-card',
    children: [
      el('h3', { text: 'Outcome' }),
      el('p', { class: 'outcome-text', text: payload.summary.outcome }),
    ],
  });
}

/**
 * One figure the LLM chose to include. The kind decides the renderer;
 * mermaid loads on demand (no diagram, no mermaid chunk fetched) and any
 * mermaid parse/render error falls back to the raw source in a <pre> so a
 * broken figure never blanks the summary. Non-mermaid kinds render as a
 * <pre>; diff and code go through highlight.js.
 */
function buildVisualCard(visual: SummaryVisual): HTMLElement {
  const kind = visual.kind as SummaryVisual['kind'] | string;
  const host = el('div', { class: `visual-host visual-host-${kind}` });
  switch (visual.kind) {
    case 'mermaid': {
      host.append(el('div', { class: 'visual-loading muted', text: 'Rendering diagram…' }));
      void renderMermaidInto(host, visual.source);
      break;
    }
    case 'diff': {
      host.append(buildHighlightedBlock(visual.source, 'diff'));
      break;
    }
    case 'code': {
      host.append(buildHighlightedBlock(visual.source, visual.language ?? undefined));
      break;
    }
    case 'pseudocode':
    case 'call-tree':
    case 'component-tree':
    case 'file-tree': {
      host.append(el('pre', { class: 'visual-plain', text: visual.source }));
      break;
    }
    default: {
      // core sanitizes unknown kinds out of the payload, but keep a UI-side
      // safety net so a stray value still renders as raw text instead of an
      // empty box with only a caption underneath it.
      host.append(el('pre', { class: 'visual-plain', text: (visual as { source?: string }).source ?? '' }));
    }
  }
  return el('section', {
    class: `card visual-card visual-card-${kind}`,
    children: [
      el('h3', { text: visualCardHeading(kind) }),
      host,
      el('p', { class: 'visual-caption muted', text: visual.caption }),
    ],
  });
}

function visualCardHeading(kind: SummaryVisual['kind'] | string): string {
  switch (kind) {
    case 'mermaid':        return 'Diagram';
    case 'diff':           return 'Change';
    case 'code':           return 'Code';
    case 'pseudocode':     return 'Pseudocode';
    case 'call-tree':      return 'Call tree';
    case 'component-tree': return 'Component tree';
    case 'file-tree':      return 'File tree';
    default:               return 'Visual';
  }
}

function buildHighlightedBlock(source: string, language: string | undefined): HTMLElement {
  const pre = el('pre', { class: 'visual-plain visual-highlight' });
  for (const line of source.split('\n')) {
    const html = highlightLine(line, language);
    pre.append(el('span', { class: 'code-line', html: html || '&nbsp;' }));
  }
  return pre;
}

// VSCode webviews stamp `vscode-dark` / `vscode-high-contrast` (or `-light`)
// on <body>; mermaid's built-in themes assume a fixed background so we pick
// the closest match and rebind the colours it uses for labels and edges to
// the editor's foreground token, otherwise dark-on-dark labels sink into the
// pane background.
function detectVscodeTheme(): 'dark' | 'light' {
  const cls = document.body.classList;
  if (cls.contains('vscode-high-contrast-light')) return 'light';
  if (cls.contains('vscode-high-contrast')) return 'dark';
  if (cls.contains('vscode-dark')) return 'dark';
  return 'light';
}

function mermaidThemeConfig(): Parameters<
  typeof import('mermaid').default.initialize
>[0] {
  const kind = detectVscodeTheme();
  const base = kind === 'dark' ? '#1e1e1e' : '#ffffff';
  const fg = kind === 'dark' ? '#d4d4d4' : '#1e1e1e';
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: kind === 'dark' ? 'dark' : 'default',
    themeVariables: {
      background: base,
      textColor: fg,
      lineColor: fg,
      nodeTextColor: fg,
      labelTextColor: fg,
      titleColor: fg,
    },
  };
}

let mermaidLoader: Promise<typeof import('mermaid').default> | undefined;
let mermaidLoadedTheme: 'dark' | 'light' | undefined;
function loadMermaid(): Promise<typeof import('mermaid').default> {
  const theme = detectVscodeTheme();
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize(mermaidThemeConfig());
      mermaidLoadedTheme = theme;
      return mermaid;
    });
    return mermaidLoader;
  }
  if (mermaidLoadedTheme !== theme) {
    mermaidLoader = mermaidLoader.then((mermaid) => {
      mermaid.initialize(mermaidThemeConfig());
      mermaidLoadedTheme = theme;
      return mermaid;
    });
  }
  return mermaidLoader;
}

let mermaidRenderCounter = 0;
async function renderMermaidInto(host: HTMLElement, source: string): Promise<void> {
  try {
    const mermaid = await loadMermaid();
    const id = `sdt-mermaid-${++mermaidRenderCounter}`;
    const { svg } = await mermaid.render(id, source);
    empty(host);
    host.innerHTML = svg;
  } catch (e) {
    empty(host);
    host.append(
      el('div', {
        class: 'visual-error muted',
        text: `Could not render diagram (${e instanceof Error ? e.message : String(e)}). Raw source:`,
      }),
      el('pre', { class: 'visual-fallback', text: source }),
    );
  }
}

function buildFilesTouchedCard(
  p: PerspectiveDraft,
  flow: Flow | undefined,
): HTMLElement | null {
  const counts = new Map<string, number>();
  if (flow) {
    const walk = (blocks: FlowBlock[]): void => {
      for (const b of blocks) {
        counts.set(b.focus.file, (counts.get(b.focus.file) ?? 0) + 1);
        walk(b.children);
      }
    };
    walk(flow.blocks);
  } else {
    for (const f of p.primaryFiles) counts.set(f, 1);
  }
  const files = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (files.length === 0) return null;
  const max = files[0]![1];
  const list = el('ul', { class: 'files-touched' });
  for (const [pathStr, c] of files) {
    list.append(
      el('li', {
        class: 'file-row',
        children: [
          el('span', {
            class: 'file-bar',
            attrs: { style: `--w: ${Math.max(6, Math.round((c / max) * 100))}%` },
          }),
          el('span', {
            class: 'file-count',
            text: flow ? `${c} block${c === 1 ? '' : 's'}` : '',
          }),
          el('code', { class: 'file-path', text: pathStr }),
        ],
      }),
    );
  }
  return el('section', {
    class: 'card files-touched-card',
    children: [el('h3', { text: 'Files touched' }), list],
  });
}

function buildWatchForCard(payload: SummaryPayload): HTMLElement {
  return el('section', {
    class: 'card',
    children: [
      el('h3', { text: 'Watch-for' }),
      el('ul', {
        class: 'watch-list',
        children: payload.summary.watchFor.map((w) =>
          el('li', {
            class: 'watch-item',
            children: [
              el('span', { class: 'watch-note', text: w.note }),
              w.anchor ? buildAnchorChip(w.anchor.file, w.anchor.line) : el('span'),
            ],
          }),
        ),
      }),
    ],
  });
}

function buildTestsCard(payload: SummaryPayload): HTMLElement {
  return el('section', {
    class: 'card',
    children: [
      el('h3', { text: 'Tests' }),
      el('ul', {
        class: 'test-list',
        children: payload.summary.tests.map((t) =>
          el('li', {
            class: 'test-item',
            children: [
              el('span', { class: 'test-desc', text: t.description }),
              buildAnchorChip(t.file, t.line),
            ],
          }),
        ),
      }),
    ],
  });
}

/** Clickable `file:line` locator. Always the trailing element of its row. */
function buildAnchorChip(file: string, line: number): HTMLElement {
  return el('code', {
    class: 'anchor-chip clickable',
    text: formatAnchor(file, line),
    attrs: { title: `Open ${file}:${line}` },
    onClick: () => vscode.postMessage({ type: 'openFile', file, line }),
  });
}

// ---------- right pane: Trace (code view) ----------

function buildRightTrace(pane: HTMLElement): void {
  if (!snapshot.flow) {
    const wrap = el('div', { class: 'loading-center' });
    wrap.append(buildLoadingBlock(snapshot.loading.flow, 'Planning the flow'));
    pane.append(wrap);
    return;
  }
  const block = blockAtPath(snapshot.flow.blocks, snapshot.trace.cursor);
  if (!block) {
    pane.append(el('div', { class: 'loading center', text: 'End of flow.' }));
    return;
  }
  const side = pickSide(block);
  pane.append(buildCodeHeader(block, side));
  if (side === 'after') {
    const banner = buildOffFileChildBanner(block);
    if (banner) pane.append(banner);
  }
  pane.append(buildCodeView(block, side));
}

function pickSide(block: FlowBlock): CodeSide {
  const stored = preferredSide.get(block.id);
  if (stored) {
    if (stored === 'before' && !block.beforeFocus) return 'after';
    return stored;
  }
  if (block.role === 'removed' && block.beforeFocus) return 'before';
  return 'after';
}

function buildOffFileChildBanner(block: FlowBlock): HTMLElement | null {
  const off = block.children
    .map((c, i) => ({ child: c, order: i + 1 }))
    .filter((x) => x.child.focus.file !== block.focus.file);
  if (off.length === 0) return null;
  const banner = el('div', {
    class: 'off-file-banner',
    children: [el('span', { class: 'off-file-label', text: 'Step In (other files):' })],
  });
  for (const { child, order } of off) {
    banner.append(
      el('button', {
        class: 'off-file-chip',
        text: `${order}. ${child.title}`,
        attrs: {
          title: `Jump into child ${order}: "${child.title}" (${child.focus.file}:${child.focus.startLine})`,
        },
        onClick: () =>
          vscode.postMessage({
            type: 'goto',
            perspectiveId: snapshot.perspective.id,
            blockId: child.id,
          }),
      }),
    );
  }
  return banner;
}

function buildCodeHeader(block: FlowBlock, side: CodeSide): HTMLElement {
  const location =
    side === 'before' && block.beforeFocus
      ? `${block.beforeFocus.file}:${block.beforeFocus.startLine}-${block.beforeFocus.endLine}`
      : `${block.focus.file}:${block.focus.startLine}-${block.focus.endLine}`;
  const beforeAvailable = !!block.beforeFocus;
  const beforeBtn = el('button', {
    class: `seg-btn ${side === 'before' ? 'active' : ''}${beforeAvailable ? '' : ' disabled'}`,
    text: 'Before',
    attrs: beforeAvailable
      ? { title: 'Show the pre-merge code for this block.' }
      : {
          title: 'No before-side range for this block (added or context-only).',
          disabled: 'true',
        },
    onClick: () => {
      if (!beforeAvailable) return;
      preferredSide.set(block.id, 'before');
      render();
    },
  });
  const afterBtn = el('button', {
    class: `seg-btn ${side === 'after' ? 'active' : ''}`,
    text: 'After',
    attrs: { title: 'Show the post-merge code for this block.' },
    onClick: () => {
      preferredSide.set(block.id, 'after');
      render();
    },
  });
  return el('header', {
    class: 'code-header',
    children: [
      el('div', {
        class: 'code-header-left',
        children: [
          el('div', { class: 'seg-control', children: [beforeBtn, afterBtn] }),
          el('code', { class: 'code-file', text: location }),
          el('span', {
            class: `role-badge role-${block.role ?? 'unchanged'}`,
            text: block.role ?? 'unchanged',
          }),
        ],
      }),
      el('div', {
        class: 'code-header-actions',
        children: [
          el('button', {
            class: 'ghost',
            text: 'Open diff',
            attrs: { title: 'Open the PR diff (base ↔ head) for this file' },
            // Always the after-side file: the diff shows both sides anyway, and
            // its line numbers follow the head, which is what `focus` carries.
            onClick: () =>
              vscode.postMessage({
                type: 'openDiff',
                file: block.focus.file,
                line: block.focus.startLine,
              }),
          }),
          el('button', {
            class: 'ghost',
            text: 'Open in editor',
            attrs: { title: 'Open the working-tree file' },
            onClick: () => {
              const target =
                side === 'before' && block.beforeFocus ? block.beforeFocus : block.focus;
              vscode.postMessage({
                type: 'openFile',
                file: target.file,
                line: target.startLine,
              });
            },
          }),
        ],
      }),
    ],
  });
}

const CONTEXT_LINES = 40;

interface StepInMark {
  child: FlowBlock;
  order: number;
  startLine: number;
  endLine: number;
}

interface StepOverNeighbour {
  block: FlowBlock;
  role: 'prev' | 'next';
  startLine: number;
  endLine: number;
}

function buildCodeView(block: FlowBlock, side: CodeSide): HTMLElement {
  const isBefore = side === 'before' && !!block.beforeFocus;
  const target = isBefore ? block.beforeFocus! : block.focus;
  const source = isBefore
    ? (snapshot.trace.fullBeforeCodeByFile[target.file] ?? block.beforeCode ?? '').split('\n')
    : (snapshot.trace.fullCodeByFile[target.file] ?? block.code).split('\n');
  const language = languageForFile(target.file);

  const sameFileChildren: StepInMark[] = [];
  if (!isBefore) {
    block.children.forEach((c, i) => {
      if (c.focus.file !== block.focus.file) return;
      sameFileChildren.push({
        child: c,
        order: i + 1,
        startLine: c.focus.startLine,
        endLine: c.focus.endLine,
      });
    });
  }
  const stepOverNeighbours = !isBefore ? findStepOverNeighbours(block) : [];

  const focusLines = [target.startLine, target.endLine];
  for (const m of sameFileChildren) focusLines.push(m.startLine, m.endLine);
  for (const n of stepOverNeighbours) focusLines.push(n.startLine, n.endLine);
  const start = Math.max(1, Math.min(...focusLines) - CONTEXT_LINES);
  const end = Math.min(source.length, Math.max(...focusLines) + CONTEXT_LINES);

  const rows: Node[] = [];
  for (let ln = start; ln <= end; ln++) {
    const isFocus = ln >= target.startLine && ln <= target.endLine;
    const marks = sameFileChildren.filter((m) => ln >= m.startLine && ln <= m.endLine);
    const startingHere = sameFileChildren.filter((m) => m.startLine === ln);
    const overlappingNeighbours = stepOverNeighbours.filter(
      (n) => ln >= n.startLine && ln <= n.endLine,
    );
    // Neighbour badges land on the sibling block's own startLine.
    const neighboursStartingHere = stepOverNeighbours.filter((n) => n.startLine === ln);
    const raw = source[ln - 1] ?? '';
    const highlighted = highlightLine(raw, language);
    const classes = ['code-line'];
    if (isFocus) classes.push(isBefore ? 'focus-before' : 'focus');
    if (marks.length > 0) classes.push('step-in-range');
    if (startingHere.length > 0) classes.push('step-in-start');
    for (const n of overlappingNeighbours) classes.push(`step-over-${n.role}`);
    // Focal marker sits on the block's post-merge startLine only, so scrolling
    // the CodeView never turns into a vertical parade of icons. Skip in Before
    // view — the marker anchors to the after-side line the LLM tagged.
    const focalHere = !isBefore && block.focal && ln === target.startLine ? block.focal : null;
    if (focalHere) classes.push('focal-line', `focal-${focalHere.kind}`);

    const cellChildren: Node[] = [
      el('span', { class: 'code-cell-source', html: highlighted || '&nbsp;' }),
    ];
    if (startingHere.length > 0 || neighboursStartingHere.length > 0) {
      const badges = el('span', { class: 'step-in-badges' });
      for (const m of startingHere) {
        badges.append(
          el('button', {
            class: 'step-in-badge',
            text: `↳ Step In ${m.order}: ${m.child.title}`,
            attrs: {
              title: `Jump into child ${m.order}: "${m.child.title}" (${m.child.focus.file}:${m.startLine})`,
            },
            onClick: (e) => {
              e.stopPropagation();
              vscode.postMessage({
                type: 'goto',
                perspectiveId: snapshot.perspective.id,
                blockId: m.child.id,
              });
            },
          }),
        );
      }
      for (const n of neighboursStartingHere) {
        const globalIdx = snapshot.flow
          ? findFlowIndex(snapshot.flow.blocks, n.block.id)
          : undefined;
        const num = globalIdx !== undefined ? `${globalIdx}. ` : '';
        const arrow = n.role === 'prev' ? '◁' : '▷';
        const label =
          n.role === 'prev'
            ? `${arrow} Step ${num}${n.block.title}`
            : `${num}${n.block.title} ${arrow}`;
        badges.append(
          el('button', {
            class: `step-over-badge step-over-badge-${n.role}`,
            text: label,
            attrs: {
              title:
                n.role === 'prev'
                  ? `Previous sibling · ${n.block.title} (${n.block.focus.file}:${n.startLine})`
                  : `Next sibling · ${n.block.title} (${n.block.focus.file}:${n.startLine})`,
            },
            onClick: (e) => {
              e.stopPropagation();
              vscode.postMessage({
                type: 'goto',
                perspectiveId: snapshot.perspective.id,
                blockId: n.block.id,
              });
            },
          }),
        );
      }
      cellChildren.push(badges);
    }
    const gutterChildren: Node[] = [];
    if (focalHere) {
      gutterChildren.push(
        el('i', {
          class: `codicon codicon-${FOCAL_CODICON[focalHere.kind]} focal-gutter-icon`,
          attrs: { title: `Focal · ${FOCAL_LABEL[focalHere.kind]} — ${focalHere.reason}` },
        }),
      );
    }
    gutterChildren.push(el('span', { class: 'gutter-line', text: String(ln) }));
    rows.push(
      el('tr', {
        class: classes.join(' '),
        children: [
          el('td', { class: 'gutter', children: gutterChildren }),
          el('td', {
            class: 'code-cell',
            children: [el('div', { class: 'code-cell-inner', children: cellChildren })],
          }),
        ],
      }),
    );
  }
  const table = el('table', {
    class: 'code-table hljs',
    children: [el('tbody', { children: rows })],
  });
  const wrap = el('div', { class: 'code-wrap', children: [table] });
  requestAnimationFrame(() => {
    const focusRow = table.querySelector('tr.focus, tr.focus-before') as HTMLTableRowElement | null;
    if (!focusRow) return;
    // Scroll happens inside .code-wrap now (see CSS: pane no longer scrolls
    // horizontally). Keep scrollLeft at 0 so the reader always sees the line
    // numbers, even when a prior view left the container scrolled right.
    wrap.scrollTop = focusRow.offsetTop - wrap.clientHeight / 3;
    wrap.scrollLeft = 0;
  });
  return wrap;
}

function findStepOverNeighbours(block: FlowBlock): StepOverNeighbour[] {
  const out: StepOverNeighbour[] = [];
  if (!snapshot.flow) return out;
  const path = snapshot.trace.cursor;
  if (path.length === 0) return out;
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1]!;
  const siblings =
    parentPath.length === 0
      ? snapshot.flow.blocks
      : (blockAtPath(snapshot.flow.blocks, parentPath)?.children ?? []);
  const prev = siblings[idx - 1];
  const next = siblings[idx + 1];
  if (prev && prev.focus.file === block.focus.file) {
    out.push({
      block: prev,
      role: 'prev',
      startLine: prev.focus.startLine,
      endLine: prev.focus.endLine,
    });
  }
  if (next && next.focus.file === block.focus.file) {
    out.push({
      block: next,
      role: 'next',
      startLine: next.focus.startLine,
      endLine: next.focus.endLine,
    });
  }
  return out;
}

// ---------- helpers ----------

function blockAtPath(blocks: FlowBlock[], path: BlockPath): FlowBlock | undefined {
  let siblings = blocks;
  let node: FlowBlock | undefined;
  for (const idx of path) {
    node = siblings[idx];
    if (!node) return undefined;
    siblings = node.children;
  }
  return node;
}

function findBlock(blocks: FlowBlock[], id: string): FlowBlock | undefined {
  for (const b of blocks) {
    if (b.id === id) return b;
    const nested = findBlock(b.children, id);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * DFS index of `id` in the flow (1-based). Matches the numbering the flow
 * list on the left shows, so a badge saying "N" points at row N over there.
 */
function findFlowIndex(blocks: FlowBlock[], id: string): number | undefined {
  let counter = 0;
  const walk = (nodes: FlowBlock[]): number | undefined => {
    for (const b of nodes) {
      counter += 1;
      if (b.id === id) return counter;
      const nested = walk(b.children);
      if (nested !== undefined) return nested;
    }
    return undefined;
  };
  return walk(blocks);
}

// ---------- styles ----------

function installStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    ${flowListCss()}
    ${highlightCss()}

    html, body { height: 100%; margin: 0; }
    body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    #root { height: 100%; }

    /* Small nudge to the selection colour so drag-highlighting is visible
       even on top of the code-line focus tint. */
    ::selection {
      background: var(--vscode-editor-selectionBackground, rgba(55, 148, 255, 0.4));
      color: var(--vscode-editor-selectionForeground, inherit);
    }

    /* The pending citation, kept visible after focus moves to the composer. */
    ::highlight(sdt-citation) {
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 30%, transparent);
      text-decoration: underline;
      text-decoration-color: var(--vscode-textLink-foreground);
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
    }

    /* -------- shell: 3-row × 3-col grid with draggable dividers --------
       Summary tab pins the top-left tiny so Chat takes the rest; Trace tab
       has JS override grid-template-rows to whatever the user dragged to.
       Both tabs let JS drive grid-template-columns via the column splitter. */
    .shell {
      display: grid;
      grid-template-columns: 40% 6px calc(60% - 6px); /* JS overrides */
      grid-template-rows: 0fr 0fr 1fr;                /* JS overrides on Trace */
      grid-template-areas:
        "topleft    col-splitter right"
        "row-splitter col-splitter right"
        "bottomleft col-splitter right";
      height: 100%;
      background: var(--vscode-editorWidget-border, #333);
    }
    .shell.topTab-summary {
      /* Summary side has no top-left content — pin it to the tabs strip so
         the Chat can eat the whole column. Splitter row collapses to zero. */
      grid-template-rows: auto 0 1fr;
    }
    .shell.topTab-trace {
      /* Default Trace split; JS overrides once the user drags. */
      grid-template-rows: 55% 6px calc(45% - 6px);
    }
    .pane { background: var(--vscode-editor-background); min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
    .pane-topleft    { grid-area: topleft; }
    .pane-bottomleft { grid-area: bottomleft; }
    .pane-right      { grid-area: right; overflow: auto; padding: 0; }
    .pane-right.summary { padding: 0.6rem 0.7rem; gap: 0.5rem; }
    /* Trace-side owns its own header + code scroll container, so the pane
       itself only stacks them; horizontal scrolling belongs to .code-wrap
       (a long code line must not push the header out of view sideways). */
    .pane-right.trace   { padding: 0; overflow: hidden; }

    /* Row splitter — only interactive on Trace tab. */
    .row-splitter {
      grid-area: row-splitter;
      align-self: stretch;
      justify-self: stretch;
      background: transparent;
      cursor: row-resize;
      position: relative;
      z-index: 3;
    }
    .row-splitter::after {
      content: '';
      position: absolute; left: 0; right: 0;
      top: 2px; height: 2px;
      background: var(--vscode-editorWidget-border, #444);
      transition: background 120ms ease, height 120ms ease;
    }
    .row-splitter:hover::after,
    .row-splitter:focus::after,
    body.row-splitter-dragging .row-splitter::after {
      background: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
      height: 3px; top: 1px;
    }
    .row-splitter.disabled {
      cursor: default;
      display: none;
    }
    .row-splitter:focus { outline: none; }
    body.row-splitter-dragging { cursor: row-resize; user-select: none; }
    body.row-splitter-dragging iframe { pointer-events: none; }

    /* Column splitter — always interactive. */
    .col-splitter {
      grid-area: col-splitter;
      align-self: stretch;
      justify-self: stretch;
      background: transparent;
      cursor: col-resize;
      position: relative;
      z-index: 3;
    }
    .col-splitter::after {
      content: '';
      position: absolute; top: 0; bottom: 0;
      left: 2px; width: 2px;
      background: var(--vscode-editorWidget-border, #444);
      transition: background 120ms ease, width 120ms ease;
    }
    .col-splitter:hover::after,
    .col-splitter:focus::after,
    body.col-splitter-dragging .col-splitter::after {
      background: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
      width: 3px; left: 1.5px;
    }
    .col-splitter:focus { outline: none; }
    body.col-splitter-dragging { cursor: col-resize; user-select: none; }
    body.col-splitter-dragging iframe { pointer-events: none; }

    /* -------- tabs (top + nested Trace tabs) -------- */
    .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-editorWidget-border, #444); padding: 0.2rem 0.4rem 0; flex-shrink: 0; }
    .tab { background: transparent; color: var(--vscode-descriptionForeground); padding: 0.25rem 0.65rem; border-radius: 4px 4px 0 0; font-size: 0.8rem; border: 0; cursor: pointer; font-family: inherit; }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active { background: var(--vscode-tab-activeBackground, var(--vscode-editor-background)); color: var(--vscode-tab-activeForeground, var(--vscode-foreground)); border-bottom: 2px solid var(--vscode-textLink-foreground); }
    .top-tabs { padding-top: 0.25rem; }
    .sub-tabs { padding-top: 0.15rem; border-bottom-width: 1px; }
    .tab-body { flex: 1; overflow: auto; min-height: 0; padding: 0.4rem 0.55rem; }

    /* -------- Summary left (mostly empty on purpose) -------- */
    .summary-left { padding: 0.5rem 0.2rem; }
    .summary-left-hint { margin: 0; font-size: 0.78rem; opacity: 0.6; line-height: 1.45; }

    /* -------- Trace left (Flow / Mocks) -------- */
    .trace-left { display: flex; flex-direction: column; height: 100%; }
    .trace-flow-body, .trace-mocks-body { flex: 1; overflow: auto; padding: 0.4rem 0.4rem; display: flex; flex-direction: column; gap: 0.4rem; }
    .toolbar { display: flex; gap: 0.3rem; flex-wrap: wrap; }
    .step-btn { background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); font-size: 0.78rem; padding: 0.18rem 0.5rem; border: 0; border-radius: 4px; cursor: pointer; font-family: inherit; }
    .step-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    .card { border: 1px solid var(--vscode-editorWidget-border, #444); border-radius: 5px; padding: 0.35rem 0.55rem; background: var(--vscode-editorHoverWidget-background, transparent); display: flex; flex-direction: column; gap: 0.3rem; }
    .card h3 { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; margin: 0; }
    .flow-outline-card { padding-bottom: 0.25rem; }
    /* Visual (mermaid) card: mermaid emits an SVG with its own fill colours;
       centre it, cap its width, and let it scroll horizontally when the
       diagram is wider than the pane instead of blowing out the layout.
       We paint a light-neutral background inside the host so mermaid's
       dark node text stays readable even under a dark editor theme. */
    .visual-card { align-items: stretch; }
    .visual-host { overflow-x: auto; display: flex; justify-content: center; padding: 0.5rem; min-height: 2rem; background: var(--vscode-editor-background); border: 1px solid var(--vscode-editorWidget-border, rgba(127,127,127,0.3)); border-radius: 4px; }
    .visual-host svg { max-width: 100%; height: auto; }
    /* Fallback for mermaid nodes whose fill still ends up close to the host
       background — force text to the editor foreground so it never disappears. */
    .visual-host svg text,
    .visual-host svg .nodeLabel,
    .visual-host svg .edgeLabel,
    .visual-host svg .cluster-label { fill: var(--vscode-editor-foreground, currentColor); color: var(--vscode-editor-foreground, currentColor); }
    .visual-host svg .edgeLabel { background-color: var(--vscode-editor-background); }
    .visual-caption { margin: 0; font-size: 0.78rem; }
    .visual-fallback { margin: 0; padding: 0.4rem 0.5rem; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1)); border-radius: 3px; font-size: 0.75rem; white-space: pre-wrap; overflow-x: auto; }
    .visual-error { font-size: 0.78rem; }
    /* Non-mermaid figures render as a <pre> inside the shared host chrome.
       Mermaid centres its SVG; text figures should start at the left edge. */
    .visual-host-diff,
    .visual-host-code,
    .visual-host-pseudocode,
    .visual-host-call-tree,
    .visual-host-component-tree,
    .visual-host-file-tree { justify-content: flex-start; padding: 0.35rem 0.5rem; }
    .visual-plain { margin: 0; padding: 0; background: transparent; border: 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.78rem; line-height: 1.4; white-space: pre; overflow-x: auto; color: var(--vscode-editor-foreground, currentColor); width: 100%; }
    .visual-highlight .code-line { display: block; }
    .trace-current { padding: 0.15rem 0; }
    .block-title { font-size: 0.95rem; margin: 0.1rem 0; }
    .block-narrative { margin: 0; font-size: 0.82rem; line-height: 1.4; }
    .var-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; }
    .var-row { min-width: 0; }
    .var-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.25rem; min-width: 0; }
    .var-name { color: var(--vscode-symbolIcon-variableForeground, var(--vscode-foreground)); font-weight: 600; overflow-wrap: anywhere; }
    .var-eq { opacity: 0.5; }
    .var-value { color: var(--vscode-charts-blue, var(--vscode-foreground)); overflow-wrap: anywhere; }
    /* new / changed relative to the previous block — the propagation cue. */
    .var-flag { margin-left: auto; padding: 0.02rem 0.35rem; border-radius: 999px; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
    .var-flag.new { background: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); color: var(--vscode-editor-background); }
    .var-flag.changed { background: var(--vscode-gitDecoration-modifiedResourceForeground, #d19a66); color: var(--vscode-editor-background); }
    .var-was { font-size: 0.7rem; opacity: 0.6; padding-left: 0.4rem; overflow-wrap: anywhere; }
    .var-old-value { text-decoration: line-through; }
    .var-note { font-size: 0.7rem; opacity: 0.65; padding-left: 0.4rem; overflow-wrap: anywhere; }
    .concern-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.8rem; }
    .concern { display: flex; align-items: center; gap: 0.4rem; }
    .sev-chip { padding: 0.02rem 0.35rem; border-radius: 4px; text-transform: uppercase; font-size: 0.6rem; font-weight: 600; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); display: inline-flex; align-items: center; gap: 0.2rem; }
    .sev-chip-icon { font-size: 0.8rem; line-height: 1; }
    .concern.sev-warn .sev-chip { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
    .concern.sev-error .sev-chip { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
    .concern-jump { font-family: var(--vscode-editor-font-family, monospace); opacity: 0.75; font-size: 0.7rem; }
    /* Focal card — kind-tinted left border, kind-tinted heading icon, plain
       reason underneath. Distinct from concerns (severity colours) and mocks
       (kind glyphs) so the three axes read as three axes. */
    .card.small.focal { border-left: 3px solid var(--focal-accent); padding-left: 0.6rem; }
    .card.small.focal.focal-core { --focal-accent: var(--vscode-charts-blue, #4a90e2); }
    .card.small.focal.focal-entry { --focal-accent: var(--vscode-charts-green, #4caf50); }
    .card.small.focal.focal-contract { --focal-accent: var(--vscode-charts-orange, #d9822b); }
    .focal-heading { display: flex; align-items: center; gap: 0.35rem; color: var(--focal-accent); margin: 0 0 0.25rem; }
    .focal-heading-icon { font-size: 0.9rem; line-height: 1; }
    .focal-heading-text { font-size: 0.85rem; font-weight: 600; }
    .focal-reason { margin: 0; font-size: 0.82rem; line-height: 1.4; opacity: 0.9; }
    .mock-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    .mock-row { border: 1px solid var(--vscode-editorWidget-border, #444); border-radius: 4px; padding: 0.25rem 0.45rem; min-width: 0; }
    .mock-row.open { background: var(--vscode-editorHoverWidget-background, transparent); }
    /* Symbol and kind share row 1, reason owns row 2. An auto-sized track takes
       its minimum from the symbol's min-content width, and mock symbols are
       long unbroken identifiers — that pushed the whole pane sideways. */
    .mock-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.1rem 0.4rem; align-items: baseline; cursor: pointer; }
    .mock-symbol { grid-column: 1; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
    .mock-kind { grid-column: 2; justify-self: end; font-size: 0.66rem; text-transform: uppercase; white-space: nowrap; opacity: 0.9; display: inline-flex; align-items: center; gap: 0.25rem; }
    .mock-kind-icon { font-size: 0.85rem; line-height: 1; }
    .mock-kind.mock-stub { color: var(--vscode-charts-blue, #4a90e2); }
    .mock-kind.mock-value { color: var(--vscode-charts-green, #4caf50); }
    .mock-kind.mock-skip { color: var(--vscode-descriptionForeground, #888); }
    .mock-reason { grid-column: 1 / -1; font-size: 0.72rem; opacity: 0.8; min-width: 0; overflow-wrap: anywhere; }
    .mock-current, .mock-file { margin-top: 0.3rem; font-size: 0.75rem; opacity: 0.85; min-width: 0; overflow-wrap: anywhere; }
    /* Mock values can be pasted JSON — keep the newlines, wrap the long lines. */
    .mock-current code { white-space: pre-wrap; overflow-wrap: anywhere; }
    .refine-input { width: 100%; box-sizing: border-box; margin-top: 0.3rem; padding: 0.25rem 0.45rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; font-family: inherit; font-size: 0.8rem; resize: vertical; }
    .refine-actions { display: flex; justify-content: flex-end; margin-top: 0.3rem; }

    /* -------- Chat (bottom-left) -------- */
    .pane-bottomleft .pane-header { display: flex; align-items: baseline; gap: 0.5rem; padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--vscode-editorWidget-border, #444); flex-shrink: 0; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
    .pane-title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; }
    .pane-subtitle { font-size: 0.72rem; opacity: 0.55; }
    .chat-body { flex: 1; overflow-y: auto; padding: 0.4rem 0.5rem; min-height: 0; }
    .chat-empty { opacity: 0.55; font-size: 0.8rem; line-height: 1.45; margin: 0.4rem 0.2rem; }
    .chat-stack { display: flex; flex-direction: column; gap: 0.45rem; }
    .conv { border: 1px solid var(--vscode-editorWidget-border, #444); border-radius: 5px; background: var(--vscode-editorHoverWidget-background, transparent); overflow: hidden; }
    .conv-header { display: grid; grid-template-columns: 16px auto 1fr auto 22px; gap: 0.4rem; align-items: center; padding: 0.3rem 0.5rem; cursor: pointer; user-select: none; }
    .conv-header:hover { background: var(--vscode-list-hoverBackground); }
    .conv.folded .conv-header { border-bottom: 0; }
    .conv:not(.folded) .conv-header { border-bottom: 1px solid var(--vscode-editorWidget-border, #444); }
    .conv-chevron { font-size: 0.7rem; opacity: 0.6; text-align: center; }
    .conv-origin { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.05rem 0.35rem; border-radius: 3px; }
    .conv-origin.origin-summary { background: var(--vscode-charts-blue, #4a90e2); color: #fff; }
    .conv-origin.origin-trace { background: var(--vscode-charts-orange, #d19a66); color: #000; }
    .conv-preview { font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .conv-turn-count { font-size: 0.65rem; opacity: 0.55; white-space: nowrap; }
    .conv-delete { background: transparent; color: var(--vscode-descriptionForeground); padding: 0 0.3rem; font-size: 0.9rem; border: 0; cursor: pointer; }
    .conv-delete:hover { color: var(--vscode-errorForeground); }
    .conv-body { padding: 0.45rem 0.55rem; display: flex; flex-direction: column; gap: 0.4rem; }
    .conv-context { margin: 0; padding: 0.25rem 0.5rem; border-left: 3px solid var(--vscode-textLink-foreground); background: var(--vscode-textBlockQuote-background, transparent); font-size: 0.72rem; opacity: 0.85; }
    .conv-context-locator { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.68rem; opacity: 0.7; margin-bottom: 0.15rem; }
    .conv-context-text { white-space: pre-wrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.72rem; }
    .turn { display: flex; flex-direction: column; gap: 0.2rem; }
    .turn-q { font-size: 0.78rem; color: var(--vscode-textLink-foreground); white-space: pre-wrap; }
    .turn-a { font-size: 0.83rem; line-height: 1.45; }
    .turn-a p { margin: 0 0 0.4rem; }
    .turn-a code { background: var(--vscode-textCodeBlock-background); padding: 0.05rem 0.25rem; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); }
    .turn-a pre.code { background: var(--vscode-textCodeBlock-background); padding: 0.5rem; border-radius: 4px; overflow-x: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.8rem; }
    .follow-row { display: flex; gap: 0.3rem; align-items: flex-end; }
    .follow-input { flex: 1; padding: 0.25rem 0.45rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; font-family: inherit; font-size: 0.8rem; resize: vertical; }
    .follow-btn { padding: 0.25rem 0.7rem; }

    /* Composer (fixed bottom of the Chat pane) */
    .composer { flex-shrink: 0; border-top: 1px solid var(--vscode-editorWidget-border, #444); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); padding: 0.35rem 0.5rem; display: flex; flex-direction: column; gap: 0.3rem; }
    .composer-input-row { display: flex; align-items: flex-end; gap: 0.35rem; }
    .composer-input { flex: 1; min-width: 0; box-sizing: border-box; padding: 0.35rem 0.5rem; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; font-family: inherit; font-size: 0.85rem; resize: vertical; }
    .composer-send { padding: 0.3rem 0.85rem; align-self: stretch; }
    /* Pending citation — same visual language as a folded conversation
       header (chevron replaced by the origin badge, ×-clear on the right). */
    .context-chip {
      /* display is toggled by refreshSelectionChipIn (grid ↔ none). */
      display: none;
      grid-template-columns: auto auto 1fr auto;
      gap: 0.4rem;
      align-items: center;
      padding: 0.2rem 0.45rem;
      background: var(--vscode-editorHoverWidget-background, transparent);
      border: 1px solid var(--vscode-editorWidget-border, #444);
      border-left: 3px solid var(--vscode-textLink-foreground);
      border-radius: 4px;
      font-size: 0.75rem;
    }
    .context-locator { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.7rem; opacity: 0.78; white-space: nowrap; }
    .context-quote { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.72rem; opacity: 0.5; }
    .context-preview { opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.72rem; }
    .context-clear { background: transparent; color: var(--vscode-descriptionForeground); border: 0; padding: 0 0.35rem; font-size: 0.95rem; cursor: pointer; }
    .context-clear:hover { color: var(--vscode-errorForeground); }

    /* -------- Summary right -------- */
    .summary-header { display: flex; flex-direction: column; gap: 0.2rem; }
    .title-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .title-row h1 { font-size: 1.15rem; margin: 0; }
    .outcome-text { margin: 0; font-size: 0.88rem; line-height: 1.45; }
    /* Bar and block count lead; the path is the trailing column, matching the
       locator-on-the-right rule the Watch-for and Tests rows follow. The auto
       count column makes every path start at the same x. */
    .files-touched { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.15rem; }
    .file-row { display: grid; grid-template-columns: 32px auto minmax(0, 1fr); align-items: center; gap: 0.4rem; font-size: 0.75rem; }
    .file-bar { height: 4px; border-radius: 2px; background: var(--vscode-charts-blue, #4a90e2); width: var(--w, 100%); opacity: 0.85; }
    .file-path { font-family: var(--vscode-editor-font-family, monospace); overflow-wrap: anywhere; }
    .file-count { font-size: 0.66rem; opacity: 0.6; white-space: nowrap; }
    /* Note first, locator pinned right. */
    .watch-list, .test-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .watch-item, .test-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 0.15rem 0.5rem; font-size: 0.85rem; line-height: 1.4; }
    .anchor-chip { padding: 0.02rem 0.4rem; border-radius: 4px; background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family, monospace); font-size: 0.72rem; white-space: nowrap; }
    .anchor-chip.clickable { cursor: pointer; }
    .anchor-chip.clickable:hover { background: var(--vscode-list-hoverBackground); }
    .watch-note, .test-desc { min-width: 0; overflow-wrap: anywhere; }

    /* -------- Trace right (code view) --------
       Pane is a column flex: header pinned by flex-shrink, code area scrolls
       both axes on its own. Sticky is no longer needed and would in fact hide
       the header inside the wrong scroll container. */
    .code-header { flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; gap: 0.55rem; padding: 0.3rem 0.6rem; border-bottom: 1px solid var(--vscode-editorWidget-border, #444); background: var(--vscode-editor-background); z-index: 1; flex-wrap: wrap; }
    .code-header-left { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
    .code-header-actions { display: flex; align-items: center; gap: 0.3rem; flex-shrink: 0; }
    .code-file { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.78rem; opacity: 0.75; }
    .seg-control { display: inline-flex; border: 1px solid var(--vscode-editorWidget-border, #666); border-radius: 4px; overflow: hidden; }
    .seg-btn { background: transparent; color: var(--vscode-descriptionForeground); padding: 0.12rem 0.5rem; font-size: 0.72rem; border: 0; border-radius: 0; cursor: pointer; }
    .seg-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .seg-btn.disabled { opacity: 0.4; cursor: not-allowed; }
    .seg-btn:not(:last-child) { border-right: 1px solid var(--vscode-editorWidget-border, #555); }
    .role-badge { font-size: 0.6rem; padding: 0.02rem 0.35rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .role-badge.role-added { background: var(--vscode-gitDecoration-addedResourceForeground, #4caf50); color: var(--vscode-editor-background); }
    .role-badge.role-modified { background: var(--vscode-gitDecoration-modifiedResourceForeground, #d19a66); color: var(--vscode-editor-background); }
    .role-badge.role-removed { background: var(--vscode-gitDecoration-deletedResourceForeground, #e06c75); color: var(--vscode-editor-background); }
    /* Owns both-axis scrolling for the code table. Width:100% on the table is
       a minimum — a longer line lets it expand and this container scrolls to
       reveal it, without dragging the header along. */
    .code-wrap { flex: 1; min-height: 0; overflow: auto; padding: 0.25rem 0; }
    .code-table { border-collapse: collapse; width: 100%; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.82rem; }
    .code-line td { padding: 0 0.5rem; vertical-align: top; white-space: pre; }
    /* Gutter holds line number + optional focal icon. Grid so the icon sits to
       the left of the number without shifting horizontal alignment across
       rows without an icon. */
    .gutter { display: grid; grid-template-columns: 1rem 2rem; align-items: baseline; column-gap: 0.25rem; text-align: right; color: var(--vscode-editorLineNumber-foreground); user-select: none; width: 3.5rem; }
    .gutter-line { grid-column: 2; }
    .focal-gutter-icon { grid-column: 1; justify-self: center; font-size: 0.9rem; line-height: 1; color: var(--focal-gutter-color, var(--vscode-editorInfo-foreground)); }
    .code-line.focal-core { --focal-gutter-color: var(--vscode-charts-blue, #4a90e2); }
    .code-line.focal-entry { --focal-gutter-color: var(--vscode-charts-green, #4caf50); }
    .code-line.focal-contract { --focal-gutter-color: var(--vscode-charts-orange, #d9822b); }
    .code-line.focus { background: var(--vscode-editor-selectionBackground, rgba(120, 150, 200, 0.25)); }
    .code-line.focus .gutter { color: var(--vscode-editorLineNumber-activeForeground); }
    .code-line.focus-before { background: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground, #e06c75) 18%, transparent); }
    .code-line.focus-before .gutter { color: var(--vscode-gitDecoration-deletedResourceForeground, #e06c75); }
    .code-line.step-in-range .code-cell { position: relative; box-shadow: inset 3px 0 0 var(--vscode-charts-orange, #d19a66); }
    .code-line.step-in-range:not(.focus) { background: color-mix(in srgb, var(--vscode-charts-orange, #d19a66) 8%, transparent); }
    .code-cell-inner { display: flex; align-items: flex-start; gap: 0.4rem; }
    .code-cell-source { flex: 1 1 auto; white-space: pre; min-width: 0; }
    .step-in-badges { flex: 0 0 auto; display: flex; gap: 0.25rem; flex-wrap: wrap; align-self: flex-start; white-space: normal; }
    .step-in-badge { padding: 0.02rem 0.45rem; border-radius: 999px; font-size: 0.68rem; font-family: var(--vscode-font-family, sans-serif); background: var(--vscode-charts-orange, #d19a66); color: var(--vscode-editor-background); cursor: pointer; border: 0; opacity: 0.92; }
    .step-in-badge:hover { opacity: 1; }
    .code-line.step-over-prev .code-cell { box-shadow: inset 2px 0 0 var(--vscode-descriptionForeground, #888); }
    .code-line.step-over-next .code-cell { box-shadow: inset 2px 0 0 var(--vscode-descriptionForeground, #888); }
    .code-line.step-over-prev:not(.focus):not(.step-in-range),
    .code-line.step-over-next:not(.focus):not(.step-in-range) { background: color-mix(in srgb, var(--vscode-descriptionForeground, #888) 5%, transparent); }
    /* Step-Over neighbour badges — same shape as Step-In but the neutral
       description colour, so the eye reads them as "orientation, not action". */
    .step-over-badge { padding: 0.02rem 0.45rem; border-radius: 999px; font-size: 0.68rem; font-family: var(--vscode-font-family, sans-serif); background: var(--vscode-descriptionForeground, #888); color: var(--vscode-editor-background); cursor: pointer; border: 0; opacity: 0.85; }
    .step-over-badge:hover { opacity: 1; }
    .off-file-banner { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; padding: 0.25rem 0.6rem; border-bottom: 1px solid var(--vscode-editorWidget-border, #444); background: color-mix(in srgb, var(--vscode-charts-orange, #d19a66) 8%, transparent); font-size: 0.72rem; }
    .off-file-label { opacity: 0.75; margin-right: 0.2rem; }
    .off-file-chip { padding: 0.05rem 0.5rem; border-radius: 999px; border: 1px solid var(--vscode-charts-orange, #d19a66); background: transparent; color: var(--vscode-foreground); font-family: inherit; font-size: 0.72rem; cursor: pointer; }
    .off-file-chip:hover { background: color-mix(in srgb, var(--vscode-charts-orange, #d19a66) 20%, transparent); }

    /* -------- shared -------- */
    .chip { display: inline-flex; align-items: center; padding: 0.05rem 0.4rem; border-radius: 999px; font-size: 0.65rem; letter-spacing: 0.04em; text-transform: uppercase; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    ${kindChipCss()}
    .chip.warn { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
    /* Transparent placeholder border keeps ghost and filled buttons the same
       height when they sit side by side (the code header has both). */
    button { border: 1px solid transparent; cursor: pointer; padding: 0.2rem 0.55rem; border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-family: inherit; font-size: 0.8rem; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.ghost { background: transparent; color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .muted { opacity: 0.55; font-size: 0.8rem; }
    .loading { opacity: 0.6; font-size: 0.85rem; padding: 0.25rem 0; }
    .loading.center { padding: 1.5rem; text-align: center; }

    /* -------- loading indicator -------- */
    .loading-block { display: flex; flex-direction: column; gap: 0.35rem; padding: 0.5rem 0.1rem; }
    .loading-center { padding: 1.4rem 1.2rem; }
    .loading-head { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; }
    .loading-phase { opacity: 0.8; }
    .loading-elapsed { margin-left: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.72rem; opacity: 0.5; font-variant-numeric: tabular-nums; }
    .loading-steps { font-size: 0.68rem; opacity: 0.45; letter-spacing: 0.04em; }
    /* Same shape as the side panel's spinner so the two webviews read as one UI. */
    .spinner {
      flex: 0 0 auto;
      width: 0.9em; height: 0.9em;
      border: 2px solid var(--vscode-descriptionForeground, #aaa);
      border-top-color: transparent;
      border-radius: 50%;
      animation: sdt-spin 0.8s linear infinite;
    }
    .tab-spinner { display: inline-block; margin-left: 0.35rem; vertical-align: -0.08em; width: 0.7em; height: 0.7em; border-width: 1.5px; }
    .loading-bar { position: relative; height: 3px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent); }
    .loading-bar-fill { display: block; height: 100%; background: var(--vscode-textLink-foreground); transition: width 240ms ease; }
    .loading-bar.indeterminate .loading-bar-sweep {
      display: block; position: absolute; top: 0; bottom: 0; width: 35%;
      background: var(--vscode-textLink-foreground);
      animation: sdt-sweep 1.3s ease-in-out infinite;
    }
    @keyframes sdt-spin { to { transform: rotate(360deg); } }
    @keyframes sdt-sweep {
      0%   { left: -35%; }
      100% { left: 100%; }
    }
    /* Respect the OS "reduce motion" setting — the phase text and elapsed
       clock still convey that work is in flight. */
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation: none; border-top-color: var(--vscode-descriptionForeground, #aaa); opacity: 0.7; }
      .loading-bar.indeterminate .loading-bar-sweep { animation: none; left: 0; width: 100%; opacity: 0.35; }
    }
  `;
  document.head.append(style);
}
