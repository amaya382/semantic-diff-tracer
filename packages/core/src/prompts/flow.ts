import type { PerspectiveDraft, PerspectiveKind, TraceMode } from '../domain/perspective.js';
import { traceModeFor } from '../domain/perspective.js';

const FLOW_BASE_PROMPT = `You produce a "story-mode" trace for a PR reviewer: a small tree of blocks that walks the reader through the code this perspective touches. Blocks are read in DFS order, so callers can flatten the tree without losing sequence.

These rules hold whatever the perspective is:

- Each block covers **one focus range** in one file. Show only the code the reader needs at that step; leave the surrounding file for the reader to scroll to.
- Context blocks are allowed. The starting point may be far from the diff — include it when the story needs it. Mark such a block with \`"role": "unchanged"\`.
- Surface a concern only when the code itself invites one. Do not invent concerns to fill space.
- **narrative is at most 2 short sentences.** No code copy, no line-by-line commentary — the reader has the code beside your narrative. Point and name.
- **Do not restate the diff, and do not paste code into \`narrative\` or \`visibleVars\`.** The Trace tab renders the source next to your text; duplicating it wastes tokens and dilutes the story.
- **Deleted code**: when the PR removes code, still create a block for that step. Set \`focus\` to the *post-merge* location where the removed logic used to be called from (the surrounding surviving code) and set \`beforeFocus\` to the *base-side* range of the actual removed lines. Mark it \`"role": "removed"\`. The reviewer will read the removed code on the Before pane; skipping the block would hide the change entirely.
- **Merge related steps**: if several small changes belong to the same idea (e.g. the same helper is deleted from 5 call sites), emit **one** block whose focus points at a representative site and describe the others in \`narrative\` ("also at foo.ts:42, foo.ts:88"). The reviewer can jump to the others via the editor once they understand the shape.
- **Peripheral hunks are not blocks.** The user message splits this perspective's hunks into two lists: primary (carries the change the reviewer opened this perspective for) and peripheral (rode along — an adjacent comment tweak, a docstring edit, a rename ripple, a format-only edit inside a primary hunk's file). Build blocks from primary hunks only. Peripheral hunks may be **named in \`narrative\`** on the block whose file they touch ("also updates the doc comment above"), never as their own block. If a peripheral hunk sits in a file no primary hunk touches, drop it silently — the Incidental panel already surfaces those to the reviewer.`;

/**
 * Value-neutral marker for "this is where the PR's intent lives". Kept
 * separate from concerns (risk signal) and from role (diff-shape signal) so
 * the three axes stay independent when read side by side.
 */
const FLOW_FOCAL_PROMPT = `Additional instruction — Focal points of THIS PR's change:

Beyond concerns (things to worry about), mark which blocks carry the *intent* of the diff — the blocks a reviewer would need to read to answer "what did this PR actually change?". Focal is value-neutral: it is not severity, it is not risk, it is "this is where the change lives".

Set \`focal\` on a block when — and only when — one of these holds. Do NOT mark a block focal just because its role is "added" or "modified": role already carries the diff-shape signal. Focal is the exception.

- kind = "entry"    : this block is the flow's entry point AND the entry is newly introduced or its reached-callees set fundamentally shifted. Not just "first block".
- kind = "core"     : the mechanism the PR is *for* runs in this block's body. If a reviewer skips this block, they miss the point of the PR. Pick sparingly — most PRs have one core block; a PR that coordinates two distinct mechanisms may have two.
- kind = "contract" : the block changes what the world outside this code sees. Two sub-cases fall under this one kind:
    (a) shape change — inputs/outputs, thrown errors, emitted events, or persisted shape now differ;
    (b) observable-effect site — where the diff's effect becomes visible to the caller, user, or downstream system (return, dispatch, side-effect).
  Pick this when either sub-case holds.

\`focal.reason\` MUST be one sentence, ≤ 140 chars, stating *what changed here* — not what the block does. Bad: "verifies HMAC signature". Good: "now rejects requests with legacy sha1 signatures — was accept-all before". When the block is a contract block, the reason should say *which* sub-case applies: "shape now includes …" vs "downstream now sees …".

Budgets per flow (across the whole tree, not per level):
- ≤ 2 blocks with kind="core"    (0 is fine; do not force one. Prefer 1 unless the PR clearly coordinates two distinct mechanisms)
- ≤ 2 blocks with kind="entry"
- ≤ 3 blocks with kind="contract" (both sub-cases share this budget; split typically 1-2 for shape and 1 for observable-effect at most)
- total focal blocks ≤ 5

If the flow genuinely holds no PR-intent worth marking (a pure walk-through of well-worn code that this PR only touches at the edges), emit zero focal — silence is a signal.

Do NOT restate diff text in \`focal.reason\`. Point and name.`;

