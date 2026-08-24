import * as vscode from 'vscode';
import type { ProgressState, ProgressTracker } from './progress.js';

/**
 * Status-bar-item that surfaces whatever Semantic Diff Tracer operation is in flight.
 * When nothing is running the item is hidden entirely; while calls stack up
 * (parallel git fetch + LLM, say) the label follows the most recent entry
 * so the reviewer always sees the current bottleneck. A per-second tick keeps
 * the elapsed counter live so the reviewer can tell a slow LLM turn from a
 * stuck one at a glance.
 */
export class ProgressStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscription: vscode.Disposable;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private state: ProgressState = { active: [], latest: undefined };

  constructor(tracker: ProgressTracker) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'sdt.showLog';
    this.subscription = tracker.onChange((state) => this.onChange(state));
    this.onChange(tracker.snapshot());
  }

  private onChange(state: ProgressState): void {
    this.state = state;
    this.render();
    this.syncTicker();
  }

  private syncTicker(): void {
    const running = this.state.active.length > 0;
    if (running && this.ticker === undefined) {
      this.ticker = setInterval(() => this.render(), 1000);
    } else if (!running && this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private render(): void {
    const latest = this.state.latest;
    if (!latest) {
      this.item.hide();
      return;
    }
    const extra = this.state.active.length > 1 ? ` (+${this.state.active.length - 1})` : '';
    const elapsed = formatElapsed(Date.now() - latest.startedAt);
    this.item.text = `$(loading~spin) Semantic Diff Tracer · ${latest.scope}: ${latest.message} · ${elapsed}${extra}`;
    this.item.tooltip = buildTooltip(this.state);
    this.item.show();
  }

  dispose(): void {
    if (this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    this.subscription.dispose();
    this.item.dispose();
  }
}

function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/**
 * Tooltip lists every in-flight call with its own elapsed time — reviewers
 * with two concurrent operations (git + LLM) can see both without waiting for
 * the label to rotate.
 */
function buildTooltip(state: ProgressState): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown('**Semantic Diff Tracer — in flight**\n\n');
  const now = Date.now();
  for (const entry of state.active) {
    const elapsed = formatElapsed(now - entry.startedAt);
    md.appendMarkdown(`- \`${entry.scope}\` ${entry.message} — **${elapsed}**\n`);
  }
  md.appendMarkdown('\n_Click to open the log._');
  return md;
}
