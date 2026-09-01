import type { LlmProvider } from '../ports/llm-provider.js';
import type { SessionStorePort } from '../ports/session-store.js';
import { sessionKey } from '../ports/session-store.js';
import type { LoggerPort } from '../ports/logger.js';
import { nullLogger } from '../ports/logger.js';
import type { DiffPort } from '../ports/diff.js';
import type { PrRef } from '../domain/pr-ref.js';
import { prRefKey } from '../domain/pr-ref.js';
import type { UnifiedDiff } from '../domain/diff.js';
import type { PerspectiveDraft } from '../domain/perspective.js';
import type { Flow } from '../domain/flow.js';
import { traceModeFor } from '../domain/perspective.js';
import type { TraceDepth } from '../domain/trace-depth.js';
import { DEFAULT_TRACE_DEPTH } from '../domain/trace-depth.js';
import { buildFlowSystemPrompt, buildFlowUserMessage } from '../prompts/flow.js';
import { parseJsonStrict } from './json-parse.js';
import {
  buildHunkOnlyCodeContext,
  buildPerspectiveCodeContext,
} from './perspective-code-context.js';
import {
  assignRoles,
  clipFocalBudgets,
  collectMocks,
  countBlocks,
  dedupeAdjacentBlocks,
  hydrateFlowCode,
  normalizeFromRawBlocks,
} from './plan-flow-internals.js';

export interface PlanFlowDeps {
  llm: LlmProvider;
  diff: DiffPort;
  sessionStore: SessionStorePort;
  logger?: LoggerPort;
  language?: string;
  /**
   * Cap on agent turns for the plan-flow ask. Adapters that don't run an
   * agentic loop ignore it. Keep it small (default 5 in the extension) —
   * planFlow is a one-shot structured output task, not open-ended work.
   * Ignored when `traceDepth === 'normal'` (forced to 1).
   */
  maxTurns?: number;
  newFlowId?: () => string;
}

export interface PlanFlowArgs {
  ref: PrRef;
  perspective: PerspectiveDraft;
  /** Pre-fetched diff — pass through when the caller already has one to avoid a redundant getDiff. */
  diff?: UnifiedDiff;
  /**
   * How much source the ask gets to see. `normal` (default) sends only the
   * diff hunks, disables tools, and caps the ask at one turn. `deep` loads
   * full/sliced file bodies and lets the model run Grep.
   */
  traceDepth?: TraceDepth;
}

export async function planFlow(deps: PlanFlowDeps, args: PlanFlowArgs): Promise<Flow> {
  const log = deps.logger ?? nullLogger;
  const key = prRefKey(args.ref);

  // Fetch the diff once — used both for the preloaded code context and later
  // for role assignment on the returned blocks.
  const unified = args.diff ?? (await deps.diff.getDiff(args.ref));
  const traceDepth = args.traceDepth ?? DEFAULT_TRACE_DEPTH;
  const codeContext = traceDepth === 'deep'
    ? await buildPerspectiveCodeContext(args.ref, args.perspective, unified, deps.diff)
    : buildHunkOnlyCodeContext(args.perspective, unified);
  log.info('flow', 'planFlow ask', {
    perspectiveId: args.perspective.id,
    kind: args.perspective.kind,
    traceMode: traceModeFor(args.perspective.kind),
    traceDepth,
    fullFiles: codeContext.fullFiles.length,
    slicedFiles: codeContext.slicedFiles.length,
    hunkOnlyFiles: codeContext.hunkOnlyFiles.length,
    codeContextBytes: codeContext.bytes,
  });

  const user = buildFlowUserMessage(args.perspective, codeContext.text);
  // Fresh conversation — inheriting the extract/perspective session did not
  // cut Read-tool turns and instead pumped 300k+ cacheRead tokens per call.
  const conversation = deps.llm.startConversation();
  // normal → single-shot: no tools, one turn. deep → keep the agentic loop.
  const askOptions =
    traceDepth === 'normal'
      ? { tools: [] as string[], maxTurns: 1 }
      : {
          tools: ['Grep'],
          ...(deps.maxTurns ? { maxTurns: deps.maxTurns } : {}),
        };
  const { text } = await log.time('flow', 'llm.ask (planFlow)', () =>
    conversation.ask({
      system: buildFlowSystemPrompt(args.perspective.kind),
      user,
      ...askOptions,
      ...(deps.language ? { language: deps.language } : {}),
    }),
  );
  await deps.sessionStore.set(
    sessionKey(key, { kind: 'flow', perspectiveId: args.perspective.id }),
    conversation.id,
  );

  const raw = parseJsonStrict<{ blocks?: unknown }>(text);
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const normalised = normalizeFromRawBlocks(rawBlocks, args.perspective.id);
  await hydrateFlowCode(normalised, args.ref, deps.diff);
  assignRoles(normalised, unified);
  const blocks = dedupeAdjacentBlocks(normalised);
  clipFocalBudgets(blocks);
  const allMocks = collectMocks(blocks);
  const flow: Flow = {
    flowId: deps.newFlowId?.() ?? `flow-${Date.now()}-${args.perspective.id}`,
    perspectiveId: args.perspective.id,
    blocks,
    allMocks,
  };
  log.info('flow', 'planFlow ready', {
    perspectiveId: args.perspective.id,
    totalBlocks: countBlocks(blocks),
    mocks: allMocks.length,
  });
  return flow;
}
