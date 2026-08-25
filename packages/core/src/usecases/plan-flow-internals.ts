import type { DiffPort } from '../ports/diff.js';
import type { UnifiedDiff } from '../domain/diff.js';
import type { PrRef } from '../domain/pr-ref.js';
import type {
  BlockRole,
  Focal,
  FocalKind,
  FlowBlock,
  Mock,
  RefinedFlowPatch,
} from '../domain/flow.js';
import { mapNewToOldRange, summariseChange } from './diff-change.js';

export interface RawBlock {
  id?: string;
  title?: string;
  narrative?: string;
  focus?: { file?: string; startLine?: number; endLine?: number };
  beforeFocus?: { file?: string; startLine?: number; endLine?: number };
  role?: string;
  visibleVars?: Array<{ name?: string; value?: string; note?: string | null }>;
  mocks?: Array<{
    id?: string;
    symbol?: string;
    file?: string;
    kind?: string;
    value?: string | null;
    reason?: string;
    editable?: boolean;
  }>;
  concerns?: Array<{
    id?: string;
    severity?: string;
    message?: string;
    anchor?: { file?: string; line?: number };
  }>;
  focal?: {
    kind?: string;
    reason?: string;
  } | null;
  children?: RawBlock[];
}

export function normalizeFromRawBlocks(
  raw: unknown[],
  perspectiveId: string,
): FlowBlock[] {
  return raw
    .filter((r): r is RawBlock => !!r && typeof r === 'object')
    .map((r, i) => normalizeBlock(r, `${perspectiveId}-b${i}`));
}

function normalizeBlock(raw: RawBlock, fallbackId: string): FlowBlock {
  const focus = {
    file: raw.focus?.file ?? '',
    startLine: raw.focus?.startLine ?? 1,
    endLine: raw.focus?.endLine ?? raw.focus?.startLine ?? 1,
  };
  const beforeFocus =
    raw.beforeFocus && raw.beforeFocus.file
      ? {
          file: raw.beforeFocus.file,
          startLine: raw.beforeFocus.startLine ?? 1,
          endLine: raw.beforeFocus.endLine ?? raw.beforeFocus.startLine ?? 1,
        }
      : undefined;
  const block: FlowBlock = {
    id: raw.id ?? fallbackId,
    title: raw.title ?? 'Untitled block',
    narrative: raw.narrative ?? '',
    focus,
    code: '',
    visibleVars: (raw.visibleVars ?? []).map((v) => ({
      name: v.name ?? '',
      value: v.value ?? '',
      ...(v.note ? { note: v.note } : {}),
    })),
    mocks: (raw.mocks ?? []).map((m, mi) => ({
      id: m.id ?? `${fallbackId}-m${mi}`,
      symbol: m.symbol ?? '',
      file: m.file ?? focus.file,
      kind: (m.kind === 'value' || m.kind === 'skip' ? m.kind : 'stub') as Mock['kind'],
      ...(m.value != null ? { value: m.value } : {}),
      reason: m.reason ?? '',
      editable: m.editable !== false,
      userOverridden: false,
    })),
    concerns: (raw.concerns ?? []).map((c, ci) => ({
      id: c.id ?? `${fallbackId}-c${ci}`,
      severity: (c.severity === 'warn' || c.severity === 'error' ? c.severity : 'info') as
        | 'info'
        | 'warn'
        | 'error',
      message: c.message ?? '',
      anchor: {
        file: c.anchor?.file ?? focus.file,
        line: c.anchor?.line ?? focus.startLine,
      },
    })),
    children: raw.children
      ? raw.children
          .filter((r): r is RawBlock => !!r && typeof r === 'object')
          .map((r, i) => normalizeBlock(r, `${fallbackId}-${i}`))
      : [],
  };
  if (beforeFocus) block.beforeFocus = beforeFocus;
  // LLM-provided role is a hint; the authoritative role is derived from the
  // diff in `assignRoles`. Still carry it through so the raw JSON isn't lost.
  const hint = normaliseRoleHint(raw.role);
  if (hint) block.role = hint;
  const focal = normaliseFocal(raw.focal);
  if (focal) block.focal = focal;
  return block;
}