/**
 * What varies per trace mode: how many blocks, what a block stands for, what
 * `visibleVars` carries, whether mocks apply, and where concerns come from.
 * The output schema is shared, so the client parses one shape regardless.
 */
const TRACE_MODE_SECTIONS: Record<TraceMode, string> = {
  flow: `## This perspective changes runtime behaviour — trace the execution path

Walk one imagined run from its entry point to the observable effect. Aim for **4 to 8 blocks total** across the whole tree — fewer is fine when the perspective is small. Group related steps under a parent when it helps; otherwise keep it flat.

**Auto-mock** external I/O, filesystem, DB, clock, and randomness — one line per mock, short reason. Do not follow control flow into unrelated code paths. **Cap the whole tree at 8 mocks.** Fold repeat-of-same-kind mocks (5 fs reads) into one.

**visibleVars carry the trace** — the values that move between blocks, in one consistent imagined run:

- Give every block **2 to 3 entries**. An empty \`visibleVars\` is fine only for a pure guard or import-only block; say so briefly in \`narrative\`.
- **Concrete sample values, never types or placeholders.** \`"u_42"\`, \`"{ retries: 3 }"\`, \`"null"\` — not \`"string"\` or \`"<userId>"\`.
- **One consistent imagined run.** \`userId = "u_42"\` in block 1 stays \`"u_42"\` in later blocks that still see it. Show what changed in \`note\` (\`"was 'draft'"\`); use null when the name and value speak for themselves.

Concerns come from the path itself: a subtle invariant, a missing null check, a race, an unhandled branch.

Focal usage: the block where the new behaviour materialises is core; where the request first enters the changed path is entry; where the effect becomes visible to the caller or downstream is contract.`,

  structural: `## This perspective restructures without changing behaviour — trace the equivalence

The reviewer's question is not "what happens at runtime" but "is this really the same code, and did every site follow". Aim for **3 to 8 blocks**. Order them: the new shape of the definition first, then the call sites that had to follow, then anything left behind.

- A block is either the moved or extracted definition, or a representative call site. Use \`narrative\` to name the other sites covered by the same block.
- **State what is preserved.** Every \`narrative\` should say which behaviour the block claims to keep identical, in the reviewer's terms ("same ordering", "same early return when the list is empty").
- \`visibleVars\` holds only values whose *identity across the rewrite* is the point — the argument that used to be positional and is now a field, the accumulator that must still start empty. Two or three entries is plenty, and **an empty \`visibleVars\` is fine** when the block moves code without moving data. Say so in \`narrative\` rather than inventing runtime values.
- **Do not emit mocks.** There is no run to stand in for; leave \`mocks\` empty.

Concerns are the ways a "pure" restructure silently is not one: a default argument that changed, \`null\` versus \`undefined\`, evaluation or mutation order, a call site the rename missed, a widened or narrowed visibility.

Focal usage: mark the moved/extracted definition as core; mark a call site as contract only if its caller-contract subtly changed (e.g. positional arg became a field, default changed). Most structural PRs need only 0-1 focal blocks.`,

  contract: `## This perspective changes an interface or a data shape — trace the contract

The reviewer's question is who has to change with it. Aim for **4 to 8 blocks**, ordered: the definition, then the producer, then each consumer, then the compatibility story.

- **Say in the first block's \`narrative\` whether this is a breaking change**, and for whom. If it is additive and optional, say that too.
- \`visibleVars\` carries the shape crossing the boundary, not a runtime walk: one entry per field or parameter that changed, with the new form in \`value\` and the old form in \`note\` (e.g. \`"was: { id: number }"\`). Two to five entries.
- **Do not emit mocks.**
- Give the last block to compatibility: what a caller on the old shape sees, whether the persisted or in-flight data needs a migration, and in what order deploys must land.

Concerns are consumers that did not follow, missing back-compat for data written by the previous version, and version skew between the two sides during rollout.

Focal usage: the definition block is core; the block documenting compatibility, or the consumer where the shape change first becomes visible, is contract. Producer/consumer blocks usually do not each need focal — the definition itself carries the story.`,

  surface: `## This perspective changes configuration, dependencies, docs, or tests — point, do not walk

There is no execution path worth walking here. Aim for **1 to 4 blocks**, one per setting or file group that changed. Brevity is the goal; a reviewer reading this tab should be done in under a minute.

- \`visibleVars\` holds **the changed values themselves**: \`name\` is the key or dependency, \`value\` is the new value, \`note\` is the old one (e.g. \`"was 18"\`). One to four entries.
- **Never invent runtime values here.** If the change has no values to show (a docs edit), leave \`visibleVars\` empty and say what the text now claims in \`narrative\`.
- **Do not emit mocks.**
- \`narrative\` answers: who reads this value, whether it differs per environment, and when it takes effect (build time, deploy, next process start).

Leave \`concerns\` empty unless the change is genuinely load-bearing — a default that silently applies to production, a dependency bump crossing a major version, a test whose assertion was weakened.

Focal usage: rarely applicable. Only mark focal when a single setting or dependency change is itself the point of the PR (e.g. bumping a security-critical package). Never mark more than 1 block focal in surface mode.`,
};

