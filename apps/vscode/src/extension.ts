import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type {
  BlockPath,
  Conversation,
  DiffPort,
  Flow,
  LlmProvider,
  Mock,
  PerspectiveDraft,
  PrPort,
  PrRef,
  QaSection,
  SessionStorePort,
  StepAction,
} from '@semantic-diff-tracer/core';
import {
  askQa,
  blockAt,
  dfsPaths,
  extractPerspectives,
  followUpQa,
  planFlow,
  prRefKey,
  refineFlowFromMock,
  deleteQaSection,
  sessionKey,
  stepFlow,
  summarize,
} from '@semantic-diff-tracer/core';
import {
  GitDiffAdapter,
  cleanupCheckouts,
  ensureCheckout,
  listSdtCheckouts,
  resolveLocalRef,
} from '@semantic-diff-tracer/diff-git';
import { OctokitPrAdapter } from '@semantic-diff-tracer/github-octokit';
import { FileSessionStore } from '@semantic-diff-tracer/session-store-fs';
import { SidePanelProvider } from './views/side-panel.js';
import {
  PerspectivePanel,
  type PerspectiveSnapshot,
  type PerspectiveTab,
} from './panels/perspective-panel.js';
import { getGithubAccessToken } from './auth/github.js';
import { openGitDiff, registerGitBlobProvider } from './diff-view.js';
import { VscodeNotifier } from './notifier.js';
import { classifyFolder, type BaretreeWorktree } from './workspace/resolve-worktree.js';
import { VscodeLogger } from './logger.js';
import { ProgressTracker } from './progress.js';
import { ProgressStatusBar } from './progress-status-bar.js';
import { pickPr } from './pr/pick-pr.js';
import {
  buildClaudeProvider,
  readDefaultBaseBranch,
  readFlowMaxTurns,
  readLanguageHint,
} from './llm/settings.js';
import {
  makeInitialState,
  type ExtensionState,
  type PerspectiveLoading,
} from './state.js';

interface Deps {
  llm: LlmProvider;
  diff: DiffPort;
  sessionStore: SessionStorePort;
  getPrPort: () => Promise<{ port: PrPort; token: string | null }>;
}

