import type { Conversation, LlmProvider } from '../ports/llm-provider.js';
import type { SessionStorePort } from '../ports/session-store.js';
import { sessionKey } from '../ports/session-store.js';
import type { LoggerPort } from '../ports/logger.js';
import { nullLogger } from '../ports/logger.js';
import type { PrRef } from '../domain/pr-ref.js';
import { prRefKey } from '../domain/pr-ref.js';
import type { PerspectiveDraft } from '../domain/perspective.js';
import type { PerspectiveSummary, SummaryPayload } from '../domain/summary.js';
import { sanitizeSummaryVisuals } from '../domain/summary.js';
import { SUMMARY_SYSTEM_PROMPT, buildSummaryUserMessage } from '../prompts/summary.js';
import { parseJsonStrict } from './json-parse.js';

export interface SummarizeDeps {
  llm: LlmProvider;
  sessionStore: SessionStorePort;
  logger?: LoggerPort;
  language?: string;
}

export interface SummarizeArgs {
  ref: PrRef;
  perspective: PerspectiveDraft;
}

/**
 * Produces the perspective summary (Outcome / Tests / Watch-for). The
 * conversation is stored as `summary:{pid}` so Q&A sections can fork
 * from it without touching the perspective or flow conversations.
 */
export async function summarize(
  deps: SummarizeDeps,
  args: SummarizeArgs,
): Promise<SummaryPayload> {
  const log = deps.logger ?? nullLogger;
  const key = prRefKey(args.ref);
  const summaryKey = sessionKey(key, {
    kind: 'summary',
    perspectiveId: args.perspective.id,
  });
  const cachedSummary = await deps.sessionStore.get(summaryKey);
  const user = buildSummaryUserMessage(args.perspective);

  let conversation: Conversation;
  let label: string;
  if (cachedSummary) {
    log.info('summary', 'resuming summary conversation', {
      perspectiveId: args.perspective.id,
      conversationId: cachedSummary,
    });
    conversation = deps.llm.resumeConversation(cachedSummary);
    label = 'resume summary';
  } else {
    const baseSession = await deps.sessionStore.get(sessionKey(key, { kind: 'base' }));
    if (baseSession) {
      log.info('summary', 'forking base for perspective summary', {
        perspectiveId: args.perspective.id,
        baseSession,
      });
      conversation = deps.llm.resumeConversation(baseSession).fork();
      label = 'fork base';
    } else {
      log.info('summary', 'starting fresh summary conversation', {
        perspectiveId: args.perspective.id,
      });
      conversation = deps.llm.startConversation();
      label = 'fresh';
    }
  }

  const { text } = await log.time('summary', `llm.ask (${label})`, () =>
    conversation.ask({
      system: SUMMARY_SYSTEM_PROMPT,
      user,
      ...(deps.language ? { language: deps.language } : {}),
    }),
  );
  await deps.sessionStore.set(summaryKey, conversation.id);

  const summary = parseJsonStrict<PerspectiveSummary>(text);
  const rawVisualCount = Array.isArray(summary.visuals) ? summary.visuals.length : 0;
  const visuals = sanitizeSummaryVisuals(summary.visuals);
  log.info('summary', 'summary ready', {
    perspectiveId: args.perspective.id,
    tests: summary.tests?.length ?? 0,
    watch: summary.watchFor?.length ?? 0,
    visuals: visuals.length,
    droppedVisuals: rawVisualCount - visuals.length,
    visualKinds: visuals.map((v) => v.kind),
  });
  return {
    summary: {
      perspectiveId: args.perspective.id,
      outcome: summary.outcome ?? args.perspective.outcome,
      tests: summary.tests ?? [],
      watchFor: summary.watchFor ?? [],
      visuals,
    },
    hunkRefs: args.perspective.hunkRefs,
  };
}
