/**
 * Structured logging port. Callers use this for developer-facing traces (LLM
 * calls, subprocess launches, cache hits) — not user-facing notifications.
 */
export interface LoggerPort {
  info(scope: string, message: string, data?: Record<string, unknown>): void;
  warn(scope: string, message: string, data?: Record<string, unknown>): void;
  error(scope: string, message: string, data?: Record<string, unknown>): void;
  /**
   * Wraps a promise so `<scope>: <message> — start` and `... — done in Xms`
   * bracket the call. Errors are logged with the elapsed time before being
   * re-thrown.
   */
  time<T>(scope: string, message: string, task: () => Promise<T>): Promise<T>;
}

export const nullLogger: LoggerPort = {
  info() {},
  warn() {},
  error() {},
  async time<T>(_scope: string, _message: string, task: () => Promise<T>): Promise<T> {
    return task();
  },
};