export function activate(context: vscode.ExtensionContext): void {
  const openedFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const state: ExtensionState = makeInitialState();
  const notifier = new VscodeNotifier();
  const outputChannel = vscode.window.createOutputChannel('Semantic Diff Tracer');
  context.subscriptions.push(outputChannel);
  const progressTracker = new ProgressTracker();
  const logger = new VscodeLogger(outputChannel, progressTracker);
  const statusBar = new ProgressStatusBar(progressTracker);
  context.subscriptions.push(statusBar);
  logger.info('extension', 'activate', { openedFolder: openedFolder ?? null });

  let deps: Deps = fallbackDeps();

  // Reads through the live `deps`, which buildDeps() swaps once the workspace
  // (or PR checkout) is resolved.
  context.subscriptions.push(
    registerGitBlobProvider((sha, file) => deps.diff.readFileAtSha(sha, file)),
  );

  const sidePanel = new SidePanelProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('sdt.side', sidePanel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  // Initial welcome state: 'no-workspace' when no folder is open, otherwise
  // 'idle' so the welcome UI shows Open PR / Review Current Branch / …
  if (openedFolder) sidePanel.showIdle();
  else sidePanel.showNoWorkspace();

  // ---------------- workspace resolution ----------------

  async function ensureWorkspaceRoot(): Promise<string | null> {
    if (state.workspaceRoot) return state.workspaceRoot;
    if (!openedFolder) {
      notifier.error('Semantic Diff Tracer: open a workspace folder first.');
      return null;
    }
    const resolved = await resolveTargetWorkingTree(openedFolder, context);
    if (!resolved) return null;
    state.workspaceRoot = resolved;
    deps = buildDeps(resolved, context);
    return resolved;
  }

  // ---------------- load a PR ----------------

  async function loadForRef(ref: PrRef): Promise<void> {
    const root = await ensureWorkspaceRoot();
    if (!root) return;
    // Fresh PR -> clear per-perspective caches so stale summaries/flows don't leak.
    state.ref = ref;
    state.set = undefined;
    state.diff = undefined;
    state.summaries.clear();
    state.summaryInFlight.clear();
    state.flows.clear();
    state.flowInFlight.clear();
    state.loading.clear();
    state.qa.clear();
    // Perspective ids are LLM-authored slugs and repeat across PRs, so the
    // trace scratchpad has to go too — its source cache is keyed by path alone
    // and would otherwise serve the previous PR's file contents.
    traceLocal.clear();

    let meta: NonNullable<ExtensionState['prMeta']>;
    if (ref.kind === 'github') {
      const { port, token } = await deps.getPrPort();
      state.githubToken = token ?? undefined;
      const raw = await logger.time('github', 'octokit.pulls.get', () => port.fetchMeta(ref));
      meta = {
        title: raw.title,
        body: raw.body,
        author: raw.author,
        baseRef: raw.baseRef,
        headRef: raw.headRef,
        ...(raw.url ? { url: raw.url } : {}),
      };
    } else {
      meta = {
        title: `${ref.baseRef}..${ref.headRef}`,
        body: '',
        author: '',
        baseRef: ref.baseRef,
        headRef: ref.headRef,
      };
    }
    state.prMeta = meta;
    sidePanel.showLoading(
      ref,
      { title: meta.title, ...(meta.url ? { url: meta.url } : {}) },
      'Extracting perspectives…',
    );

    try {
      const set = await notifier.progress('Semantic Diff Tracer: extracting perspectives', async () => {
        const unified = await logger.time('diff', 'diff.getDiff', () => deps.diff.getDiff(ref));
        // Keep the raw diff around so the Summary tab can badge Flow blocks with what
        // they change (added / modified / removed / unchanged) at render time.
        state.diff = unified;
        return extractPerspectives(
          { llm: deps.llm, sessionStore: deps.sessionStore, logger, language: readLanguageHint() },
          { ref, meta, diff: unified },
        );
      });
      state.set = set;
      sidePanel.showReady(
        ref,
        { title: meta.title, ...(meta.url ? { url: meta.url } : {}) },
        set,
      );
      notifier.info(`Semantic Diff Tracer: ${set.perspectives.length} perspective(s) extracted.`);
    } catch (e) {
      logger.error('extract', 'failed', { error: (e as Error).message });
      notifier.error(`Failed to extract perspectives: ${(e as Error).message}`);
      sidePanel.showIdle();
    }
  }

  // ---------------- unified perspective panel ----------------

  function findPerspective(id: string): PerspectiveDraft | undefined {
    return state.set?.perspectives.find((p) => p.id === id);
  }

  /**
   * Per-perspective trace scratchpad. Kept alive across panel closes/reopens
   * so the reviewer's cursor and cached source files don't vanish.
   */
  interface TraceLocal {
    cursor: BlockPath;
    history: BlockPath[];
    fullCodeByFile: Record<string, string>;
    fullBeforeCodeByFile: Record<string, string>;
    refinementInFlight?: string | null;
  }
  const traceLocal = new Map<string, TraceLocal>();
  function ensureTraceLocal(id: string): TraceLocal {
    let local = traceLocal.get(id);
    if (!local) {
      local = { cursor: [0], history: [], fullCodeByFile: {}, fullBeforeCodeByFile: {} };
      traceLocal.set(id, local);
    }
    return local;
  }

  function perspectiveSnapshot(
    perspective: PerspectiveDraft,
    opts?: { activeTab?: PerspectiveTab },
  ): PerspectiveSnapshot {
    const local = ensureTraceLocal(perspective.id);
    const s: PerspectiveSnapshot = {
      perspective,
      sections: state.qa.get(perspective.id) ?? [],
      loading: { ...(state.loading.get(perspective.id) ?? {}) },
      trace: {
        cursor: local.cursor,
        history: local.history,
        fullCodeByFile: local.fullCodeByFile,
        fullBeforeCodeByFile: local.fullBeforeCodeByFile,
        refinementInFlight: local.refinementInFlight ?? null,
      },
    };
    const summary = state.summaries.get(perspective.id);
    if (summary) s.summary = summary;
    const flow = state.flows.get(perspective.id);
    if (flow) s.flow = flow;
    if (opts?.activeTab) s.activeTab = opts.activeTab;
    return s;
  }

  function refreshPanel(perspective: PerspectiveDraft): void {
    const panel = PerspectivePanel.get(perspective.id);
    if (!panel) return;
    panel.update(perspectiveSnapshot(perspective));
  }

  // ---------------- loading progress ----------------

  type LoadKind = keyof PerspectiveLoading;

  function loadingFor(perspectiveId: string): PerspectiveLoading {
    let entry = state.loading.get(perspectiveId);
    if (!entry) {
      entry = {};
      state.loading.set(perspectiveId, entry);
    }
    return entry;
  }

  function beginLoading(
    perspective: PerspectiveDraft,
    kind: LoadKind,
    phase: string,
    steps: number,
  ): void {
    loadingFor(perspective.id)[kind] = { phase, step: 0, steps, startedAt: Date.now() };
    refreshPanel(perspective);
  }

  /** Close out the current stage and name the next one. */
  function advanceLoading(perspective: PerspectiveDraft, kind: LoadKind, phase: string): void {
    const task = loadingFor(perspective.id)[kind];
    if (!task) return;
    task.step = Math.min(task.step + 1, task.steps);
    task.phase = phase;
    refreshPanel(perspective);
  }

  function endLoading(perspective: PerspectiveDraft, kind: LoadKind): void {
    delete loadingFor(perspective.id)[kind];
    refreshPanel(perspective);
  }

  async function openPerspective(
    perspective: PerspectiveDraft,
    opts?: { tab?: PerspectiveTab; blockId?: string },
  ): Promise<void> {
    if (!state.ref) {
      notifier.warn('Semantic Diff Tracer: no PR loaded yet.');
      return;
    }
    const tab = opts?.tab ?? 'summary';
    // Position the cursor before the first render so the Trace tab lands on
    // the requested block right away.
    if (opts?.blockId) {
      const existingFlow = state.flows.get(perspective.id);
      if (existingFlow) {
        const path = findPathForBlockId(existingFlow, opts.blockId);
        if (path) ensureTraceLocal(perspective.id).cursor = path;
      }
    }
    const initial = perspectiveSnapshot(perspective, { activeTab: tab });
    PerspectivePanel.openFor(context, perspective, perspectiveCallbacks(), initial);

    const pending = hydratePerspective(perspective);
    if (!opts?.blockId) return;
    // The caller asked for a specific block, so the cursor can only be placed
    // once planFlow has produced the tree it lives in.
    const flow = await pending.flow;
    if (!flow) return;
    const path = findPathForBlockId(flow, opts.blockId);
    if (!path) return;
    ensureTraceLocal(perspective.id).cursor = path;
    refreshPanel(perspective);
  }

  /**
   * Warm both halves of the panel. Summary and Trace share one webview, so a
   * reviewer who opens either side almost always wants the other ready too.
   * Both `ensure*` calls dedupe against their in-flight promise, which makes
   * this safe to re-enter on every open and every tab switch.
   */
  function hydratePerspective(perspective: PerspectiveDraft): {
    summary: Promise<void>;
    flow: Promise<Flow | undefined>;
  } {
    return {
      summary: ensureSummary(perspective).then(() => refreshPanel(perspective)),
      flow: ensureFlow(perspective).then((flow) => {
        refreshPanel(perspective);
        return flow;
      }),
    };
  }

  /**
   * Fetch the Summary payload once per perspective. Callers share the in-flight
   * promise: without that, reopening the panel or flipping tabs mid-load spends
   * another LLM turn and leaves an orphan session behind, because every
   * concurrent run writes its own id to `summary:{pid}` and the last one wins.
   */
  async function ensureSummary(perspective: PerspectiveDraft): Promise<void> {
    if (state.summaries.has(perspective.id)) return;
    if (!state.ref) return;
    const running = state.summaryInFlight.get(perspective.id);
    if (running) return running;
    const ref = state.ref;
    const promise = (async () => {
      beginLoading(perspective, 'summary', 'Summarising the perspective', 1);
      try {
        const payload = await summarize(
          {
            llm: deps.llm,
            sessionStore: deps.sessionStore,
            logger,
            language: readLanguageHint(),
          },
          { ref, perspective },
        );
        state.summaries.set(perspective.id, payload);
      } catch (e) {
        logger.error('summary', 'summarize failed', {
          perspectiveId: perspective.id,
          error: (e as Error).message,
        });
        notifier.error(`Summary failed: ${(e as Error).message}`);
      } finally {
        state.summaryInFlight.delete(perspective.id);
        endLoading(perspective, 'summary');
      }
    })();
    state.summaryInFlight.set(perspective.id, promise);
    return promise;
  }

  /**
   * Plan the flow and fill the source cache it renders against. Source loading
   * lives inside the in-flight promise so concurrent openers share one round of
   * `git show` calls as well as the LLM turn. Failures resolve to `undefined`
   * rather than rejecting — every caller treats a missing flow as "not ready".
   */
  async function ensureFlow(perspective: PerspectiveDraft): Promise<Flow | undefined> {
    if (state.flows.has(perspective.id)) return state.flows.get(perspective.id);
    if (!state.ref) return undefined;
    const running = state.flowInFlight.get(perspective.id);
    if (running) return running;
    const ref = state.ref;
    const promise = (async () => {
      beginLoading(perspective, 'flow', 'Planning the flow', 2);
      try {
        const flow = await planFlow(
          {
            llm: deps.llm,
            diff: deps.diff,
            sessionStore: deps.sessionStore,
            logger,
            language: readLanguageHint(),
            maxTurns: readFlowMaxTurns(),
          },
          { ref, perspective },
        );
        state.flows.set(perspective.id, flow);
        advanceLoading(perspective, 'flow', 'Loading source files');
        const local = ensureTraceLocal(perspective.id);
        await hydrateFullCode(flow, local.fullCodeByFile, local.fullBeforeCodeByFile);
        return flow;
      } catch (e) {
        logger.error('flow', 'planFlow failed', {
          perspectiveId: perspective.id,
          error: (e as Error).message,
        });
        notifier.error(`Flow planning failed: ${(e as Error).message}`);
        return undefined;
      } finally {
        state.flowInFlight.delete(perspective.id);
        endLoading(perspective, 'flow');
      }
    })();
    state.flowInFlight.set(perspective.id, promise);
    return promise;
  }

  /**
   * Base-side path for an after-side file, so renames keep their Before view.
   * A file the diff doesn't mention (a context block on unchanged code) keeps
   * its path — base and head agree on it by definition. `undefined` means the
   * file is new and has no base side at all.
   */
  function baseSidePath(afterFile: string): string | undefined {
    const fd = state.diff?.files.find((f) => f.path === afterFile);
    if (!fd) return afterFile;
    if (fd.status === 'added') return undefined;
    return fd.oldPath ?? afterFile;
  }

  async function hydrateFullCode(
    flow: Flow,
    afterCache: Record<string, string>,
    beforeCache: Record<string, string>,
  ): Promise<void> {
    if (!state.ref) return;
    const headSha = state.ref.headSha;
    const baseSha = state.ref.baseSha;
    const afterFiles = new Set<string>();
    const beforeFiles = new Set<string>();
    for (const p of dfsPaths(flow)) {
      const b = blockAt(flow, p);
      if (!b) continue;
      if (b.focus.file) {
        afterFiles.add(b.focus.file);
        const basePath = baseSidePath(b.focus.file);
        if (basePath) beforeFiles.add(basePath);
      }
      if (b.beforeFocus?.file) beforeFiles.add(b.beforeFocus.file);
    }
    await Promise.all([
      ...Array.from(afterFiles).map(async (file) => {
        if (afterCache[file] !== undefined) return;
        try {
          const content = await deps.diff.readFileAtSha(headSha, file);
          afterCache[file] = content ?? '';
        } catch {
          afterCache[file] = '';
        }
      }),
      ...Array.from(beforeFiles).map(async (file) => {
        if (beforeCache[file] !== undefined) return;
        try {
          const content = await deps.diff.readFileAtSha(baseSha, file);
          beforeCache[file] = content ?? '';
        } catch {
          beforeCache[file] = '';
        }
      }),
    ]);
  }

  function perspectiveCallbacks() {
    return {
      onAskQa: async (
        perspectiveId: string,
        question: string,
        contextRef:
          | { selection: string; file?: string; startLine?: number; endLine?: number }
          | undefined,
        forkOrigin: 'summary' | 'flow',
      ) => {
        const p = findPerspective(perspectiveId);
        if (!p || !state.ref) return;
        // Both fork sources need to exist before we can fork. `summary` is
        // seeded eagerly on Summary open; `flow` needs planFlow to have run.
        if (forkOrigin === 'flow') await ensureFlow(p);
        else await ensureSummary(p);
        try {
          const section = await askQa(
            {
              llm: deps.llm,
              sessionStore: deps.sessionStore,
              logger,
              language: readLanguageHint(),
            },
            {
              ref: state.ref,
              perspectiveId,
              question,
              forkOrigin,
              ...(contextRef ? { contextRef } : {}),
            },
          );
          const list = state.qa.get(perspectiveId) ?? [];
          list.unshift(section);
          state.qa.set(perspectiveId, list);
          refreshPanel(p);
        } catch (e) {
          notifier.error(`Ask failed: ${(e as Error).message}`);
        }
      },
      onFollowUp: async (perspectiveId: string, sectionId: string, question: string) => {
        const p = findPerspective(perspectiveId);
        if (!p || !state.ref) return;
        const list = state.qa.get(perspectiveId);
        const section = list?.find((s) => s.sectionId === sectionId);
        if (!list || !section) return;
        try {
          const updated = await followUpQa(
            {
              llm: deps.llm,
              sessionStore: deps.sessionStore,
              logger,
              language: readLanguageHint(),
            },
            { ref: state.ref, perspectiveId, section, question },
          );
          const idx = list.findIndex((s) => s.sectionId === sectionId);
          if (idx >= 0) list[idx] = updated;
          refreshPanel(p);
        } catch (e) {
          notifier.error(`Follow-up failed: ${(e as Error).message}`);
        }
      },
      onDeleteSection: async (perspectiveId: string, sectionId: string) => {
        const p = findPerspective(perspectiveId);
        if (!p || !state.ref) return;
        const list = state.qa.get(perspectiveId) ?? [];
        state.qa.set(
          perspectiveId,
          list.filter((s) => s.sectionId !== sectionId),
        );
        try {
          await deleteQaSection(
            { sessionStore: deps.sessionStore, logger },
            { ref: state.ref, perspectiveId, sectionId },
          );
        } finally {
          refreshPanel(p);
        }
      },
      onStep: (perspectiveId: string, action: StepAction) => {
        const p = findPerspective(perspectiveId);
        if (!p) return;
        const flow = state.flows.get(perspectiveId);
        if (!flow) return;
        const local = ensureTraceLocal(perspectiveId);
        const result = stepFlow(flow, local.cursor, action, local.history);
        if (result.next) local.cursor = result.next;
        if (result.historyPush) local.history = [...local.history, result.historyPush];
        if (result.historyPop) local.history = local.history.slice(0, -1);
        refreshPanel(p);
      },
      onGotoBlock: (perspectiveId: string, blockId: string) => {
        const p = findPerspective(perspectiveId);
        if (!p) return;
        const flow = state.flows.get(perspectiveId);
        if (!flow) return;
        const path = findPathForBlockId(flow, blockId);
        if (!path) return;
        const local = ensureTraceLocal(perspectiveId);
        local.history = [...local.history, local.cursor];
        local.cursor = path;
        refreshPanel(p);
      },
      onRefineMock: async (perspectiveId: string, mock: Mock, instruction: string) => {
        const p = findPerspective(perspectiveId);
        if (!p || !state.ref) return;
        const flow = state.flows.get(perspectiveId);
        if (!flow) return;
        const local = ensureTraceLocal(perspectiveId);
        local.refinementInFlight = mock.id;
        refreshPanel(p);
        try {
          const nextFlow = await refineFlowFromMock(
            {
              llm: deps.llm,
              diff: deps.diff,
              sessionStore: deps.sessionStore,
              logger,
              language: readLanguageHint(),
              maxTurns: readFlowMaxTurns(),
            },
            { ref: state.ref, flow, targetMock: mock, instruction },
          );
          state.flows.set(perspectiveId, nextFlow);
          local.cursor = [0];
          local.history = [];
          local.fullCodeByFile = {};
          local.fullBeforeCodeByFile = {};
          await hydrateFullCode(nextFlow, local.fullCodeByFile, local.fullBeforeCodeByFile);
        } catch (e) {
          notifier.error(`Refine failed: ${(e as Error).message}`);
        } finally {
          local.refinementInFlight = null;
          refreshPanel(p);
        }
      },
      onOpenDiff: async (file: string, line: number) => {
        if (!state.ref) return;
        try {
          const before = baseSidePath(file);
          await openGitDiff({
            baseSha: state.ref.baseSha,
            headSha: state.ref.headSha,
            file,
            ...(before ? { beforeFile: before } : {}),
            line,
          });
        } catch (e) {
          notifier.error(`Cannot diff ${file}: ${(e as Error).message}`);
        }
      },
      onOpenFile: async (file: string, line: number) => {
        const root = state.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        const uri = vscode.Uri.file(path.join(root, file));
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.One,
          });
          const target = Math.max(0, line - 1);
          const range = new vscode.Range(target, 0, target, 0);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(range.start, range.end);
        } catch (e) {
          notifier.error(`Cannot open ${file}: ${(e as Error).message}`);
        }
      },
      // The switched-to tab is not read: both halves are warmed either way, and
      // whichever one already ran returns from cache.
      onTabChange: (perspectiveId: string) => {
        const p = findPerspective(perspectiveId);
        if (!p) return;
        hydratePerspective(p);
      },
    };
  }

  // ---------------- commands ----------------

  context.subscriptions.push(
    vscode.commands.registerCommand('sdt.pickPr', async () => {
      // Do NOT gate the PR picker on ensureWorkspaceRoot(): on a baretree root
      // that would pop the "pick a worktree" prompt before the user even sees
      // the PR list. For github PRs we resolve into `.sdt/pr-N` ourselves;
      // the baretree worktree only matters for `reviewCurrentBranch`.
      if (!openedFolder) {
        notifier.error('Semantic Diff Tracer: open a workspace folder first.');
        return;
      }
      const { port } = await deps.getPrPort();
      const ref = await pickPr({ pr: port, workspaceRoot: openedFolder });
      if (!ref) return;
      if (ref.kind === 'github') {
        await notifier.progress('Semantic Diff Tracer: preparing PR checkout', async (report) => {
          report(`fetching PR head ${ref.headSha.slice(0, 8)}`);
          const checkout = await ensureCheckout(ref, {
            repoCwd: openedFolder,
            logger,
          });
          state.workspaceRoot = checkout.worktreePath;
          deps = buildDeps(checkout.worktreePath, context);
          notifier.info(
            `Semantic Diff Tracer: checkout at ${checkout.worktreePath} (${
              checkout.created ? 'created' : checkout.reset ? 'reset' : 'reused'
            }).`,
          );
        });
      }
      await loadForRef(ref);
    }),
    vscode.commands.registerCommand('sdt.reviewCurrentBranch', async () => {
      const root = await ensureWorkspaceRoot();
      if (!root) return;
      const base = readDefaultBaseBranch();
      try {
        const ref = await resolveLocalRef({ cwd: root, base });
        await loadForRef(ref);
      } catch (e) {
        notifier.error(`Failed to resolve local branch: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('sdt.refresh', async () => {
      if (!state.ref) {
        notifier.warn('Semantic Diff Tracer: no PR loaded yet.');
        return;
      }
      const oldKey = prRefKey(state.ref);
      const keys = await deps.sessionStore.listByPrefix(oldKey);
      for (const { key } of keys) await deps.sessionStore.delete(key);
      await loadForRef(state.ref);
    }),
    vscode.commands.registerCommand(
      'sdt.openSummary',
      async (arg?: { perspectiveId?: string }) => {
        if (!state.set) {
          notifier.warn('Semantic Diff Tracer: no PR loaded yet.');
          return;
        }
        const target =
          (arg?.perspectiveId ? findPerspective(arg.perspectiveId) : undefined) ??
          (await pickPerspectiveInteractively(state.set.perspectives));
        if (!target) return;
        await openPerspective(target, { tab: 'summary' });
      },
    ),
    vscode.commands.registerCommand(
      'sdt.openTrace',
      async (arg?: { perspectiveId?: string; blockId?: string }) => {
        if (!state.set) {
          notifier.warn('Semantic Diff Tracer: no PR loaded yet.');
          return;
        }
        const target =
          (arg?.perspectiveId ? findPerspective(arg.perspectiveId) : undefined) ??
          (await pickPerspectiveInteractively(state.set.perspectives));
        if (!target) return;
        await openPerspective(target, {
          tab: 'trace',
          ...(arg?.blockId ? { blockId: arg.blockId } : {}),
        });
      },
    ),
    vscode.commands.registerCommand('sdt.switchWorktree', async () => {
      if (!openedFolder) {
        notifier.error('Semantic Diff Tracer: open a workspace folder first.');
        return;
      }
      const classification = await classifyFolder(openedFolder);
      if (classification.kind !== 'baretree') {
        notifier.warn('Semantic Diff Tracer: not opened on a baretree root; nothing to switch.');
        return;
      }
      const picked = await pickWorktree(classification.worktrees);
      if (!picked) return;
      await context.workspaceState.update(worktreeMementoKey(openedFolder), picked.path);
      state.workspaceRoot = picked.path;
      deps = buildDeps(picked.path, context);
      notifier.info(
        `Semantic Diff Tracer: worktree switched to ${picked.branch}. Re-run "Open PR" or "Review Current Branch" to reload perspectives.`,
      );
    }),
    vscode.commands.registerCommand('sdt.cleanupCheckouts', async () => {
      if (!openedFolder) {
        notifier.error('Semantic Diff Tracer: open a workspace folder first.');
        return;
      }
      let entries;
      try {
        entries = await listSdtCheckouts(openedFolder);
      } catch (e) {
        notifier.error(`Failed to list checkouts: ${(e as Error).message}`);
        return;
      }
      if (entries.length === 0) {
        notifier.info('Semantic Diff Tracer: no PR checkouts to clean up.');
        return;
      }
      const items = entries.map((e) => ({
        label: `PR #${e.prNumber}`,
        description: e.head.slice(0, 12),
        detail: e.worktreePath,
        picked: true,
        entry: e,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Semantic Diff Tracer: pick checkouts to delete',
        canPickMany: true,
      });
      if (!picked || picked.length === 0) return;
      try {
        const result = await cleanupCheckouts(
          openedFolder,
          picked.map((p) => p.entry.worktreePath),
        );
        notifier.info(`Semantic Diff Tracer: removed ${result.removed.length} checkout(s).`);
        for (const f of result.failed) {
          notifier.warn(`Semantic Diff Tracer: failed to remove ${f.path}: ${f.error}`);
        }
      } catch (e) {
        notifier.error(`Cleanup failed: ${(e as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('sdt.showLog', () => logger.show()),
  );

  // ---------------- helpers ----------------

  function fallbackDeps(): Deps {
    const map = new Map<string, string>();
    const sessionStore: SessionStorePort = {
      async get(k) {
        return map.get(k);
      },
      async set(k, v) {
        map.set(k, v);
      },
      async delete(k) {
        map.delete(k);
      },
      async listByPrefix(prefix) {
        return Array.from(map.entries())
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, sessionId]) => ({ key, sessionId }));
      },
    };
    const emptyConversation: Conversation = {
      id: '',
      async ask() {
        throw new Error('Semantic Diff Tracer: LLM not initialised — open a PR first.');
      },
      fork() {
        return emptyConversation;
      },
    };
    const emptyLlm: LlmProvider = {
      startConversation: () => emptyConversation,
      resumeConversation: () => emptyConversation,
    };
    const emptyDiff: DiffPort = {
      async getDiff() {
        return { baseSha: 'BASE', headSha: 'HEAD', files: [] };
      },
      async readFileAtSha() {
        return null;
      },
    };
    return {
      llm: emptyLlm,
      diff: emptyDiff,
      sessionStore,
      // getPrPort doesn't need a workspace root — octokit only wants a token.
      // Wire the real thing so pickPr works from a baretree root before any
      // buildDeps() call has run.
      async getPrPort() {
        const token = await getGithubAccessToken();
        return { port: new OctokitPrAdapter({ token }), token };
      },
    };
  }

  function buildDeps(workspaceRoot: string, ctx: vscode.ExtensionContext): Deps {
    const llm = buildClaudeProvider(workspaceRoot, logger);
    const diff = new GitDiffAdapter({ cwd: workspaceRoot });
    const sessionStore = new FileSessionStore({
      filePath: path.join(ctx.globalStorageUri.fsPath, 'sessions.json'),
    });
    return {
      llm,
      diff,
      sessionStore,
      async getPrPort() {
        const token = await getGithubAccessToken();
        return { port: new OctokitPrAdapter({ token }), token };
      },
    };
  }
}

export function deactivate(): void {
  // no-op
}

function findPathForBlockId(flow: Flow, blockId: string): BlockPath | undefined {
  for (const path of dfsPaths(flow)) {
    const b = blockAt(flow, path);
    if (b?.id === blockId) return path;
  }
  return undefined;
}

async function pickPerspectiveInteractively(
  perspectives: PerspectiveDraft[],
): Promise<PerspectiveDraft | undefined> {
  const items = perspectives.map((p) => ({
    label: p.title,
    description: p.outcome,
    perspective: p,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Pick a perspective',
  });
  return picked?.perspective;
}

const WORKTREE_MEMENTO_KEY_PREFIX = 'sdt.selectedWorktree:';

function worktreeMementoKey(folder: string): string {
  return WORKTREE_MEMENTO_KEY_PREFIX + folder;
}

async function resolveTargetWorkingTree(
  openedFolder: string,
  context: vscode.ExtensionContext,
): Promise<string | null> {
  const classification = await classifyFolder(openedFolder);
  if (classification.kind === 'working-tree') return classification.root;
  if (classification.kind === 'not-git') {
    vscode.window.showWarningMessage(
      `Semantic Diff Tracer: ${classification.reason} Open a git working tree to enable the extension.`,
    );
    return null;
  }
  const trees = classification.worktrees;
  if (trees.length === 0) {
    vscode.window.showWarningMessage(
      'Semantic Diff Tracer: baretree root has no worktrees. Create one with `bt add -b <branch>` first.',
    );
    return null;
  }
  const key = worktreeMementoKey(openedFolder);
  const remembered = context.workspaceState.get<string>(key);
  if (remembered && trees.some((t) => t.path === remembered)) return remembered;
  if (trees.length === 1) {
    await context.workspaceState.update(key, trees[0]!.path);
    return trees[0]!.path;
  }
  const picked = await pickWorktree(trees);
  if (!picked) return null;
  await context.workspaceState.update(key, picked.path);
  return picked.path;
}

async function pickWorktree(trees: BaretreeWorktree[]): Promise<BaretreeWorktree | undefined> {
  const items = trees.map((t) => ({
    label: t.branch,
    description: t.path,
    detail: t.headSha ? `HEAD ${t.headSha.slice(0, 12)}` : '',
    tree: t,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Semantic Diff Tracer: pick the baretree worktree to review',
  });
  return picked?.tree;
}

// silence "imported but unused" — semantic-diff-tracer re-exports these for consumers that
// import through @semantic-diff-tracer/core.
void sessionKey;
