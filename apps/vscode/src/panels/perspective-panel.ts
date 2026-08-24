import * as vscode from 'vscode';
import type {
  BlockPath,
  Flow,
  Mock,
  SummaryPayload,
  PerspectiveDraft,
  QaSection,
  StepAction,
} from '@semantic-diff-tracer/core';
import { escapeHtml, embedJson, randomNonce } from './html.js';

/**
 * The tab a caller wants the perspective panel to open on. `summary` shows
 * the outcome / watch-for / tests, `trace` swaps the left column into the
 * flow list and the right column into the code view.
 */
export type PerspectiveTab = 'summary' | 'trace';

/**
 * Progress of one background task feeding a tab. `step` counts *completed*
 * stages, so `{ step: 0, steps: 2 }` is still on the first one. `steps <= 1`
 * means the work has no reportable milestone and the webview draws an
 * indeterminate bar instead of a filled one.
 */
export interface LoadingTask {
  phase: string;
  step: number;
  steps: number;
  /** Epoch ms. The webview ticks an elapsed counter off this on its own. */
  startedAt: number;
}

/**
 * Snapshot passed to the webview via `postMessage`. Every field may be
 * missing while the corresponding LLM turn is still in flight; the webview
 * renders a loading placeholder for the missing sections.
 *
 * Change classification for Flow blocks lives on `flow.blocks[*].role` now —
 * the extension no longer computes it separately.
 */
export interface PerspectiveSnapshot {
  perspective: PerspectiveDraft;
  summary?: SummaryPayload;
  flow?: Flow;
  sections: QaSection[];
  /** In-flight background work per tab. A missing key means that half settled. */
  loading: { summary?: LoadingTask; flow?: LoadingTask };
  /** Trace-side state. Empty defaults are fine. */
  trace: {
    cursor: BlockPath;
    history: BlockPath[];
    /** file@headSha -> full source. Keyed by post-merge path. */
    fullCodeByFile: Record<string, string>;
    /** file@baseSha -> full source. Keyed by pre-merge path (rename-aware). */
    fullBeforeCodeByFile: Record<string, string>;
    refinementInFlight?: string | null;
  };
  /** Which top-level tab the panel should be showing (default: summary). */
  activeTab?: PerspectiveTab;
}

interface PerspectiveCallbacks {
  onAskQa: (
    perspectiveId: string,
    question: string,
    context: {
      selection: string;
      file?: string;
      startLine?: number;
      endLine?: number;
    } | undefined,
    forkOrigin: 'summary' | 'flow',
  ) => Promise<void>;
  onFollowUp: (perspectiveId: string, sectionId: string, question: string) => Promise<void>;
  onDeleteSection: (perspectiveId: string, sectionId: string) => Promise<void>;
  /** Trace tab: step / goto / mock refine / open-in-editor. */
  onStep: (perspectiveId: string, action: StepAction) => void;
  onGotoBlock: (perspectiveId: string, blockId: string) => void;
  onRefineMock: (perspectiveId: string, mock: Mock, instruction: string) => Promise<void>;
  onOpenFile: (file: string, line: number) => void;
  /** Trace tab: open the PR's base↔head diff for a file, scrolled to a line. */
  onOpenDiff: (file: string, line: number) => void;
  /** Fires when the user switches Summary <-> Trace so the host can hydrate lazily. */
  onTabChange: (perspectiveId: string, tab: PerspectiveTab) => void;
}

type IncomingMessage =
  | {
      type: 'ask';
      perspectiveId: string;
      question: string;
      context?: { selection: string; file?: string; startLine?: number; endLine?: number };
      forkOrigin?: 'summary' | 'flow';
    }
  | { type: 'followUp'; perspectiveId: string; sectionId: string; question: string }
  | { type: 'deleteSection'; perspectiveId: string; sectionId: string }
  | { type: 'step'; perspectiveId: string; action: StepAction }
  | { type: 'goto'; perspectiveId: string; blockId: string }
  | { type: 'refineMock'; perspectiveId: string; mockId: string; instruction: string }
  | { type: 'openFile'; file: string; line: number }
  | { type: 'openDiff'; file: string; line: number }
  | { type: 'tabChange'; perspectiveId: string; tab: PerspectiveTab };

export class PerspectivePanel {
  private static panels = new Map<string, PerspectivePanel>();