function normaliseRoleHint(v: string | undefined): BlockRole | undefined {
  if (v === 'added' || v === 'modified' || v === 'removed' || v === 'unchanged') return v;
  return undefined;
}

function normaliseFocal(raw: RawBlock['focal']): Focal | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const kind = normaliseFocalKind(raw.kind);
  if (!kind) return undefined;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (!reason) return undefined;
  return { kind, reason };
}

/**
 * Any legacy or drifted kind collapses into the 3 supported values. `boundary`
 * was proposed during design and folded into `contract`; auto-fallback here so
 * the schema change does not require prompt-side coordination.
 */
function normaliseFocalKind(v: unknown): FocalKind | undefined {
  if (v === 'entry' || v === 'core' || v === 'contract') return v;
  if (v === 'boundary') return 'contract';
  return undefined;
}

export async function hydrateFlowCode(
  blocks: FlowBlock[],
  ref: PrRef,
  diff: DiffPort,
): Promise<void> {
  const headCache = new Map<string, string | null>();
  const baseCache = new Map<string, string | null>();
  await walkAndHydrate(blocks, ref, diff, headCache, baseCache);
}

async function walkAndHydrate(
  nodes: FlowBlock[],
  ref: PrRef,
  diff: DiffPort,
  headCache: Map<string, string | null>,
  baseCache: Map<string, string | null>,
): Promise<void> {
  for (const b of nodes) {
    if (b.focus.file) {
      let head = headCache.get(b.focus.file);
      if (head === undefined) {
        head = await diff.readFileAtSha(ref.headSha, b.focus.file).catch(() => null);
        headCache.set(b.focus.file, head);
      }
      b.code = head ? sliceLines(head, b.focus.startLine, b.focus.endLine) : '';
    }
    if (b.beforeFocus?.file) {
      let before = baseCache.get(b.beforeFocus.file);
      if (before === undefined) {
        before = await diff.readFileAtSha(ref.baseSha, b.beforeFocus.file).catch(() => null);
        baseCache.set(b.beforeFocus.file, before);
      }
      b.beforeCode = before
        ? sliceLines(before, b.beforeFocus.startLine, b.beforeFocus.endLine)
        : '';
    }
    await walkAndHydrate(b.children, ref, diff, headCache, baseCache);
  }
}

/**
 * Fill in `role` on every block based on the diff, and infer `beforeFocus`
 * when the LLM didn't provide one. Blocks whose focus file isn't in the diff
 * at all are treated as `unchanged` (context blocks brought in to walk the
 * reader from entry point to the changed code) and get `beforeFocus =
 * focus` so the Before pane still works.
 */
export function assignRoles(blocks: FlowBlock[], diff: UnifiedDiff): void {
  const walk = (nodes: FlowBlock[]): void => {
    for (const b of nodes) {
      const s = summariseChange(diff, b.focus.file, b.focus.startLine, b.focus.endLine);
      const derived: BlockRole =
        s.kind === 'unknown'
          ? 'unchanged'
          : (s.kind as BlockRole);
      // Removed marker takes precedence when there's a before-side snippet and
      // no additions in the new range (a "the function used to live here"
      // block). Otherwise trust `summariseChange`.
      if (b.beforeCode && s.additions === 0 && s.deletions > 0) {
        b.role = 'removed';
      } else {
        b.role = derived;
      }
      // Backfill beforeFocus when missing so the Trace tab's Before toggle has
      // something to show. Skip only when the file itself is `added` (there
      // really is no base side).
      if (!b.beforeFocus && b.focus.file) {
        const fd = diff.files.find((f) => f.path === b.focus.file);
        const mapped = fd
          ? mapNewToOldRange(fd, b.focus.startLine, b.focus.endLine)
          : { file: b.focus.file, startLine: b.focus.startLine, endLine: b.focus.endLine };
        if (mapped) b.beforeFocus = mapped;
      }
      walk(b.children);
    }
  };
  walk(blocks);
}

