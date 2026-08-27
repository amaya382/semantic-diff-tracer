import type {
  Flow,
  PerspectiveDraft,
  PerspectiveSet,
  PrRef,
  SummaryPayload,
  UnifiedDiff,
} from '@semantic-diff-tracer/core';
import { extractPerspectives, planFlow, summarize } from '@semantic-diff-tracer/core';
import type { PrMeta } from '@semantic-diff-tracer/core';
import type { SkillDeps } from './boot.js';
import type { PerspectiveBundle } from './render/index.js';

export interface PipelineResult {
  meta: PrMeta;
  perspectives: PerspectiveSet;
  bundles: PerspectiveBundle[];
}

/**
 * Serial pipeline for the skill: fetch diff, extract perspectives, then loop
 * one perspective at a time producing its summary and flow. Serial by design —
 * the skill runs in a Claude Code session where concurrent Claude calls can
 * fight over the same terminal; simplicity buys predictable logs and easier
 * failure recovery. Each perspective is best-effort: a failure logs and moves
 * on so a single broken flow does not sink the whole report.
 */
export async function runPipeline(deps: SkillDeps, ref: PrRef): Promise<PipelineResult> {
  const meta = await deps.pr.fetchMeta(ref);
  const diff = await deps.diff.getDiff(ref);
  const perspectives = await extractPerspectives(deps, { ref, meta, diff });
  const bundles: PerspectiveBundle[] = [];
  for (const p of perspectives.perspectives) {
    bundles.push(await buildBundle(deps, ref, diff, p));
  }
  return { meta, perspectives, bundles };
}

async function buildBundle(
  deps: SkillDeps,
  ref: PrRef,
  diff: UnifiedDiff,
  perspective: PerspectiveDraft,
): Promise<PerspectiveBundle> {
  let summary: SummaryPayload | undefined;
  let flow: Flow | undefined;
  try {
    summary = await summarize(deps, { ref, perspective, diff });
  } catch (err) {
    deps.logger.warn('skill', `summarize failed for ${perspective.id}: ${String(err)}`);
  }
  try {
    flow = await planFlow(
      { ...deps, maxTurns: deps.flowMaxTurns },
      { ref, perspective, diff },
    );
  } catch (err) {
    deps.logger.warn('skill', `planFlow failed for ${perspective.id}: ${String(err)}`);
  }
  const bundle: PerspectiveBundle = { perspective };
  if (summary) bundle.summary = summary;
  if (flow) bundle.flow = flow;
  return bundle;
}
