import type { PerspectiveDraft, PrRef, TraceDepth } from '@semantic-diff-tracer/core';
import { DEFAULT_TRACE_DEPTH, extractPerspectives } from '@semantic-diff-tracer/core';
import type { TuiDeps } from '../boot.js';
import { ask } from '../io/prompt.js';

export interface PerspectiveChoice {
  perspective: PerspectiveDraft;
  traceDepth: TraceDepth;
}

/**
 * Runs perspective extraction and lets the user pick one by index. `d` toggles
 * the depth of the trace that the following summary/flow asks will run at.
 * Returns the chosen perspective plus the toggled depth, or undefined on quit.
 */
export async function runPerspectiveScreen(
  deps: TuiDeps,
  ref: PrRef,
  initialTraceDepth: TraceDepth = DEFAULT_TRACE_DEPTH,
): Promise<PerspectiveChoice | undefined> {
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
  let traceDepth = initialTraceDepth;
  while (true) {
    const answer = (
      await ask(
        `\ntrace-depth=${traceDepth}. Pick a perspective (number, d to toggle depth, q to quit): `,
      )
    ).trim();
    if (!answer || answer === 'q') return undefined;
    if (answer === 'd') {
      traceDepth = traceDepth === 'normal' ? 'deep' : 'normal';
      continue;
    }
    const idx = Number(answer) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= set.perspectives.length) {
      console.log('Invalid choice.');
      continue;
    }
    return { perspective: set.perspectives[idx]!, traceDepth };
  }
}
