import * as vscode from 'vscode';
import type { PerspectiveSet, PrRef, TraceDepth } from '@semantic-diff-tracer/core';
import { DEFAULT_TRACE_DEPTH } from '@semantic-diff-tracer/core';
import { embedJson, escapeHtml, randomNonce } from '../panels/html.js';

/**
 * State published to the webview. All rendering — hierarchy, wrap, welcome
 * buttons — lives on the webview side (see `src/webview-ui/side.ts`) so long
 * TL;DR / outcome text can flow naturally as multi-line HTML blocks. VSCode's
 * built-in TreeView can't wrap a row and was therefore unsuitable.
 */
export type SidePanelState = 'no-workspace' | 'idle' | 'loading' | 'ready';

export interface SidePanelSnapshot {
  state: SidePanelState;
  ref?: PrRef;
  meta?: { title: string; url?: string };
  set?: PerspectiveSet;
  loadingMessage?: string;
  /** Epoch ms; webview ticks an elapsed counter off this. */
  loadingStartedAt?: number;
  /** Current trace depth (extension-owned; toggled from the view header). */
  traceDepth?: TraceDepth;
}

export interface SidePanelCallbacks {
  /** Fires when the reader flips the trace-depth toggle in the view header. */
  onTraceDepthChange?(depth: TraceDepth): void;
}

export class SidePanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private snapshot: SidePanelSnapshot = { state: 'idle', traceDepth: DEFAULT_TRACE_DEPTH };
  private callbacks: SidePanelCallbacks = {};

  constructor(private readonly context: vscode.ExtensionContext) {}

  setCallbacks(callbacks: SidePanelCallbacks): void {
    this.callbacks = callbacks;
  }

  setTraceDepth(depth: TraceDepth): void {
    this.snapshot = { ...this.snapshot, traceDepth: depth };
    this.publish();
  }

  showNoWorkspace(): void {
    this.snapshot = { state: 'no-workspace', traceDepth: this.snapshot.traceDepth ?? DEFAULT_TRACE_DEPTH };
    this.publish();
  }

  showIdle(): void {
    this.snapshot = { state: 'idle', traceDepth: this.snapshot.traceDepth ?? DEFAULT_TRACE_DEPTH };
    this.publish();
  }

  showLoading(ref: PrRef, meta: { title: string; url?: string }, message?: string): void {
    const next: SidePanelSnapshot = {
      state: 'loading',
      ref,
      meta,
      loadingStartedAt: Date.now(),
      traceDepth: this.snapshot.traceDepth ?? DEFAULT_TRACE_DEPTH,
    };
    if (message) next.loadingMessage = message;
    this.snapshot = next;
    this.publish();
  }

  showReady(ref: PrRef, meta: { title: string; url?: string }, set: PerspectiveSet): void {
    this.snapshot = { state: 'ready', ref, meta, set, traceDepth: this.snapshot.traceDepth ?? DEFAULT_TRACE_DEPTH };
    this.publish();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    view.webview.onDidReceiveMessage((msg: { type?: string; command?: string; perspectiveId?: string; url?: string; traceDepth?: string }) => {
      if (msg.type === 'runCommand' && typeof msg.command === 'string') {
        void vscode.commands.executeCommand(
          msg.command,
          msg.perspectiveId ? { perspectiveId: msg.perspectiveId } : undefined,
        );
      }
      if (msg.type === 'openExternal' && typeof msg.url === 'string') {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
      if (msg.type === 'setTraceDepth' && (msg.traceDepth === 'normal' || msg.traceDepth === 'deep')) {
        this.callbacks.onTraceDepthChange?.(msg.traceDepth);
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    view.webview.html = this.buildHtml(view.webview);
    // The webview requests state on load; still push proactively so a
    // reveal-after-state-change lands the latest snapshot.
    this.publish();
  }

  private publish(): void {
    void vscode.commands.executeCommand('setContext', 'sdt.state', this.snapshot.state);
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'state', snapshot: this.snapshot });
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = randomNonce();
    const cspSource = webview.cspSource;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-ui', 'side.js'),
    );
    const bootstrap = embedJson({ snapshot: this.snapshot });
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource}; img-src ${cspSource} data:; font-src ${cspSource};" />
<title>${escapeHtml('Semantic Diff Tracer')}</title>
</head>
<body>
<div id="root">Loading…</div>
<script id="bootstrap" type="application/json">${bootstrap}</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
