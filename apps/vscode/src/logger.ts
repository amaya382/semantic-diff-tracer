import * as vscode from 'vscode';
import type { LoggerPort } from '@semantic-diff-tracer/core';
import type { ProgressTracker } from './progress.js';

/**
 * LoggerPort implementation that writes to a dedicated VSCode output channel.
 * All lines are prefixed with a timestamp, level, and scope so the log is
 * greppable from the output view directly. When a ProgressTracker is attached,
 * every `time()` scope is also pushed onto the tracker so status bar / webview
 * overlays can show what's currently in flight.
 */
export class VscodeLogger implements LoggerPort {
  constructor(
    private readonly channel: vscode.OutputChannel,
    private readonly progress?: ProgressTracker,
  ) {}

  info(scope: string, message: string, data?: Record<string, unknown>): void {
    this.write('info', scope, message, data);
  }
  warn(scope: string, message: string, data?: Record<string, unknown>): void {
    this.write('warn', scope, message, data);
  }
  error(scope: string, message: string, data?: Record<string, unknown>): void {
    this.write('error', scope, message, data);
  }

  async time<T>(scope: string, message: string, task: () => Promise<T>): Promise<T> {
    const started = Date.now();
    this.write('info', scope, `${message} — start`);
    const wrapped = async (): Promise<T> => {
      try {
        const result = await task();
        this.write('info', scope, `${message} — done in ${Date.now() - started}ms`);
        return result;
      } catch (e) {
        this.write('error', scope, `${message} — failed in ${Date.now() - started}ms`, {
          error: (e as Error).message,
        });
        throw e;
      }
    };
    if (this.progress) {
      return this.progress.track(scope, message, wrapped);
    }
    return wrapped();
  }

  private write(
    level: 'info' | 'warn' | 'error',
    scope: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const suffix = data && Object.keys(data).length > 0 ? ' ' + JSON.stringify(data) : '';
    this.channel.appendLine(`${ts} [${level.toUpperCase()}] ${scope}: ${message}${suffix}`);
  }

  show(): void {
    this.channel.show(true);
  }
}
