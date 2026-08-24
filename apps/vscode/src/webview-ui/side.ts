import type { PerspectiveDraft, PerspectiveSet, PrRef } from '@semantic-diff-tracer/core';
import { el, empty } from './common/dom.js';
import { kindChip, kindChipCss } from './common/kind-chip.js';

type State = 'no-workspace' | 'idle' | 'loading' | 'ready';

interface Snapshot {
  state: State;
  ref?: PrRef;
  meta?: { title: string; url?: string };
  set?: PerspectiveSet;
  loadingMessage?: string;
  loadingStartedAt?: number;
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(s: unknown): void;
  getState(): unknown;
};

const vscode = acquireVsCodeApi();
const boot = JSON.parse(document.getElementById('bootstrap')!.textContent || '{}') as {
  snapshot?: Snapshot;
};
let snapshot: Snapshot = boot.snapshot ?? { state: 'idle' };

installStyles();
render();

window.addEventListener('message', (event) => {
  const msg = event.data as { type: string; snapshot?: Snapshot };
  if (msg.type === 'state' && msg.snapshot) {
    snapshot = msg.snapshot;
    render();
  }
});

function render(): void {
  const root = document.getElementById('root')!;
  empty(root);
  if (snapshot.state === 'no-workspace') {
    root.append(buildWelcomeNoWorkspace());
    return;
  }
  if (snapshot.state === 'idle') {
    root.append(buildWelcomeIdle());
    return;
  }
  root.append(buildContent());
  syncElapsedTicker();
}

function formatElapsed(startedAt: number): string {
  const secs = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`;
}

let elapsedTicker: number | undefined;
function syncElapsedTicker(): void {
  const nodes = document.querySelectorAll('[data-started-at]');
  const running = nodes.length > 0;
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

// ---------- welcome ----------

function buildWelcomeNoWorkspace(): HTMLElement {
  return el('section', {
    class: 'welcome',
    children: [
      el('h2', { text: 'Semantic Diff Tracer' }),
      el('p', {
        class: 'welcome-lead',
        text: 'Open a workspace folder first — a git working tree, or a baretree root.',
      }),
      el('button', {
        class: 'primary block',
        text: 'Open Folder',
        onClick: () => runCommand('vscode.openFolder'),
      }),
    ],
  });
}

function buildWelcomeIdle(): HTMLElement {
  return el('section', {
    class: 'welcome',
    children: [
      el('h2', { text: 'Pick a pull request' }),
      el('p', {
        class: 'welcome-lead',
        text: 'Paste a URL, owner/repo#N, #N, or a branch name.',
      }),
      el('button', {
        class: 'primary block',
        text: 'Open PR',
        onClick: () => runCommand('sdt.pickPr'),
      }),
      el('div', {
        class: 'welcome-secondary',
        children: [
          el('button', {
            class: 'ghost block',
            text: 'Review Current Branch',
            onClick: () => runCommand('sdt.reviewCurrentBranch'),
          }),
          el('button', {
            class: 'ghost block',
            text: 'Switch Baretree Worktree',
            onClick: () => runCommand('sdt.switchWorktree'),
          }),
          el('button', {
            class: 'ghost block',
            text: 'Cleanup PR Checkouts',
            onClick: () => runCommand('sdt.cleanupCheckouts'),
          }),
        ],
      }),
    ],
  });
}

// ---------- ready / loading content ----------

function buildContent(): HTMLElement {
  const wrap = el('div', { class: 'stack' });
  if (snapshot.ref && snapshot.meta) wrap.append(buildPrHeader(snapshot.ref, snapshot.meta));
  if (snapshot.state === 'loading') {
    const children: Node[] = [
      el('span', { class: 'spinner' }),
      el('span', { text: snapshot.loadingMessage ?? 'Extracting perspectives…' }),
    ];
    if (snapshot.loadingStartedAt) {
      children.push(
        el('span', {
          class: 'loading-elapsed',
          text: formatElapsed(snapshot.loadingStartedAt),
          dataset: { startedAt: String(snapshot.loadingStartedAt) },
        }),
      );
    }
    wrap.append(el('div', { class: 'loading', children }));
    return wrap;
  }
  const set = snapshot.set;
  if (!set) return wrap;
  if (set.tldr) wrap.append(buildTldr(set.tldr));
  wrap.append(buildPerspectivesList(set.perspectives));
  if (set.incidental.length > 0) wrap.append(buildIncidental(set));
  return wrap;
}

function buildPrHeader(ref: PrRef, meta: { title: string; url?: string }): HTMLElement {
  const detail =
    ref.kind === 'github'
      ? `${ref.owner}/${ref.repo}#${ref.number}`
      : `${ref.baseRef} ← ${ref.headRef}`;
  const titleNode = el('div', { class: 'pr-title', text: meta.title });
  const detailNode = meta.url
    ? el('a', {
        class: 'pr-detail link',
        text: detail,
        attrs: { href: '#' },
        onClick: (e) => {
          e.preventDefault();
          if (meta.url) openExternal(meta.url);
        },
      })
    : el('div', { class: 'pr-detail', text: detail });
  return el('header', {
    class: 'pr-header',
    children: [
      titleNode,
      detailNode,
      el('div', {
        class: 'pr-actions',
        children: [
          el('button', {
            class: 'ghost',
            text: 'Switch PR',
            onClick: () => runCommand('sdt.pickPr'),
          }),
          el('button', {
            class: 'ghost',
            text: 'Refresh',
            onClick: () => runCommand('sdt.refresh'),
          }),
        ],
      }),
    ],
  });
}