function sliceLines(source: string, start: number, end: number): string {
  const lines = source.split('\n');
  const s = Math.max(1, Math.min(start, lines.length));
  const e = Math.max(s, Math.min(end, lines.length));
  return lines.slice(s - 1, e).join('\n');
}

export function collectMocks(blocks: FlowBlock[]): Mock[] {
  const out: Mock[] = [];
  const seen = new Set<string>();
  const walk = (nodes: FlowBlock[]): void => {
    for (const n of nodes) {
      for (const m of n.mocks) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      }
      walk(n.children);
    }
  };
  walk(blocks);
  return out;
}

/**
 * Enforce the focal budget on the client side, so a prompt drift can never leak
 * dozens of focal chips into the UI. Per-kind caps mirror the prompt; the total
 * cap is a second gate that also drops the least-load-bearing survivors first.
 * Focal on role='unchanged' blocks is treated as least load-bearing because
 * an unchanged block sits in the flow only for context — the diff intent
 * cannot literally live there. Depth is the secondary sort so deeper focal go
 * before shallower when the budget still forces a drop.
 */
const FOCAL_BUDGET_PER_KIND: Record<FocalKind, number> = {
  core: 2,
  entry: 2,
  contract: 3,
};
const FOCAL_BUDGET_TOTAL = 5;

interface FocalRef {
  block: FlowBlock;
  depth: number;
}

export function clipFocalBudgets(blocks: FlowBlock[]): void {
  const flat: FocalRef[] = [];
  const walk = (nodes: FlowBlock[], depth: number): void => {
    for (const b of nodes) {
      if (b.focal) flat.push({ block: b, depth });
      walk(b.children, depth + 1);
    }
  };
  walk(blocks, 0);
  if (flat.length === 0) return;

  const perKindCount: Record<FocalKind, number> = { core: 0, entry: 0, contract: 0 };
  const survivors: FocalRef[] = [];
  for (const ref of flat) {
    const kind = ref.block.focal!.kind;
    if (perKindCount[kind] >= FOCAL_BUDGET_PER_KIND[kind]) {
      delete ref.block.focal;
      continue;
    }
    perKindCount[kind]++;
    survivors.push(ref);
  }
  if (survivors.length <= FOCAL_BUDGET_TOTAL) return;

  const dropOrder = [...survivors].sort((a, b) => {
    const aUnchanged = (a.block.role ?? 'unchanged') === 'unchanged' ? 1 : 0;
    const bUnchanged = (b.block.role ?? 'unchanged') === 'unchanged' ? 1 : 0;
    if (aUnchanged !== bUnchanged) return bUnchanged - aUnchanged;
    return b.depth - a.depth;
  });
  const excess = survivors.length - FOCAL_BUDGET_TOTAL;
  for (let i = 0; i < excess; i++) {
    delete dropOrder[i]!.block.focal;
  }
}

export function countBlocks(blocks: FlowBlock[]): number {
  let n = 0;
  const walk = (nodes: FlowBlock[]): void => {
    for (const b of nodes) {
      n++;
      walk(b.children);
    }
  };
  walk(blocks);
  return n;
}

/**
 * Merge adjacent blocks in the same file with the same role. Used as a
 * safety net when the LLM returns e.g. five separate removal blocks that
 * really belong to one "we dropped this helper" story. The first block in
 * a run keeps its identity; later blocks are folded into its focus range
 * and a "(also at foo.ts:12, foo.ts:34)" hint is appended to the narrative.
 * Children are deduped too, recursively.
 */
export function dedupeAdjacentBlocks(blocks: FlowBlock[]): FlowBlock[] {
  const out: FlowBlock[] = [];
  for (const raw of blocks) {
    const b: FlowBlock = { ...raw, children: dedupeAdjacentBlocks(raw.children) };
    const prev = out[out.length - 1];
    if (prev && canMerge(prev, b)) {
      mergeInto(prev, b);
      continue;
    }
    out.push(b);
  }
  return out;
}

