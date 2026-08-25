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
  applyRefinedFlowPatch,
  collectMocks,
  countBlocks,
  parseRefinedFlowPatch,
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
 * LLM keeps the preloaded code context from `planFlow` and only touches
 * downstream blocks. The LLM returns a `RefinedFlowPatch` (see
 * `plan-flow-internals.ts`) that we apply to the current tree; the returned
 * `Flow` still carries the full tree so callers can swap it wholesale.
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
      tools: ['Grep'],
      ...(deps.language ? { language: deps.language } : {}),
      ...(deps.maxTurns ? { maxTurns: deps.maxTurns } : {}),
    }),
  );
  await deps.sessionStore.set(
    sessionKey(key, { kind: 'flow', perspectiveId: args.flow.perspectiveId }),
    conversation.id,
  );

  const rawPatch = parseJsonStrict<unknown>(text);
  const patch = parseRefinedFlowPatch(rawPatch, args.flow.perspectiveId);
  const unified = await deps.diff.getDiff(args.ref);
  const blocks = await applyRefinedFlowPatch(
    args.flow.blocks,
    patch,
    args.ref,
    deps.diff,
    unified,
  );
  const allMocks = collectMocks(blocks);
  log.info('flow', 'refineFlowFromMock ready', {
    perspectiveId: args.flow.perspectiveId,
    replacements: patch.replacements.length,
    removals: patch.removals.length,
    insertions: patch.insertions.length,
    totalBlocks: countBlocks(blocks),
    mocks: allMocks.length,
  });
  return {
    flowId: deps.newFlowId?.() ?? `${args.flow.flowId}+refined-${Date.now()}`,
    perspectiveId: args.flow.perspectiveId,
    blocks,
    allMocks,
  };
}
