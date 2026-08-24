import type { LlmProvider } from '../ports/llm-provider.js';
import type { SessionStorePort } from '../ports/session-store.js';
import { sessionKey } from '../ports/session-store.js';
import type { LoggerPort } from '../ports/logger.js';
import { nullLogger } from '../ports/logger.js';
import type { PrRef } from '../domain/pr-ref.js';
import { prRefKey } from '../domain/pr-ref.js';
import type { UnifiedDiff } from '../domain/diff.js';
import type { PerspectiveSet } from '../domain/perspective.js';
import type { PrMeta } from '../ports/pr.js';
import {
  PERSPECTIVE_SYSTEM_PROMPT,
  buildPerspectiveUserMessage,
} from '../prompts/perspective.js';
import { buildHunkManifest } from './hunk-manifest.js';
import { parseJsonStrict } from './json-parse.js';
import { postProcess } from './post-process.js';

export interface ExtractPerspectivesDeps {
  llm: LlmProvider;
  sessionStore: SessionStorePort;
  logger?: LoggerPort;
  language?: string;
}

export interface ExtractPerspectivesArgs {
  ref: PrRef;
  meta: PrMeta;
  diff: UnifiedDiff;
}

export async function extractPerspectives(
  deps: ExtractPerspectivesDeps,
  args: ExtractPerspectivesArgs,
): Promise<PerspectiveSet> {
  const log = deps.logger ?? nullLogger;
  const key = prRefKey(args.ref);
  const manifest = buildHunkManifest(args.diff);
  const user = buildPerspectiveUserMessage(manifest, {
    title: args.meta.title,
    body: args.meta.body,
    baseRef: args.meta.baseRef,
    headRef: args.meta.headRef,
  });
  log.info('extract', 'building perspective request', {
    prKey: key,
    files: args.diff.files.length,
    manifestBytes: manifest.length,
    userBytes: user.length,
  });

  const conversation = deps.llm.startConversation();
  const { text } = await log.time('extract', 'llm.ask (perspectives)', () =>
    conversation.ask({
      system: PERSPECTIVE_SYSTEM_PROMPT,
      user,
      ...(deps.language ? { language: deps.language } : {}),
    }),
  );
  await deps.sessionStore.set(sessionKey(key, { kind: 'base' }), conversation.id);
  log.info('extract', 'base conversation stored', {
    prKey: key,
    conversationId: conversation.id,
    responseBytes: text.length,
  });

  const raw = parseJsonStrict<PerspectiveSet>(text);
  const normalized: PerspectiveSet = {
    tldr: raw.tldr ?? '',
    perspectives: raw.perspectives ?? [],
    incidental: raw.incidental ?? [],
    ...(raw.readingOrder ? { readingOrder: raw.readingOrder } : {}),
  };
  const processed = postProcess(normalized);
  log.info('extract', 'perspectives ready', {
    prKey: key,
    kept: processed.perspectives.length,
    droppedTo: processed.incidental.length,
  });
  return processed;
}
