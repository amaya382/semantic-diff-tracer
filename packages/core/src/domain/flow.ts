export type MockKind = 'stub' | 'value' | 'skip';

export interface Mock {
  id: string;
  symbol: string;
  file: string;
  kind: MockKind;
  value?: string;
  reason: string;
  editable: boolean;
  userOverridden: boolean;
}

export type Severity = 'info' | 'warn' | 'error';

export interface Concern {
  id: string;
  severity: Severity;
  message: string;
  anchor: { file: string; line: number };
}

export interface Variable {
  name: string;
  value: string;
  note?: string;
}

export type BlockRole = 'added' | 'modified' | 'removed' | 'unchanged';

/**
 * Value-neutral marker for "this is where the PR's intent lives". Orthogonal to
 * role (which is the diff-shape signal) and to concern severity (which is the
 * risk signal). Set by the LLM, clipped by post-process against per-kind
 * budgets, then surfaced in the Flow list chip, the left-pane Focal card, and
 * the CodeView gutter icon.
 */
export type FocalKind = 'entry' | 'core' | 'contract';

export interface Focal {
  kind: FocalKind;
  /**
   * One sentence stating *what changed here* — not what the block does. For a
   * contract block, the reason should say which sub-case applies ("shape now
   * includes …" vs "downstream now sees …").
   */
  reason: string;
}

export interface FlowBlock {
  id: string;
  title: string;
  narrative: string;
  /** Post-merge (new) side location. Always present; used as the block identity. */
  focus: { file: string; startLine: number; endLine: number };
  /** After-side code snippet (hydrated from headSha). */
  code: string;
  /**
   * Before-side location. Absent when the file is new or the block covers
   * pure-additive code. Line numbers are in the base (pre-merge) file.
   */
  beforeFocus?: { file: string; startLine: number; endLine: number };
  /** Before-side code snippet (hydrated from baseSha, honouring rename). */
  beforeCode?: string;
  /**
   * Semantic role in the story flow. Drives the Summary badge and the
   * default side of the Trace tab's Before/After toggle. Derived from the diff
   * during planFlow — LLM hints in the raw JSON are overridden.
   */
  role?: BlockRole;
  visibleVars: Variable[];
  mocks: Mock[];
  concerns: Concern[];
  /**
   * Optional focal marker. Absent on the vast majority of blocks; a whole flow
   * carries at most 5 focal blocks across the tree.
   */
  focal?: Focal;
  children: FlowBlock[];
}

export interface Flow {
  flowId: string;
  perspectiveId: string;
  /** Root-level blocks, DFS-ordered when flattened for navigation. */
  blocks: FlowBlock[];
  /** All mocks in the flow, indexed for the Mocks pane; each Mock also lives on its owning block. */
  allMocks: Mock[];
}

/** Position inside a flow, expressed as the path of indices from root down to the current block. */
export type BlockPath = number[];

export type StepAction = 'over' | 'in' | 'out' | 'reverse';

/**
 * Minimal edit script for refining a flow tree in response to a mock change.
 * The LLM returns only what differs — replacements match by existing block id,
 * insertions carry a parent id (null = root) plus insertion index, and
 * removals list the block ids to drop. Everything else is left as-is.
 */
export interface RefinedFlowPatch {
  replacements: Array<{ blockId: string; block: FlowBlock }>;
  removals: string[];
  insertions: Array<{ parentId: string | null; index: number; block: FlowBlock }>;
}
