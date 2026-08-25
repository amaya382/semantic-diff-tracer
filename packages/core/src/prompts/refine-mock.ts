import type { Flow, FlowBlock, Mock } from '../domain/flow.js';

export const REFINE_MOCK_SYSTEM_PROMPT = `You are updating a previously-produced flow tree in response to a mock change. The reviewer has instructed you to alter one mock, and you must re-plan any downstream blocks (blocks that appear after the mock's owning block in DFS order) whose narrative, variables, or mocks would change under the new value.

Return only what changes as a patch. The client already holds the current tree and will apply your patch on top of it. Do not restate blocks that stay the same.

Rules:

- Every unchanged block must be **omitted from the patch entirely**. Do not include it under any of the three lists below.
- A block whose narrative, variables, or mocks would differ under the new value goes into \`replacements\` with the SAME id it already has. The client re-uses that id to locate and swap the block in place.
- A block that should no longer exist goes into \`removals\` by its id.
- A block that should be added — because the new value opens a code path that was previously mocked away — goes into \`insertions\` with a fresh kebab-case id, the id of its intended parent block (or \`null\` for a root-level block), and the zero-based \`index\` at which it should sit among its siblings after the patch is applied.
- A single mock edit typically produces zero to three items across all three lists. If you want to touch more than that, reconsider whether the downstream really needs those changes.
- Do not renumber, split, or restructure the whole tree. Prefer the smallest possible patch that reflects the mock's new behaviour.
- Every block you emit follows the flow's per-block budget: **narrative ≤ 2 short sentences (no code copy), visibleVars 2-3 entries with concrete sample values**. The Trace tab renders the source next to your text; do not paste code into narrative or visibleVars.

Output STRICT JSON matching this TypeScript type (no prose, no markdown fences):

{
  "replacements": [ { "blockId": string, "block": Block } ],
  "removals": [ string ],
  "insertions": [ { "parentId": string | null, "index": number, "block": Block } ]
}

The Block shape is the same one used in the original flow response — same fields, same schema.

Start the response with '{' and end with '}'. Field names are load-bearing.`;

export function buildRefineMockUserMessage(
  flow: Flow,
  targetMock: Mock,
  instruction: string,
): string {
  const summary = summarizeFlow(flow);
  return `Current flow tree (summary — id after the depth marker, then title):
${summary}

Target mock:
- id: ${targetMock.id}
- symbol: ${targetMock.symbol}
- file: ${targetMock.file}
- current kind: ${targetMock.kind}
- current value: ${targetMock.value ?? 'null'}

Reviewer's instruction for this mock:
"""
${instruction}
"""

Re-plan the flow tree so the mock reflects the instruction (change value, drop the mock and follow the real path, or tighten kind). Emit the smallest patch that captures the downstream changes, then return the patch JSON.`;
}

function summarizeFlow(flow: Flow): string {
  const lines: string[] = [];
  const walk = (blocks: FlowBlock[], depth: number): void => {
    for (const b of blocks) {
      lines.push(
        `${'  '.repeat(depth)}- [${b.id}] ${b.title} @ ${b.focus.file}:${b.focus.startLine}`,
      );
      walk(b.children, depth + 1);
    }
  };
  walk(flow.blocks, 0);
  return lines.join('\n');
}
