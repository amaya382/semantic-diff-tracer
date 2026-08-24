import type { PerspectiveDraft, PrRef } from '@semantic-diff-tracer/core';
import { extractPerspectives } from '@semantic-diff-tracer/core';
import type { TuiDeps } from '../boot.js';
import { ask } from '../io/prompt.js';

/**
 * Runs perspective extraction and lets the user pick one by index. Returns the
 * chosen perspective or undefined on quit.
 */
export async function runPerspectiveScreen(
  deps: TuiDeps,
  ref: PrRef,
): Promise<PerspectiveDraft | undefined> {
  console.log('Extracting perspectives…');
  const diff = await deps.diff.getDiff(ref);
  const meta =
    ref.kind === 'github'
      ? await deps.pr.fetchMeta(ref)
      : {
          title: `${ref.baseRef}..${ref.headRef}`,
          body: '',
          author: '',
          baseRef: ref.baseRef,
          headRef: ref.headRef,
        };
  const set = await extractPerspectives(
    {
      llm: deps.llm,
      sessionStore: deps.sessionStore,
      logger: deps.logger,
      language: deps.language,
    },
    { ref, meta, diff },
  );
  console.log(`\nTL;DR: ${set.tldr}\n`);
  set.perspectives.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.title} — ${p.outcome}`);
  });
  if (set.perspectives.length === 0) {
    console.log('No perspectives extracted.');
    return undefined;
  }
  const answer = (await ask('\nPick a perspective (number, q to quit): ')).trim();
  if (!answer || answer === 'q') return undefined;
  const idx = Number(answer) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= set.perspectives.length) {
    console.log('Invalid choice.');
    return undefined;
  }
  return set.perspectives[idx];
}
