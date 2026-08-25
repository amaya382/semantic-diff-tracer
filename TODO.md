# semantic-diff-tracer TODO

Follow-ups not tackled in the initial main rebuild. Update as work lands.

## Core

- **planFlow LLM discipline.** Prompt occasionally returns >12 blocks; the
  plan says to fall back to a two-shot refold, but the current implementation
  only runs the single-shot path. Add the fold pass.
- **Speed up LLM-driven stages.** `planFlow` currently takes over a minute in
  many cases; the same latency shows up on other LLM-driven stages
  (perspective, summary, refineFlow, askQa). Investigate parallelism across
  independent blocks, prompt-size reduction, streaming, and cheaper models for
  intermediate stages so the wall time comes down to something interactive.
- **Stabilise Summary and Trace output.** For large PRs the resulting Summary
  and Trace content still varies noticeably between runs, and it is unclear
  whether the current prompts hold up on high-churn diffs. Design the prompts
  and the LLM call graph so the output stays coherent as diff size grows, and
  add regression fixtures that exercise several sizes of PR.
- **PR review comments.** Not implemented in main. If reintroduced, wire
  into Summary Q&A answers as an action button ("Post as PR comment") rather
  than the ad-hoc gutter command from `main`.

## VSCode extension

- **Editor tab integration.** Currently the Trace tab renders code inside its own
  webview. Explore delegating code display to a real VSCode editor tab:
  gains syntax highlighting from the user's chosen theme, symbol navigation,
  peek definition, Copy Path, etc. Constraints to solve:
  - Panel<->editor sync: highlighting focus range, jumping to a block also
    reveals the range in the editor.
  - How to keep the code visible while the reviewer scrolls through blocks
    (side-by-side layout without stealing focus).
  - Whether to open the file at `headSha` (read-only) or the working tree
    (mutable, may drift).
- **Better code jump story.** Concerns / Tests / WatchFor / anchor chips
  already resolve `file:line` via `openFile` → `showTextDocument` +
  `revealRange`. Remaining gaps:
  - Q&A `turn.answer` renders as raw markdown; `file:line` mentions in the
    answer body are not linkified ([apps/vscode/src/webview-ui/perspective.ts:1011](apps/vscode/src/webview-ui/perspective.ts#L1011)).
  - Flow block-title click posts `goto`, which only moves the webview
    cursor — it should also open the primary file in the editor
    ([apps/vscode/src/webview-ui/perspective.ts:648](apps/vscode/src/webview-ui/perspective.ts#L648)).

## TUI

- **Screen chrome.** Current TUI is a plain readline REPL. Add:
  - Persistent header (PR, perspective, block breadcrumb).
  - Colours for severity chips, block titles, code highlight lines.
  - `?` help overlay listing commands.
- **Layout.** Split screen (info + code) with ANSI escapes so `s`/`i`/`o`/`b`
  don't scroll the terminal — target `neo-blessed`, `ink`, or a hand-rolled
  cursor-move implementation.
- **Ask-about-selection parity.** TUI Summary supports `a`/`f` but there is
  no way to pick a slice of summary text as `contextRef`; add a `y` mode
  that opens `$EDITOR` to compose the question with context.

## Testing

- **E2E harness.** `e2e/vscode` and `e2e/tui` currently hold only empty
  `src/` (and `fixtures/`) directories — no `package.json`, no tests, no
  fixtures. `packages/testing` already exposes the pieces a harness would
  wire up (`StubLlmProvider` at [packages/testing/src/stub-llm.ts:18](packages/testing/src/stub-llm.ts#L18),
  plus `stub-diff`, `stub-pr`, `memory-session-store`); no e2e caller
  imports them yet. Rebuild once the shape of the new UX stabilises.
- **Snapshot tests for prompts.** Freeze the perspective / summary / flow /
  refine-mock / ask prompts so accidental edits are caught in CI.

## Docs / Spec

- **Adopt OpenSpec.** The repo has no `openspec/` or `.openspec/` today and
  no OpenSpec reference in any doc — the spec surface currently lives only
  in `README.md`, per-package headers, and the prompt strings under
  `packages/core/src/prompts/`. Introduce OpenSpec so the pipeline
  (perspective → summary → planFlow → refineFlow → askQa) has a
  single machine-readable source of truth for capabilities, ports, and
  prompt contracts, and CI can diff proposed changes against it.
  Sub-tasks:
  - Decide the layout (`openspec/` at repo root vs. one per package).
  - Seed the initial specs from the existing `LlmProvider` / `PrPort` /
    `DiffPort` / `SessionStore` port definitions and the five prompt
    templates.
  - Wire an `openspec` check into CI so spec drift shows up as a review
    signal alongside the prompt snapshot tests above.
