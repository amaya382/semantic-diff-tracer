import type { Flow, FlowBlock, Mock } from '../domain/flow.js';

export const REFINE_MOCK_SYSTEM_PROMPT = `You are updating a previously-produced flow tree in response to a mock change. The reviewer has instructed you to alter one mock, and you must re-plan any downstream blocks (blocks that appear after the mock's owning block in DFS order) whose narrative, variables, or mocks would change under the new value.

Rules:

- Only touch blocks that would actually differ. Reuse block ids you keep unchanged; assign new ids only to blocks you rewrite or add.
- Keep the total block count in the same 5-12 band.
- Return the FULL new flow tree, not a diff. The client replaces its state wholesale.

Output STRICT JSON matching the flow schema you already know (starts with '{' and ends with '}'):

{ "blocks": [ Block ] }`;

export function buildRefineMockUserMessage(
  flow: Flow,
  targetMock: Mock,
  instruction: string,
): string {
  const summary = summarizeFlow(flow);
  return `Current flow tree (summary):
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

Re-plan the flow tree so the mock reflects the instruction (change value, drop the mock and follow the real path, or tighten kind). Update downstream blocks accordingly and return the new flow JSON.`;
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
