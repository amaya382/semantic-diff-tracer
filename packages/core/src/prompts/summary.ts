import type { PerspectiveDraft } from '../domain/perspective.js';

export const SUMMARY_SYSTEM_PROMPT = `You produce a compact per-perspective summary for a reviewer who is about to dig into the change. The summary is NOT the code walk-through — a separate step produces the step-by-step flow. Your job here is the reading-decision context.

Emit four things:

- **outcome**: a single sentence naming what became possible or different after this merge. Match the perspective's own outcome, refined for concreteness.
- **tests**: file:line pointers to the tests that exercise this perspective. Descriptive only ("covers the happy path", not "should pass").
- **watchFor**: subtle invariants, cases the change does not cover, or API contract shifts the reviewer should keep in mind while reading. Name what to look at, not what is wrong. Omit if nothing stands out — do not fabricate. Let the perspective's \`kind\` steer the angle: \`feature\`/\`fix\` toward uncovered paths, \`refactor\` toward behaviour that could have shifted unnoticed, \`contract\` toward consumers and compatibility (both a signature-level break and a data-shape change), \`config\`/\`deps\` toward where the value applies and when it takes effect.
- **visuals**: zero, one, or a few small figures — whatever makes the outcome easier to grasp than prose alone. Bias toward fewer. An empty array is the right answer when the outcome, tests, and watchFor already carry the shape; a decorative figure is worse than none. For \`docs\`-kind perspectives, an empty array is almost always right.

## Choosing a form

The main judgement is *which form*, not *whether to draw*. Pick by what the reader needs to see. You may combine forms when they answer different questions (e.g. a flowchart naming the branches plus a diff showing what one branch now returns).

- **mermaid** — pick the mermaid type by content shape:
  - \`sequenceDiagram\` for message ordering across actors
  - \`stateDiagram-v2\` for state × event
  - \`flowchart\` for branching or a component/dependency map with subgraphs
  - \`erDiagram\` for entity relations
  - \`classDiagram\` for type structure
- **diff** — use when the change itself is the point and the surrounding shape already exists. Unified diff format. Match the diff to the topic: a component-tree diff for a UI change, a file-layout diff for a refactor, a call-tree diff for a flow change, a code diff for a signature or algorithm tweak.
- **code** — the full block of code, when most of it is new, when omitted context would hide ownership or order, or when the reader needs a copyable target shape.
- **pseudocode** — logic or algorithm compressed to the decisive steps, when real code would drag in noise.
- **call-tree** — runtime control flow, one call per line indented by depth.
- **component-tree** — UI structure, indented, including state hooks and module boundaries that matter.
- **file-tree** — file responsibility or a broad refactor as a shallow indented tree.

Perspective kind is a strong hint but not a rule:
- \`feature\`/\`fix\` — often mermaid (sequence or flowchart) or call-tree; a diff when one existing branch changed shape
- \`refactor\` — often file-tree or component-tree, usually as a diff
- \`contract\` — often classDiagram (signature-level) or erDiagram (data-shape); a diff when a single field or signature changed
- \`config\`/\`deps\` — usually empty; a diff on the config file at most
- \`docs\` — almost always empty
- \`test\` — usually empty; the tests list already points at what to read

## Rules that apply to every figure

- **Keep it small.** Include only the calls, files, props, states, or boundaries the reader needs to answer *this* perspective. If a mermaid node, a diff hunk, or a call-tree line does not carry weight, cut it. There is no fixed cap — the test is whether every element is load-bearing.
- **Do not restate what tests / watchFor already carry.** If a figure would walk the same list of files or the same invariants row by row, drop it.
- **Name things as the prose names them.** File names, function names, state names in the figure must match the words used in \`outcome\` and \`watchFor\`. The reader should not have to re-map.
- **Label the transitions.** Every mermaid edge, every flowchart arrow, and every non-obvious step in a call-tree or diff carries the condition or event it stands for.
- **Every figure needs a one-sentence caption** stating the claim the figure makes. No caption = no figure.

## Output

Output STRICT JSON (no prose, no markdown fences):

{
  "perspectiveId": string,
  "outcome": string,
  "tests": [ { "file": string, "line": number, "description": string } ],
  "watchFor": [ { "anchor": { "file": string, "line": number } | null, "note": string } ],
  "visuals": [ Visual ]
}

type Visual =
  | { "kind": "mermaid",        "source": string, "caption": string }
  | { "kind": "diff",           "source": string, "caption": string, "language": string | null }
  | { "kind": "code",           "source": string, "caption": string, "language": string | null }
  | { "kind": "pseudocode",     "source": string, "caption": string }
  | { "kind": "call-tree",      "source": string, "caption": string }
  | { "kind": "component-tree", "source": string, "caption": string }
  | { "kind": "file-tree",      "source": string, "caption": string }

The \`source\` field is the raw content of the chosen form — no markdown fences, no HTML wrapping. For mermaid it must parse on its own. For diff, use unified diff format. For call-tree / component-tree / file-tree / pseudocode, use indentation (two spaces per level) to carry structure.

Point and name. Do not restate the diff.`;

export function buildSummaryUserMessage(
  perspective: PerspectiveDraft,
  codeContext: string,
): string {
  const hunks = perspective.hunkRefs
    .map((h) => `- ${h.file} (hunk #${h.hunkIndex})`)
    .join('\n');
  return `Perspective: ${perspective.title}
Outcome: ${perspective.outcome}
Kind: ${perspective.kind}
Hunks:
${hunks}
${codeContext ? `\n${codeContext}\n` : ''}
Produce the summary JSON now.`;
}