  static openFor(
    context: vscode.ExtensionContext,
    perspective: PerspectiveDraft,
    callbacks: PerspectiveCallbacks,
    initial: PerspectiveSnapshot,
  ): PerspectivePanel {
    const existing = PerspectivePanel.panels.get(perspective.id);
    if (existing) {
      existing.update(initial);
      existing.panel.reveal(vscode.ViewColumn.Active, true);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(
      'sdt.perspective',
      `Semantic Diff Tracer · ${perspective.title}`,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
        retainContextWhenHidden: true,
      },
    );
    const instance = new PerspectivePanel(panel, context, perspective, callbacks);
    PerspectivePanel.panels.set(perspective.id, instance);
    panel.onDidDispose(() => PerspectivePanel.panels.delete(perspective.id));
    instance.render();
    instance.update(initial);
    return instance;
  }

  static get(perspectiveId: string): PerspectivePanel | undefined {
    return PerspectivePanel.panels.get(perspectiveId);
  }

  private snapshot: PerspectiveSnapshot;
  /** Look up a mock by id for the Trace tab's `refineMock` message. */
  private mockLookup = new Map<string, Mock>();

  private constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly perspective: PerspectiveDraft,
    private readonly callbacks: PerspectiveCallbacks,
  ) {
    this.snapshot = {
      perspective,
      sections: [],
      loading: {},
      trace: {
        cursor: [0],
        history: [],
        fullCodeByFile: {},
        fullBeforeCodeByFile: {},
      },
    };
    this.panel.webview.onDidReceiveMessage((msg: IncomingMessage) => this.handle(msg));
  }

  update(next: PerspectiveSnapshot): void {
    this.snapshot = next;
    this.mockLookup.clear();
    if (next.flow) {
      for (const m of next.flow.allMocks) this.mockLookup.set(m.id, m);
    }
    void this.panel.webview.postMessage({ type: 'state', snapshot: this.snapshot });
  }

  /** Show the panel with a given tab preselected, without touching data. */
  revealOn(tab: PerspectiveTab): void {
    this.snapshot = { ...this.snapshot, activeTab: tab };
    this.panel.reveal(vscode.ViewColumn.Active, true);
    void this.panel.webview.postMessage({ type: 'state', snapshot: this.snapshot });
  }

  private async handle(msg: IncomingMessage): Promise<void> {
    if (msg.type === 'ask') {
      await this.callbacks.onAskQa(
        msg.perspectiveId,
        msg.question,
        msg.context,
        msg.forkOrigin ?? 'summary',
      );
      return;
    }
    if (msg.type === 'followUp') {
      await this.callbacks.onFollowUp(msg.perspectiveId, msg.sectionId, msg.question);
      return;
    }
    if (msg.type === 'deleteSection') {
      await this.callbacks.onDeleteSection(msg.perspectiveId, msg.sectionId);
      return;
    }
    if (msg.type === 'step') {
      this.callbacks.onStep(msg.perspectiveId, msg.action);
      return;
    }
    if (msg.type === 'goto') {
      this.callbacks.onGotoBlock(msg.perspectiveId, msg.blockId);
      return;
    }
    if (msg.type === 'refineMock') {
      const mock = this.mockLookup.get(msg.mockId);
      if (!mock) return;
      await this.callbacks.onRefineMock(msg.perspectiveId, mock, msg.instruction);
      return;
    }
    if (msg.type === 'openFile') {
      this.callbacks.onOpenFile(msg.file, msg.line);
      return;
    }
    if (msg.type === 'openDiff') {
      this.callbacks.onOpenDiff(msg.file, msg.line);
      return;
    }
    if (msg.type === 'tabChange') {
      this.callbacks.onTabChange(msg.perspectiveId, msg.tab);
    }
  }

  private render(): void {
    const nonce = randomNonce();
    const cspSource = this.panel.webview.cspSource;
    // ESM entry — matches esbuild's `format: 'esm', splitting: true` output.
    // The mermaid chunk under chunks/ is fetched on demand from this same
    // dist/webview-ui/perspective subtree, which the localResourceRoot already
    // covers via `dist`.
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-ui', 'perspective', 'main.js'),
    );
    const codiconUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'dist',
        'webview-ui',
        'perspective',
        'codicons',
        'codicon.css',
      ),
    );
    const bootstrap = embedJson({ perspective: this.perspective });
    this.panel.webview.html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; img-src ${cspSource} data:; font-src ${cspSource};" />
<title>${escapeHtml(this.perspective.title)}</title>
<link rel="stylesheet" href="${codiconUri}" />
<style>${styles()}</style>
</head>
<body>
<div id="root">Loading perspective…</div>
<script id="bootstrap" type="application/json">${bootstrap}</script>
<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function styles(): string {
  // Base layout only — the webview-ui bundle owns component styling.
  return `
    html, body { margin: 0; padding: 0; height: 100%; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    #root { height: 100%; }
  `;
}
