import type { PerspectiveDraft, PrRef, QaSection } from '@semantic-diff-tracer/core';
import { askQa, followUpQa, summarize } from '@semantic-diff-tracer/core';
import type { TuiDeps } from '../boot.js';
import { ask } from '../io/prompt.js';

export type SummaryOutcome = 'trace' | 'quit';

/**
 * Prints the summary and drops into a small REPL: `a <question>` to ask,
 * `f <sec> <question>` to follow-up, `t` to open the trace, `q` to quit.
 */
export async function runSummaryScreen(
  deps: TuiDeps,
  ref: PrRef,
  perspective: PerspectiveDraft,
): Promise<SummaryOutcome> {
  console.log('\nLoading summary…');
  const payload = await summarize(
    {
      llm: deps.llm,
      diff: deps.diff,
      sessionStore: deps.sessionStore,
      logger: deps.logger,
      language: deps.language,
    },
    { ref, perspective },
  );
  console.log(`\n== ${perspective.title} ==\n`);
  console.log(`Outcome: ${payload.summary.outcome}\n`);
  if (payload.summary.watchFor.length > 0) {
    console.log('Watch-for:');
    for (const w of payload.summary.watchFor) {
      const loc = w.anchor ? `${w.anchor.file}:${w.anchor.line} — ` : '';
      console.log(`  - ${loc}${w.note}`);
    }
    console.log();
  }
  if (payload.summary.tests.length > 0) {
    console.log('Tests:');
    for (const t of payload.summary.tests) {
      console.log(`  - ${t.file}:${t.line} — ${t.description}`);
    }
    console.log();
  }
  console.log('Commands: a <question> · f <secIdx> <question> · t (trace) · q (quit)\n');

  const sections: QaSection[] = [];
  while (true) {
    const line = (await ask('> ')).trim();
    if (!line) continue;
    if (line === 'q') return 'quit';
    if (line === 't') return 'trace';
    if (line.startsWith('a ')) {
      const question = line.slice(2).trim();
      if (!question) continue;
      try {
        const section = await askQa(
          {
            llm: deps.llm,
            sessionStore: deps.sessionStore,
            logger: deps.logger,
            language: deps.language,
          },
          { ref, perspectiveId: perspective.id, question },
        );
        sections.unshift(section);
        printSections(sections);
      } catch (e) {
        console.error(`ask failed: ${(e as Error).message}`);
      }
      continue;
    }
    if (line.startsWith('f ')) {
      const rest = line.slice(2).trim();
      const sp = rest.indexOf(' ');
      if (sp < 0) {
        console.log('usage: f <secIdx> <question>');
        continue;
      }
      const secIdx = Number(rest.slice(0, sp));
      const question = rest.slice(sp + 1).trim();
      const section = sections[secIdx - 1];
      if (!section || !question) {
        console.log('unknown section or empty question');
        continue;
      }
      try {
        const updated = await followUpQa(
          {
            llm: deps.llm,
            sessionStore: deps.sessionStore,
            logger: deps.logger,
            language: deps.language,
          },
          { ref, perspectiveId: perspective.id, section, question },
        );
        sections[secIdx - 1] = updated;
        printSections(sections);
      } catch (e) {
        console.error(`follow-up failed: ${(e as Error).message}`);
      }
      continue;
    }
    console.log('unknown command; try: a <q> · f <n> <q> · t · q');
  }
}

function printSections(sections: QaSection[]): void {
  sections.forEach((s, i) => {
    console.log(`\n[${i + 1}] ${s.turns[0]?.question ?? '(no question)'}`);
    for (const t of s.turns.slice(1)) {
      console.log(`    ↳ ${t.question}`);
    }
    const latest = s.turns[s.turns.length - 1];
    if (latest) console.log(indent(latest.answer, '    '));
  });
  console.log();
}

function indent(s: string, prefix: string): string {
  return s
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n');
}
