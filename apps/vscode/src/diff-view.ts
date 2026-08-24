import * as vscode from 'vscode';

/**
 * Virtual documents holding git blobs, so the Trace tab can open a real diff
 * editor without writing temp files. The workspace on disk is not usable as
 * the right-hand side: for a local-branch review it may carry uncommitted
 * edits, and the reviewer asked to see the PR, not the working tree.
 */
const SCHEME = 'sdt-git';

/**
 * The sha rides in the query rather than the authority — VS Code lowercases an
 * authority, and the path segment keeps the file name readable in the editor
 * tab.
 */
export function gitBlobUri(sha: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: `/${filePath}`, query: sha });
}

export function registerGitBlobProvider(
  readBlob: (sha: string, filePath: string) => Promise<string | null>,
): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    async provideTextDocumentContent(uri): Promise<string> {
      // A missing blob is the normal case for the base side of an added file;
      // an empty document renders it as a pure addition.
      return (await readBlob(uri.query, uri.path.replace(/^\//, ''))) ?? '';
    },
  });
}

export interface OpenDiffArgs {
  baseSha: string;
  headSha: string;
  /** Post-merge path; also the right-hand side of the diff. */
  file: string;
  /** Pre-merge path. Differs from `file` on a rename, absent for a new file. */
  beforeFile?: string;
  /** Head-side line to scroll to once the diff opens. */
  line?: number;
}

export async function openGitDiff(args: OpenDiffArgs): Promise<void> {
  const left = gitBlobUri(args.baseSha, args.beforeFile ?? args.file);
  const right = gitBlobUri(args.headSha, args.file);
  const name = args.file.split('/').pop() ?? args.file;
  const renamed = args.beforeFile && args.beforeFile !== args.file;
  const title = renamed ? `${args.beforeFile} → ${name} (PR diff)` : `${name} (PR diff)`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title, {
    preview: true,
    viewColumn: vscode.ViewColumn.One,
  });
  if (args.line === undefined) return;
  // vscode.diff focuses the modified (right) pane, so the head-side line
  // number applies directly.
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== right.toString()) return;
  const target = Math.max(0, args.line - 1);
  const range = new vscode.Range(target, 0, target, 0);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  editor.selection = new vscode.Selection(range.start, range.end);
}
