import type {
  BlockPath,
  Flow,
  FlowBlock,
  Mock,
  PerspectiveDraft,
  PrRef,
  StepAction,
} from '@semantic-diff-tracer/core';
import { blockAt, planFlow, refineFlowFromMock, stepFlow } from '@semantic-diff-tracer/core';
import type { TuiDeps } from '../boot.js';
import { ask } from '../io/prompt.js';

type CodeSide = 'before' | 'after';

/**
 * Story-mode trace REPL. Commands:
 *  s / i / o / b   step over / in / out / back (reverse)
 *  v               toggle Before/After view of the current block's code
 *  m               list mocks
 *  r <mockIdx> <instruction>   refine flow from mock
 *  q               quit
 */
export async function runTraceScreen(
  deps: TuiDeps,
  ref: PrRef,
  perspective: PerspectiveDraft,
): Promise<void> {
  console.log('\nPlanning flow…');
  let flow = await planFlow(
    {
      llm: deps.llm,
      diff: deps.diff,
      sessionStore: deps.sessionStore,
      logger: deps.logger,
      language: deps.language,
      maxTurns: deps.flowMaxTurns,
    },
    { ref, perspective },
  );
  let cursor: BlockPath = [0];
  const history: BlockPath[] = [];
  const preferredSide = new Map<string, CodeSide>();
  const currentSide = (): CodeSide => {
    const b = blockAt(flow, cursor);
    if (!b) return 'after';
    const stored = preferredSide.get(b.id);
    if (stored) return stored === 'before' && !b.beforeFocus ? 'after' : stored;
    return b.role === 'removed' && b.beforeFocus ? 'before' : 'after';
  };
  printBlock(flow, cursor, currentSide());
  console.log('\ns=over  i=in  o=out  b=back  v=before/after  m=mocks  r=refine  q=quit');

  while (true) {
    const line = (await ask('> ')).trim();
    if (!line) continue;
    if (line === 'q') return;
    if (['s', 'i', 'o', 'b'].includes(line)) {
      const action: StepAction =
        line === 's' ? 'over' : line === 'i' ? 'in' : line === 'o' ? 'out' : 'reverse';
      const result = stepFlow(flow, cursor, action, history);
      if (result.next) cursor = result.next;
      if (result.historyPush) history.push(result.historyPush);
      if (result.historyPop) history.pop();
      printBlock(flow, cursor, currentSide());
      continue;
    }
    if (line === 'v') {
      const b = blockAt(flow, cursor);
      if (!b) continue;
      if (!b.beforeFocus) {
        console.log('(no Before side for this block — nothing to toggle)');
        continue;
      }
      const now = currentSide();
      preferredSide.set(b.id, now === 'before' ? 'after' : 'before');
      printBlock(flow, cursor, currentSide());
      continue;
    }
    if (line === 'm') {
      flow.allMocks.forEach((m, i) => {
        console.log(`  [${i + 1}] ${m.symbol} (${m.kind}) — ${m.reason}`);
      });
      continue;
    }
    if (line.startsWith('r ')) {
      const rest = line.slice(2).trim();
      const sp = rest.indexOf(' ');
      if (sp < 0) {
        console.log('usage: r <mockIdx> <instruction>');
        continue;
      }
      const idx = Number(rest.slice(0, sp)) - 1;
      const instruction = rest.slice(sp + 1).trim();
      const target = flow.allMocks[idx];
      if (!target || !instruction) {
        console.log('unknown mock or empty instruction');
        continue;
      }
      try {
        flow = await refineFlowFromMock(
          {
            llm: deps.llm,
            diff: deps.diff,
            sessionStore: deps.sessionStore,
            logger: deps.logger,
            language: deps.language,
            maxTurns: deps.flowMaxTurns,
          },
          { ref, flow, targetMock: target as Mock, instruction },
        );
        cursor = [0];
        history.length = 0;
        preferredSide.clear();
        printBlock(flow, cursor, currentSide());
      } catch (e) {
        console.error(`refine failed: ${(e as Error).message}`);
      }
      continue;
    }
    console.log('unknown command');
  }
}

function printBlock(flow: Flow, cursor: BlockPath, side: CodeSide): void {
  const block = blockAt(flow, cursor);
  if (!block) {
    console.log('(end of flow)');
    return;
  }
  console.log('\n--- ' + crumbFor(flow, cursor) + ' ---');
  const roleTag = block.role ? ` [${block.role}]` : '';
  console.log(`${block.title}${roleTag}\n`);
  console.log(block.narrative);
  const showBefore = side === 'before' && !!block.beforeFocus;
  const location = showBefore
    ? `${block.beforeFocus!.file}:${block.beforeFocus!.startLine}-${block.beforeFocus!.endLine} (before)`
    : `${block.focus.file}:${block.focus.startLine}-${block.focus.endLine} (after)`;
  console.log(`\n${location}`);
  const code = showBefore ? block.beforeCode : block.code;
  if (code) {
    console.log(code.split('\n').map((l) => '    ' + l).join('\n'));
  } else if (showBefore) {
    console.log('    (no before snippet available)');
  }
  if (block.visibleVars.length > 0) {
    console.log('\nvars:');
    for (const v of block.visibleVars) {
      console.log(`  ${v.name} = ${v.value}${v.note ? '   // ' + v.note : ''}`);
    }
  }
  if (block.concerns.length > 0) {
    console.log('\nconcerns:');
    for (const c of block.concerns) {
      console.log(`  [${c.severity}] ${c.message} (${c.anchor.file}:${c.anchor.line})`);
    }
  }
}

function crumbFor(flow: Flow, cursor: BlockPath): string {
  const titles: string[] = [];
  let siblings: FlowBlock[] = flow.blocks;
  for (const idx of cursor) {
    const b = siblings[idx];
    if (!b) break;
    titles.push(b.title);
    siblings = b.children;
  }
  return titles.join(' › ') || '(root)';
}