function canMerge(a: FlowBlock, b: FlowBlock): boolean {
  if (a.focus.file !== b.focus.file) return false;
  if ((a.role ?? 'unchanged') !== (b.role ?? 'unchanged')) return false;
  // Only merge when the new-side ranges touch or overlap. That keeps
  // logically-adjacent hunks together but leaves unrelated blocks alone.
  const aEnd = a.focus.endLine;
  const bStart = b.focus.startLine;
  if (bStart - aEnd > 3) return false;
  return true;
}

function mergeInto(prev: FlowBlock, extra: FlowBlock): void {
  prev.focus.endLine = Math.max(prev.focus.endLine, extra.focus.endLine);
  if (extra.beforeFocus) {
    if (!prev.beforeFocus) {
      prev.beforeFocus = { ...extra.beforeFocus };
    } else if (prev.beforeFocus.file === extra.beforeFocus.file) {
      prev.beforeFocus.startLine = Math.min(
        prev.beforeFocus.startLine,
        extra.beforeFocus.startLine,
      );
      prev.beforeFocus.endLine = Math.max(
        prev.beforeFocus.endLine,
        extra.beforeFocus.endLine,
      );
    }
  }
  const hint = `also at ${extra.focus.file}:${extra.focus.startLine}`;
  prev.narrative = prev.narrative ? `${prev.narrative}\n(${hint})` : `(${hint})`;
  // Fold mocks/concerns from the merged block, dropping duplicates by id.
  const seenMocks = new Set(prev.mocks.map((m) => m.id));
  for (const m of extra.mocks) {
    if (!seenMocks.has(m.id)) {
      prev.mocks.push(m);
      seenMocks.add(m.id);
    }
  }
  const seenConcerns = new Set(prev.concerns.map((c) => c.id));
  for (const c of extra.concerns) {
    if (!seenConcerns.has(c.id)) {
      prev.concerns.push(c);
      seenConcerns.add(c.id);
    }
  }
  // Focal is single-valued per block. Prefer the earlier block's marker; adopt
  // extra's only when prev has none, so the merger never silently drops an
  // LLM-issued focal signal.
  if (!prev.focal && extra.focal) prev.focal = extra.focal;
  // Children from extra don't survive dedupe — they belong to a block we're
  // discarding. Callers shouldn't rely on them being reachable. If future
  // scenarios need them, revisit here.
}

// ---------------------------------------------------------------------------
// Refined-flow patch: parse & apply
// ---------------------------------------------------------------------------

interface RawRefinedFlowPatch {
  replacements?: Array<{ blockId?: unknown; block?: unknown }>;
  removals?: unknown[];
  insertions?: Array<{ parentId?: unknown; index?: unknown; block?: unknown }>;
}

/**
 * Parse the LLM-returned patch JSON into `RefinedFlowPatch`. Runs raw blocks
 * through the same normalisation used by `planFlow`, so the client can trust
 * that inserted/replaced blocks have the shape the rest of the pipeline
 * expects. The `perspectiveId` seeds fallback ids the same way planFlow does.
 */
export function parseRefinedFlowPatch(
  raw: unknown,
  perspectiveId: string,
): RefinedFlowPatch {
  const source = (raw ?? {}) as RawRefinedFlowPatch;
  const replacements: RefinedFlowPatch['replacements'] = [];
  const removals: RefinedFlowPatch['removals'] = [];
  const insertions: RefinedFlowPatch['insertions'] = [];

  const rawReplacements = Array.isArray(source.replacements) ? source.replacements : [];
  rawReplacements.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const blockId = typeof entry.blockId === 'string' ? entry.blockId : '';
    if (!blockId) return;
    const rawBlock = entry.block;
    if (!rawBlock || typeof rawBlock !== 'object') return;
    const block = normalizeBlock(rawBlock as RawBlock, `${perspectiveId}-r${i}`);
    // A replacement keeps the original block's id — the summary shown to the
    // model referenced that id, and applying by id is the whole contract.
    block.id = blockId;
    replacements.push({ blockId, block });
  });

  const rawRemovals = Array.isArray(source.removals) ? source.removals : [];
  for (const r of rawRemovals) {
    if (typeof r === 'string' && r) removals.push(r);
  }

  const rawInsertions = Array.isArray(source.insertions) ? source.insertions : [];
  rawInsertions.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const parentId = entry.parentId === null || typeof entry.parentId === 'string'
      ? entry.parentId
      : null;
    const index = typeof entry.index === 'number' && Number.isFinite(entry.index)
      ? Math.max(0, Math.floor(entry.index))
      : 0;
    const rawBlock = entry.block;
    if (!rawBlock || typeof rawBlock !== 'object') return;
    const block = normalizeBlock(rawBlock as RawBlock, `${perspectiveId}-i${i}`);
    insertions.push({ parentId, index, block });
  });

  return { replacements, removals, insertions };
}

