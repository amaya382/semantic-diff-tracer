import type { LlmProvider } from '../ports/llm-provider.js';
import type { SessionStorePort } from '../ports/session-store.js';
import { sessionKey } from '../ports/session-store.js';
import type { LoggerPort } from '../ports/logger.js';
import { nullLogger } from '../ports/logger.js';
import type { DiffPort } from '../ports/diff.js';
import type { PrRef } from '../domain/pr-ref.js';
import { prRefKey } from '../domain/pr-ref.js';
import type { PerspectiveDraft } from '../domain/perspective.js';
import type { Flow } from '../domain/flow.js';
import { traceModeFor } from '../domain/perspective.js';
import { buildFlowSystemPrompt, buildFlowUserMessage } from '../prompts/flow.js';
import { parseJsonStrict } from './json-parse.js';
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
   * agentic loop ignore it. Keep it small (default 20 in the extension) —
   * planFlow is a one-shot structured output task, not open-ended work.
   */
  maxTurns?: number;
  newFlowId?: () => string;
}

export interface PlanFlowArgs {
  ref: PrRef;
  perspective: PerspectiveDraft;
}

export async function planFlow(deps: PlanFlowDeps, args: PlanFlowArgs): Promise<Flow> {
  const log = deps.logger ?? nullLogger;
  const key = prRefKey(args.ref);
  const perspectiveSession = await deps.sessionStore.get(
    sessionKey(key, { kind: 'perspective', perspectiveId: args.perspective.id }),
  );
  const baseSession = await deps.sessionStore.get(sessionKey(key, { kind: 'base' }));
  const parent = perspectiveSession ?? baseSession;

  const user = buildFlowUserMessage(args.perspective);
  log.info('flow', 'planFlow ask', {
    perspectiveId: args.perspective.id,
    kind: args.perspective.kind,
    traceMode: traceModeFor(args.perspective.kind),
    parent: parent ?? '(none)',
  });
  const conversation = parent
    ? deps.llm.resumeConversation(parent).fork()
    : deps.llm.startConversation();
  const { text } = await log.time('flow', 'llm.ask (planFlow)', () =>
    conversation.ask({
      system: buildFlowSystemPrompt(args.perspective.kind),
      user,
      ...(deps.language ? { language: deps.language } : {}),
      ...(deps.maxTurns ? { maxTurns: deps.maxTurns } : {}),
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
  const unified = await deps.diff.getDiff(args.ref);
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
