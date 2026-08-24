import * as vscode from 'vscode';
import { runGit } from '@semantic-diff-tracer/diff-git';
import type { PrPort, PrRef } from '@semantic-diff-tracer/core';
import {
  parseGithubPrUrl,
  parseNumberOnly,
  parseOwnerRepoNumber,
  parseRemoteUrl,
} from '@semantic-diff-tracer/github-octokit';

interface PickPrDeps {
  pr: PrPort;
  workspaceRoot: string | undefined;
}

interface PrQuickPickItem extends vscode.QuickPickItem {
  ref?: PrRef;
  freeform?: string;
}

/**
 * Interactive PR picker. Combines free-form input (URL / owner/repo#N / #N /
 * branch) with a live list of open PRs on the current repo. Resolves to a
 * PrRef via the injected PrPort.
 */
export async function pickPr(deps: PickPrDeps): Promise<PrRef | undefined> {
  const defaultRepo = deps.workspaceRoot
    ? await inferDefaultRepo(deps.workspaceRoot)
    : undefined;

  const qp = vscode.window.createQuickPick<PrQuickPickItem>();
  qp.title = 'Semantic Diff Tracer: pick a PR';
  qp.placeholder = defaultRepo
    ? `#123 · owner/repo#N · full URL   (defaults to ${defaultRepo.owner}/${defaultRepo.repo})`
    : '#123 needs a workspace with a github origin — try a full URL instead';
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  // Load the open-PR list up front. If it fails (no token yet, no origin),
  // fall back to free-form only.
  let openItems: PrQuickPickItem[] = [];
  if (defaultRepo) {
    try {
      const list = await deps.pr.listOpen(defaultRepo.owner, defaultRepo.repo);
      openItems = list.map((p) => ({
        label: `#${p.number} · ${p.title}`,
        description: p.isDraft ? `${p.author} · draft` : p.author,
        detail: `${p.headRef} → ${p.baseRef}`,
        alwaysShow: false,
        freeform: `${defaultRepo.owner}/${defaultRepo.repo}#${p.number}`,
      }));
    } catch {
      // ignore — the user can still type a URL
    }
  }
  qp.items = openItems;

  const dispose = qp.onDidChangeValue((value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      qp.items = openItems;
      return;
    }
    const custom: PrQuickPickItem = {
      label: `Open "${trimmed}"`,
      description: describeInput(trimmed, defaultRepo),
      alwaysShow: true,
      freeform: trimmed,
    };
    qp.items = [custom, ...openItems];
  });

  const chosen = await new Promise<PrQuickPickItem | undefined>((resolve) => {
    qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      resolve(selected);
      qp.hide();
    });
    qp.onDidHide(() => resolve(undefined));
    qp.show();
  });
  dispose.dispose();
  qp.dispose();
  if (!chosen) return undefined;

  const inputValue = chosen.freeform ?? qp.value.trim();
  return resolveInput(inputValue, deps.pr, defaultRepo);
}

function describeInput(
  value: string,
  defaultRepo: { owner: string; repo: string } | undefined,
): string {
  if (parseGithubPrUrl(value)) return 'GitHub PR URL';
  if (parseOwnerRepoNumber(value)) return 'owner/repo#N';
  if (defaultRepo && parseNumberOnly(value, defaultRepo)) {
    return `#N in ${defaultRepo.owner}/${defaultRepo.repo}`;
  }
  return 'branch name';
}

async function resolveInput(
  value: string,
  pr: PrPort,
  defaultRepo: { owner: string; repo: string } | undefined,
): Promise<PrRef | undefined> {
  const url = parseGithubPrUrl(value);
  if (url) return pr.resolve({ kind: 'number', ...url });
  const or = parseOwnerRepoNumber(value);
  if (or) return pr.resolve({ kind: 'number', ...or });
  const num = parseNumberOnly(value, defaultRepo);
  if (num) return pr.resolve({ kind: 'number', ...num });
  vscode.window.showWarningMessage(
    `Semantic Diff Tracer: could not parse "${value}" as a URL, owner/repo#N, or #N.`,
  );
  return undefined;
}

/** Best-effort: read origin's URL and parse it into owner/repo. */
export async function inferDefaultRepo(
  cwd: string,
): Promise<{ owner: string; repo: string } | undefined> {
  try {
    const raw = await runGit(['remote', 'get-url', 'origin'], { cwd });
    const parsed = parseRemoteUrl(raw.trim());
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}