/**
 * Apply the patch onto an existing block tree. Touched blocks (replacements +
 * insertions) are hydrated and get their `role` derived from the diff; the
 * rest of the tree keeps its existing hydration untouched. Adjacent-dedupe
 * runs at the end because a replacement or insertion may have created a
 * mergeable neighbour.
 */
export async function applyRefinedFlowPatch(
  currentBlocks: FlowBlock[],
  patch: RefinedFlowPatch,
  ref: PrRef,
  diff: DiffPort,
  unified: UnifiedDiff,
): Promise<FlowBlock[]> {
  const touched: FlowBlock[] = [];

  const replacementById = new Map<string, FlowBlock>();
  for (const r of patch.replacements) replacementById.set(r.blockId, r.block);
  const removalSet = new Set<string>(patch.removals);

  const walkForReplaceRemove = (nodes: FlowBlock[]): FlowBlock[] => {
    const out: FlowBlock[] = [];
    for (const n of nodes) {
      if (removalSet.has(n.id)) continue;
      const replacement = replacementById.get(n.id);
      if (replacement) {
        // Replacements come from the LLM without hydrated children — merge
        // the surviving children of the block being replaced so nested
        // structure is preserved unless the LLM insertion overwrites it.
        const merged: FlowBlock = {
          ...replacement,
          children: replacement.children.length > 0
            ? replacement.children
            : walkForReplaceRemove(n.children),
        };
        touched.push(merged);
        out.push(merged);
        continue;
      }
      out.push({ ...n, children: walkForReplaceRemove(n.children) });
    }
    return out;
  };

  let next = walkForReplaceRemove(currentBlocks);

  // Insertions: apply after replace/remove so `parentId` and `index` refer to
  // the tree the LLM saw in the summary (which is the pre-apply tree with
  // removals hidden but replacements in place). Do parent-side first, then
  // root-level, to avoid inserting into a block that's about to be inserted.
  const rootInsertions = patch.insertions.filter((ins) => ins.parentId === null);
  const childInsertions = patch.insertions.filter((ins) => ins.parentId !== null);

  const insertInto = (parent: FlowBlock, insertion: typeof childInsertions[number]): boolean => {
    if (parent.id === insertion.parentId) {
      const idx = Math.min(Math.max(0, insertion.index), parent.children.length);
      parent.children.splice(idx, 0, insertion.block);
      touched.push(insertion.block);
      return true;
    }
    for (const child of parent.children) {
      if (insertInto(child, insertion)) return true;
    }
    return false;
  };

  for (const insertion of childInsertions) {
    let placed = false;
    for (const root of next) {
      if (insertInto(root, insertion)) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Parent id not found — fall back to root append so the block is not
      // silently lost. Better a wrong location than a dropped narrative.
      next.push(insertion.block);
      touched.push(insertion.block);
    }
  }

  for (const insertion of rootInsertions) {
    const idx = Math.min(Math.max(0, insertion.index), next.length);
    next.splice(idx, 0, insertion.block);
    touched.push(insertion.block);
  }

  if (touched.length > 0) {
    await hydrateFlowCode(touched, ref, diff);
    assignRoles(touched, unified);
  }
  return dedupeAdjacentBlocks(next);
}
