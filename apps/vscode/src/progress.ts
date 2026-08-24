import { EventEmitter } from 'node:events';

export interface ProgressEntry {
  id: number;
  scope: string;
  message: string;
  startedAt: number;
}

export interface ProgressState {
  /** Every in-flight tracked call, oldest first. */
  active: ProgressEntry[];
  /** The most recently pushed entry, if any. Convenience for status bar label. */
  latest: ProgressEntry | undefined;
}

/**
 * Tracks in-flight long-running operations across the extension. Wraps calls
 * through `track(scope, message, task)` and notifies subscribers each time the
 * active set changes — a status bar item and the webview overlays both listen
 * for this so the reviewer can always see what's blocking.
 */
export class ProgressTracker {
  private nextId = 1;
  private readonly active = new Map<number, ProgressEntry>();
  private readonly bus = new EventEmitter();

  onChange(listener: (state: ProgressState) => void): { dispose(): void } {
    this.bus.on('change', listener);
    return { dispose: () => this.bus.off('change', listener) };
  }

  snapshot(): ProgressState {
    const active = Array.from(this.active.values()).sort((a, b) => a.id - b.id);
    return { active, latest: active[active.length - 1] };
  }

  async track<T>(scope: string, message: string, task: () => Promise<T>): Promise<T> {
    const entry: ProgressEntry = {
      id: this.nextId++,
      scope,
      message,
      startedAt: Date.now(),
    };
    this.active.set(entry.id, entry);
    this.emit();
    try {
      return await task();
    } finally {
      this.active.delete(entry.id);
      this.emit();
    }
  }

  private emit(): void {
    this.bus.emit('change', this.snapshot());
  }
}
