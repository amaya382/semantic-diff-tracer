import type { LlmProvider } from '../ports/llm-provider.js';
import type { SessionStorePort } from '../ports/session-store.js';
import { sessionKey } from '../ports/session-store.js';
import type { LoggerPort } from '../ports/logger.js';
import { nullLogger } from '../ports/logger.js';
import type { DiffPort } from '../ports/diff.js';
import type { PrRef } from '../domain/pr-ref.js';
import { prRefKey } from '../domain/pr-ref.js';
import type { Flow, Mock } from '../domain/flow.js';
import { REFINE_MOCK_SYSTEM_PROMPT, buildRefineMockUserMessage } from '../prompts/refine-mock.js';
import { parseJsonStrict } from './json-parse.js';
import {
  assignRoles,
  collectMocks,
  dedupeAdjacentBlocks,
  hydrateFlowCode,
  normalizeFromRawBlocks,
} from './plan-flow-internals.js';

export interface RefineFlowDeps {
  llm: LlmProvider;
  diff: DiffPort;
  sessionStore: SessionStorePort;
  logger?: LoggerPort;
  language?: string;
  /** Cap on agent turns for the refine ask. See PlanFlowDeps.maxTurns. */
  maxTurns?: number;
  newFlowId?: () => string;
}

export interface RefineFlowFromMockArgs {
  ref: PrRef;
  flow: Flow;
  targetMock: Mock;
  instruction: string;
}

/**
 * Re-plan the flow tree under a mock change. Resumes the flow session so the
 * LLM keeps the original context and only touches downstream blocks. Returns
 * the whole new flow.
 */
export async function refineFlowFromMock(
  deps: RefineFlowDeps,
  args: RefineFlowFromMockArgs,
): Promise<Flow> {
  const log = deps.logger ?? nullLogger;
  const key = prRefKey(args.ref);
  const flowSession = await deps.sessionStore.get(
    sessionKey(key, { kind: 'flow', perspectiveId: args.flow.perspectiveId }),
  );
  if (!flowSession) {
    throw new Error(
      `No live flow session for perspective ${args.flow.perspectiveId}. Re-open the Trace tab to re-plan.`,
    );
  }

  const user = buildRefineMockUserMessage(args.flow, args.targetMock, args.instruction);
  const conversation = deps.llm.resumeConversation(flowSession);
  const { text } = await log.time('flow', 'llm.ask (refineFlowFromMock)', () =>
    conversation.ask({
      system: REFINE_MOCK_SYSTEM_PROMPT,
      user,
      ...(deps.language ? { language: deps.language } : {}),
      ...(deps.maxTurns ? { maxTurns: deps.maxTurns } : {}),
    }),
  );
  await deps.sessionStore.set(
    sessionKey(key, { kind: 'flow', perspectiveId: args.flow.perspectiveId }),
    conversation.id,
  );

  const raw = parseJsonStrict<{ blocks?: unknown }>(text);
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const normalised = normalizeFromRawBlocks(rawBlocks, args.flow.perspectiveId);
  await hydrateFlowCode(normalised, args.ref, deps.diff);
  const unified = await deps.diff.getDiff(args.ref);
  assignRoles(normalised, unified);
  const blocks = dedupeAdjacentBlocks(normalised);
  const allMocks = collectMocks(blocks);
  return {
    flowId: deps.newFlowId?.() ?? `${args.flow.flowId}+refined-${Date.now()}`,
    perspectiveId: args.flow.perspectiveId,
    blocks,
    allMocks,
  };
}