const FLOW_OUTPUT_SCHEMA = `Output STRICT JSON matching this TypeScript type (no prose, no markdown fences):

{
  "blocks": [ Block ]
}

type Block = {
  "id": string,                         // kebab-case slug, unique across the tree
  "title": string,                      // 2-6 words
  "narrative": string,                  // one short paragraph
  "focus": { "file": string, "startLine": number, "endLine": number },
  "beforeFocus": { "file": string, "startLine": number, "endLine": number } | null,  // base-side range; required for role=removed, optional otherwise
  "role": "added" | "modified" | "removed" | "unchanged" | null,  // hint; the client re-derives from diff and overrides
  "visibleVars": [ { "name": string, "value": string, "note": string | null } ],  // see the trace-mode section above for what these carry
  "mocks": [
    {
      "id": string,
      "symbol": string,
      "file": string,
      "kind": "stub" | "value" | "skip",
      "value": string | null,
      "reason": string,
      "editable": true
    }
  ],
  "concerns": [
    {
      "id": string,
      "severity": "info" | "warn" | "error",
      "message": string,
      "anchor": { "file": string, "line": number }
    }
  ],
  "focal": {
    "kind": "entry" | "core" | "contract",
    "reason": string
  } | null,
  "children": [ Block ]
}

All \`focus.startLine\`/\`focus.endLine\`, \`concerns[].anchor.line\`, and any file line numbers you emit are in **post-merge (new-file) line-space** — the same numbers shown in the code context's gutter. Read them straight from the gutter; do not count positions within a hunk body. \`beforeFocus.startLine\`/\`beforeFocus.endLine\` are the sole exception: they are in **base-side (pre-merge) line-space** and correspond to the base-side gutter numbers.

Start the response with '{' and end with '}'. Field names are load-bearing.`;

export function buildFlowSystemPrompt(kind: PerspectiveKind): string {
  const mode = traceModeFor(kind);
  // Surface mode caps focal at 1 block anyway — the full focal essay just
  // burns tokens the model will not use.
  const parts =
    mode === 'surface'
      ? [FLOW_BASE_PROMPT, TRACE_MODE_SECTIONS[mode], FLOW_OUTPUT_SCHEMA]
      : [FLOW_BASE_PROMPT, FLOW_FOCAL_PROMPT, TRACE_MODE_SECTIONS[mode], FLOW_OUTPUT_SCHEMA];
  return parts.join('\n\n');
}

const CLOSING_BY_MODE: Record<TraceMode, string> = {
  flow: 'Produce the flow JSON now. Keep total blocks in the 4-8 range across the whole tree and mocks ≤ 8. Every block: narrative ≤ 2 short sentences (no code copy), visibleVars 2-3 entries with concrete sample values consistent across the trace.',
  structural:
    'Produce the flow JSON now. Keep it to 3-8 blocks. Say what each block preserves; keep visibleVars to values whose identity across the rewrite is the point, leaving it empty rather than inventing runtime values, and leave mocks empty.',
  contract:
    'Produce the flow JSON now. Keep it to 4-8 blocks, ordered definition → producer → consumers → compatibility. visibleVars carries the changed shape (new form in value, old form in note); leave mocks empty.',
  surface:
    'Produce the flow JSON now. Keep it to 1-4 blocks. visibleVars carries the changed settings themselves (new value in value, old value in note) and nothing else; leave mocks empty.',
};

export function buildFlowUserMessage(
  perspective: PerspectiveDraft,
  codeContext: string,
): string {
  const primary = perspective.hunkRefs.filter((h) => (h.role ?? 'primary') === 'primary');
  const peripheral = perspective.hunkRefs.filter((h) => h.role === 'peripheral');
  const primaryList = primary
    .map((h) => `- ${h.file} (hunk #${h.hunkIndex})`)
    .join('\n');
  const peripheralList = peripheral.length > 0
    ? peripheral.map((h) => `- ${h.file} (hunk #${h.hunkIndex})`).join('\n')
    : '(none)';
  return `Perspective: ${perspective.title}
Kind: ${perspective.kind}
Outcome: ${perspective.outcome}
Primary hunks (build blocks from these):
${primaryList}
Peripheral hunks (name in narrative if adjacent, never a block of their own):
${peripheralList}
${codeContext ? `\n${codeContext}\n` : ''}
${CLOSING_BY_MODE[traceModeFor(perspective.kind)]}`;
}
