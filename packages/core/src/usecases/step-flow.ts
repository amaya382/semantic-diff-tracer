import type { BlockPath, Flow, FlowBlock, StepAction } from '../domain/flow.js';

/** Depth-first, pre-order traversal of the flow tree — returns every block path. */
export function dfsPaths(flow: Flow): BlockPath[] {
  const out: BlockPath[] = [];
  const walk = (blocks: FlowBlock[], prefix: BlockPath): void => {
    blocks.forEach((b, i) => {
      const p = [...prefix, i];
      out.push(p);
      walk(b.children, p);
    });
  };
  walk(flow.blocks, []);
  return out;
}

export function blockAt(flow: Flow, path: BlockPath): FlowBlock | undefined {
  let siblings = flow.blocks;
  let node: FlowBlock | undefined;
  for (const idx of path) {
    node = siblings[idx];
    if (!node) return undefined;
    siblings = node.children;
  }
  return node;
}

function pathsEqual(a: BlockPath, b: BlockPath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface StepResult {
  /** New position, or undefined if the action fell off the tree (flow end). */
  next?: BlockPath;
  /** Undefined action = no change (e.g. Reverse with empty history). */
  historyPush?: BlockPath;
  /** Pop the history stack (Reverse). */
  historyPop?: boolean;
}

/**
 * Pure navigation over the DFS-flattened block tree.
 *
 * - `over`: next sibling; if none, ascend to the nearest ancestor whose next sibling exists.
 * - `in`: first child; if none, same as `over`.
 * - `out`: parent's next sibling; if at root, ends the flow.
 * - `reverse`: pop the caller's history stack (returned separately).
 */
export function stepFlow(
  flow: Flow,
  current: BlockPath,
  action: StepAction,
  history: BlockPath[],
): StepResult {
  if (action === 'reverse') {
    if (history.length === 0) return {};
    const prev = history[history.length - 1]!;
    return { next: prev, historyPop: true };
  }

  const flat = dfsPaths(flow);
  const currentIndex = flat.findIndex((p) => pathsEqual(p, current));
  if (currentIndex < 0) return {};

  if (action === 'in') {
    const cur = blockAt(flow, current);
    if (cur && cur.children.length > 0) {
      const next: BlockPath = [...current, 0];
      return { next, historyPush: current };
    }
    // fallthrough to `over` semantics when no children
  }

  if (action === 'in' || action === 'over') {
    // First path in flat[] that strictly follows current and is not a descendant.
    for (let i = currentIndex + 1; i < flat.length; i++) {
      const cand = flat[i]!;
      if (!isDescendant(current, cand)) {
        return { next: cand, historyPush: current };
      }
    }
    return { historyPush: current };
  }

  // out: find parent's next sibling.
  if (current.length === 0) return { historyPush: current };
  const parent = current.slice(0, -1);
  for (let i = currentIndex + 1; i < flat.length; i++) {
    const cand = flat[i]!;
    if (!isDescendant(parent, cand)) {
      return { next: cand, historyPush: current };
    }
  }
  return { historyPush: current };
}

function isDescendant(ancestor: BlockPath, candidate: BlockPath): boolean {
  if (candidate.length <= ancestor.length) return false;
  for (let i = 0; i < ancestor.length; i++) {
    if (ancestor[i] !== candidate[i]) return false;
  }
  return true;
}
