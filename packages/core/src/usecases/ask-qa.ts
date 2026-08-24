import type { LlmProvider } from '../ports/llm-provider.js';
import type { SessionStorePort } from '../ports/session-store.js';
import { sessionKey } from '../ports/session-store.js';
import type { LoggerPort } from '../ports/logger.js';
import { nullLogger } from '../ports/logger.js';
import type { PrRef } from '../domain/pr-ref.js';
import { prRefKey } from '../domain/pr-ref.js';
import type { QaContextRef, QaSection } from '../domain/qa.js';
import {
  ASK_SYSTEM_PROMPT,
  buildAskUserMessage,
  buildFollowUpUserMessage,
} from '../prompts/ask.js';

export interface QaDeps {
  llm: LlmProvider;
  sessionStore: SessionStorePort;
  logger?: LoggerPort;
  language?: string;
  now?: () => string;
  newSectionId?: () => string;
}

export type ForkOrigin = 'summary' | 'flow';

export interface AskQaArgs {
  ref: PrRef;
  perspectiveId: string;
  question: string;
  contextRef?: QaContextRef;
  /**
   * Which parent conversation to fork. `summary` (default) seeds the Q&A with
   * the PR-level summary; `flow` seeds it with the Trace-planning conversation
   * so the answer can talk about blocks, mocks, and concerns by name.
   */
  forkOrigin?: ForkOrigin;
}

/**
 * Start a new Q&A section by forking either the summary or the flow
 * conversation. Returns a fresh QaSection with one turn. Follow-ups resume
 * the same conversation via followUpQa.
 */
export async function askQa(deps: QaDeps, args: AskQaArgs): Promise<QaSection> {
  const log = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date().toISOString());
  const key = prRefKey(args.ref);
  const forkOrigin: ForkOrigin = args.forkOrigin ?? 'summary';
  const parentKey =
    forkOrigin === 'flow'
      ? sessionKey(key, { kind: 'flow', perspectiveId: args.perspectiveId })
      : sessionKey(key, { kind: 'summary', perspectiveId: args.perspectiveId });
  const parentSession = await deps.sessionStore.get(parentKey);
  if (!parentSession) {
    const label = forkOrigin === 'flow' ? 'flow' : 'summary';
    throw new Error(
      `No ${label} conversation for perspective ${args.perspectiveId}. Open the ${label === 'flow' ? 'Trace' : 'Summary'} tab first.`,
    );
  }
  const sectionId = deps.newSectionId?.() ?? `sec-${Date.now()}`;
  const user = buildAskUserMessage(args.question, args.contextRef);
  log.info('qa', `askQa (fork ${forkOrigin})`, {
    perspectiveId: args.perspectiveId,
    sectionId,
  });
  const conversation = deps.llm.resumeConversation(parentSession).fork();
  const { text } = await log.time('qa', `llm.ask (fork ${forkOrigin})`, () =>
    conversation.ask({
      system: ASK_SYSTEM_PROMPT,
      user,
      ...(deps.language ? { language: deps.language } : {}),
    }),
  );
  await deps.sessionStore.set(
    sessionKey(key, { kind: 'qa', perspectiveId: args.perspectiveId, sectionId }),
    conversation.id,
  );
  const at = now();
  return {
    sectionId,
    createdAt: at,
    ...(args.contextRef ? { contextRef: args.contextRef } : {}),
    turns: [{ at, question: args.question, answer: text.trim() }],
    conversationId: conversation.id,
    forkOrigin,
  };
}

export interface FollowUpQaArgs {
  ref: PrRef;
  perspectiveId: string;
  section: QaSection;
  question: string;
}

/** Resume the section's Q&A conversation for a follow-up turn. */
export async function followUpQa(deps: QaDeps, args: FollowUpQaArgs): Promise<QaSection> {
  const log = deps.logger ?? nullLogger;
  const now = deps.now ?? (() => new Date().toISOString());
  const key = prRefKey(args.ref);
  const qaKey = sessionKey(key, {
    kind: 'qa',
    perspectiveId: args.perspectiveId,
    sectionId: args.section.sectionId,
  });
  const parent = args.section.conversationId ?? (await deps.sessionStore.get(qaKey));
  if (!parent) {
    throw new Error(
      `No live Q&A conversation for section ${args.section.sectionId}. Ask a new question instead.`,
    );
  }
  log.info('qa', 'followUpQa (resume)', {
    perspectiveId: args.perspectiveId,
    sectionId: args.section.sectionId,
  });
  const conversation = deps.llm.resumeConversation(parent);
  const { text } = await log.time('qa', 'llm.ask (resume qa)', () =>
    conversation.ask({
      system: ASK_SYSTEM_PROMPT,
      user: buildFollowUpUserMessage(args.question),
      ...(deps.language ? { language: deps.language } : {}),
    }),
  );
  await deps.sessionStore.set(qaKey, conversation.id);
  const at = now();
  return {
    ...args.section,
    turns: [...args.section.turns, { at, question: args.question, answer: text.trim() }],
    conversationId: conversation.id,
  };
}

export interface DeleteQaSectionArgs {
  ref: PrRef;
  perspectiveId: string;
  sectionId: string;
}

export async function deleteQaSection(
  deps: Pick<QaDeps, 'sessionStore' | 'logger'>,
  args: DeleteQaSectionArgs,
): Promise<void> {
  const log = deps.logger ?? nullLogger;
  const key = prRefKey(args.ref);
  await deps.sessionStore.delete(
    sessionKey(key, {
      kind: 'qa',
      perspectiveId: args.perspectiveId,
      sectionId: args.sectionId,
    }),
  );
  log.info('qa', 'section deleted', {
    perspectiveId: args.perspectiveId,
    sectionId: args.sectionId,
  });
}