function buildTldr(text: string): HTMLElement {
  return el('section', {
    class: 'card tldr',
    children: [el('h3', { text: 'TL;DR' }), el('p', { class: 'tldr-text', text })],
  });
}

function buildPerspectivesList(perspectives: PerspectiveDraft[]): HTMLElement {
  const list = el('div', { class: 'perspective-list' });
  perspectives.forEach((p, i) => list.append(buildPerspectiveCard(p, i)));
  if (perspectives.length === 0) {
    list.append(el('p', { class: 'muted', text: 'No perspectives extracted.' }));
  }
  return el('section', {
    class: 'card perspectives',
    children: [
      el('h3', { text: `Perspectives (${perspectives.length})` }),
      list,
    ],
  });
}

function buildPerspectiveCard(p: PerspectiveDraft, i: number): HTMLElement {
  return el('article', {
    class: 'perspective',
    onClick: () => runCommand('sdt.openSummary', p.id),
    children: [
      el('div', {
        class: 'perspective-head',
        children: [
          el('span', { class: 'perspective-index', text: String(i + 1) }),
          el('span', { class: 'perspective-title', text: p.title }),
          kindChip(p.kind),
        ],
      }),
      el('p', { class: 'perspective-outcome', text: p.outcome }),
      el('div', {
        class: 'perspective-actions',
        children: [
          el('button', {
            class: 'primary',
            text: 'Open Summary',
            onClick: (e) => {
              e.stopPropagation();
              runCommand('sdt.openSummary', p.id);
            },
          }),
          el('button', {
            class: 'ghost',
            text: 'Open Trace',
            onClick: (e) => {
              e.stopPropagation();
              runCommand('sdt.openTrace', p.id);
            },
          }),
        ],
      }),
    ],
  });
}

function buildIncidental(set: PerspectiveSet): HTMLElement {
  return el('section', {
    class: 'card incidental',
    children: [
      el('h3', { text: `Incidental (${set.incidental.length})` }),
      el('ul', {
        class: 'incidental-list',
        children: set.incidental.map((inc) =>
          el('li', {
            children: [
              el('span', { class: 'chip small', text: inc.category }),
              el('span', { class: 'incidental-note', text: inc.note }),
              el('span', {
                class: 'incidental-count',
                text: `${inc.hunkRefs.length}h`,
              }),
            ],
          }),
        ),
      }),
    ],
  });
}

// ---------- messaging ----------

function runCommand(command: string, perspectiveId?: string): void {
  vscode.postMessage({ type: 'runCommand', command, perspectiveId });
}

function openExternal(url: string): void {
  vscode.postMessage({ type: 'openExternal', url });
}

// ---------- styles ----------

function installStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; padding: 0; height: 100%; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
    #root { padding: 0.4rem 0.5rem 0.8rem; box-sizing: border-box; }
    /* One button size across the panel. The transparent border matters: ghost
       buttons draw a real one, and without the placeholder they came out 2px
       taller than the filled buttons stacked next to them. */
    button { border: 1px solid transparent; cursor: pointer; padding: 0.3rem 0.6rem; border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-family: inherit; font-size: 0.82rem; line-height: 1.25; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.ghost { background: transparent; color: var(--vscode-textLink-foreground); border-color: var(--vscode-textLink-foreground); }
    button.ghost:hover { background: var(--vscode-list-hoverBackground); }
    /* Full-width, for the stacked welcome actions. Prominence comes from the
       filled vs ghost treatment, not from a second size. */
    button.block { width: 100%; }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    a.link { color: var(--vscode-textLink-foreground); text-decoration: none; word-break: break-all; }
    a.link:hover { text-decoration: underline; }
    .muted { opacity: 0.55; font-size: 0.8rem; }

    /* welcome */
    .welcome { display: flex; flex-direction: column; gap: 0.45rem; padding: 0.6rem 0.15rem; }
    .welcome h2 { margin: 0; font-size: 1rem; }
    .welcome-lead { margin: 0 0 0.15rem; font-size: 0.8rem; opacity: 0.75; line-height: 1.4; }
    .welcome-secondary { display: flex; flex-direction: column; gap: 0.3rem; }

    /* stack */
    .stack { display: flex; flex-direction: column; gap: 0.5rem; }

    /* pr header */
    .pr-header { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.45rem 0.55rem; border-radius: 5px; background: var(--vscode-editorHoverWidget-background, transparent); border: 1px solid var(--vscode-editorWidget-border, #444); }
    .pr-title { font-weight: 600; font-size: 0.88rem; line-height: 1.3; word-break: break-word; }
    .pr-detail { font-size: 0.72rem; opacity: 0.8; font-family: var(--vscode-editor-font-family, monospace); }
    .pr-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.25rem; }

    /* cards */
    .card { display: flex; flex-direction: column; gap: 0.35rem; padding: 0.45rem 0.55rem; border-radius: 5px; background: var(--vscode-editorHoverWidget-background, transparent); border: 1px solid var(--vscode-editorWidget-border, #444); }
    .card h3 { margin: 0; font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; }

    /* tldr */
    .tldr-text { margin: 0; font-size: 0.84rem; line-height: 1.5; word-break: break-word; overflow-wrap: anywhere; }

    /* perspectives */
    .perspective-list { display: flex; flex-direction: column; gap: 0.35rem; }
    .perspective { border: 1px solid var(--vscode-editorWidget-border, #444); padding: 0.4rem 0.5rem; border-radius: 4px; background: var(--vscode-editor-background); cursor: pointer; display: flex; flex-direction: column; gap: 0.3rem; transition: background 120ms ease; }
    .perspective:hover { background: var(--vscode-list-hoverBackground); }
    .perspective-head { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
    .perspective-index { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 50%; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 0.65rem; font-weight: 600; flex-shrink: 0; }
    .perspective-title { font-weight: 500; font-size: 0.85rem; line-height: 1.3; word-break: break-word; flex: 1; min-width: 0; }
    .perspective-outcome { margin: 0; font-size: 0.8rem; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere; opacity: 0.9; }
    .perspective-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.1rem; }

    /* chips */
    .chip { display: inline-flex; align-items: center; padding: 0.05rem 0.45rem; border-radius: 999px; font-size: 0.62rem; letter-spacing: 0.04em; text-transform: uppercase; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); white-space: nowrap; }
    .chip.small { font-size: 0.58rem; padding: 0.05rem 0.35rem; }
    ${kindChipCss()}

    /* incidental */
    .incidental-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
    .incidental-list li { display: flex; align-items: baseline; gap: 0.35rem; font-size: 0.78rem; line-height: 1.35; word-break: break-word; overflow-wrap: anywhere; }
    .incidental-note { flex: 1; min-width: 0; }
    .incidental-count { font-size: 0.68rem; opacity: 0.6; font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap; }

    /* loading */
    .loading { display: flex; align-items: center; gap: 0.45rem; padding: 0.35rem 0.1rem; font-size: 0.82rem; opacity: 0.85; }
    .loading-elapsed { margin-left: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.75rem; opacity: 0.7; font-variant-numeric: tabular-nums; }
    .spinner { width: 14px; height: 14px; border: 2px solid var(--vscode-descriptionForeground, #aaa); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.append(style);
}
