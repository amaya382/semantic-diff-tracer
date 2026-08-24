import * as vscode from 'vscode';

/**
 * Toast + progress notifications. This is a VSCode-only helper — the TUI
 * writes progress to its logger directly, and no usecase depends on this
 * surface, so it deliberately does not implement a core port.
 */
export class VscodeNotifier {
  info(message: string): void {
    vscode.window.showInformationMessage(message);
  }
  warn(message: string): void {
    vscode.window.showWarningMessage(message);
  }
  error(message: string): void {
    vscode.window.showErrorMessage(message);
  }
  async progress<T>(title: string, task: (report: (msg: string) => void) => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      async (progress) => task((msg) => progress.report({ message: msg })),
    );
  }
}
