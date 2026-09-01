---
name: trace-diff
description: Render a GitHub PR or a local branch diff as a single self-contained HTML report with outcome-based perspectives, per-perspective Summary, and a client-side Trace stepper (Step In / Step Over / Step Out / Back). Use when the user asks for a "static PR overview", an "HTML report of this PR", or wants to review a PR outside VSCode. Triggers on a PR URL, a PR number (`#123`), a branch name, and phrasings like "PR を HTML にして", "trace-diff で見せて", "make an HTML overview of this PR", "static PR walkthrough".
---

# trace-diff

Emit a single-file HTML report for a PR using the semantic-diff-tracer pipeline. The report is meant for reviewers who want to grasp the PR outside VSCode: it contains outcome-based perspectives, per-perspective Summary (Outcome / Visualization / Watch-for / Tests), and a Trace tab whose Step In / Step Over / Step Out / Back buttons walk a pre-planned block tree on the client. No LLM calls happen after the file is written.

## When to use

- The user asks for an HTML / static / offline report of a PR.
- The user wants to share a review-ready view of a PR they cannot open in VSCode.
- The user runs `claude` CLI on a machine without the VSCode extension.

## When not to use

- The user is already reviewing inside VSCode — point them at the extension's `Semantic Diff Tracer: Open PR` command; the extension holds live Q&A and mock refine that this static report deliberately omits.
- The user only wants to talk about the PR, not produce an artifact.

## Prerequisites

- Node.js 20+.
- The user is logged into `claude` CLI (OAuth) or has provider credentials in env (`ANTHROPIC_API_KEY`, Vertex, Bedrock). Same rules as the VSCode extension and the TUI.
- For GitHub PRs: `GITHUB_TOKEN` / `GH_TOKEN` in env, or a logged-in `gh` CLI (the skill falls back to `gh auth token`).

## How to invoke

The skill ships a self-contained ESM bundle next to this file. Invoke it with the absolute path so it works regardless of the caller's cwd:

```bash
node "${SKILL_DIR}/bin/render.mjs" <URL | owner/repo#N | #N | branch> \
  [-o out.html] [--no-mermaid-cdn] [--trace-depth normal|deep]
```

Substitute `${SKILL_DIR}` with the directory containing this SKILL.md (typically `~/.claude/skills/trace-diff/` after `npx skills add amaya382/semantic-diff-tracer`). The bundle needs no `node_modules` — the whole skill directory is portable.

Examples:

```bash
# GitHub PR URL — normal depth (default; single-turn per perspective, diff-hunk only)
node ~/.claude/skills/trace-diff/bin/render.mjs https://github.com/octo/repo/pull/42

# owner/repo#N shorthand
node ~/.claude/skills/trace-diff/bin/render.mjs octo/repo#42

# Local branch reviewed against `main`, deeper trace (loads primary files, enables Grep)
node ~/.claude/skills/trace-diff/bin/render.mjs my-feature-branch \
  --trace-depth deep -o my-feature.html
```

`--trace-depth` picks how much source the LLM sees when building each perspective. `normal` (default) sends only the diff hunks and runs a single-turn ask with no tools — fast and cheap. `deep` preloads the primary files (full or hunk-sliced), enables Grep, and lets the flow-planning ask take multiple agent turns.

On success the binary prints the absolute path of the generated HTML on stdout. Surface that path back to the user.

## Environment (same set as the VSCode extension and the TUI)

| Variable                | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `SDT_LANGUAGE`          | Language hint appended to every LLM prompt (default `en`).                 |
| `SDT_CLAUDE_MODEL`      | `sonnet` / `opus` / `haiku` / `inherit` / full id (default: SDK default).  |
| `SDT_CLAUDE_EXECUTABLE` | Absolute path to `claude` CLI (default: PATH).                             |
| `SDT_FLOW_MAX_TURNS`    | Cap on agent turns per flow plan (default: 5). `--trace-depth normal` overrides this to 1. |
| `SDT_TRACE_DEPTH`       | `normal` (default) or `deep`; the `--trace-depth` flag overrides this.     |
| `GITHUB_TOKEN`          | GitHub credential; alternative: `GH_TOKEN` or a logged-in `gh` CLI.        |

## What the report contains

- **Header**: PR title, TL;DR, author, base ← head refs, optional reading-order note.
- **Sidebar**: one entry per perspective for jump navigation.
- **Per perspective**:
  - **Summary tab**: Outcome, Visualization, Watch-for, Tests (mermaid diagrams render when the Mermaid CDN is reachable; source stays visible when it is not).
  - **Trace tab**: block-tree outline + Step In / Step Over / Step Out / Back buttons; block-level Focus (before/after code), Variables, Mocks, Concerns; keyboard shortcuts `i` / `s` / `o` / `b` (or `F11` / `F10` / `F12`).
- **Incidental changes**: category, note, and touched files.

## What the report deliberately omits

- **Mock refine** and **Q&A pin** are not present. Both need live LLM calls after the file is written, which conflicts with the single-file goal. If the user needs those, point them at the VSCode extension.
- Full-file source panels — the report shows the block's own before/after snippet, not the whole file.

## Failure modes worth surfacing

- **Provider auth**: same errors as the extension/TUI. When you see a Claude-auth error, tell the user to log in via `claude` CLI or set `ANTHROPIC_API_KEY` / Vertex / Bedrock env.
- **`claude` CLI not on PATH**: set `SDT_CLAUDE_EXECUTABLE` to its absolute path.
- **Partial report**: a single perspective's summary or flow can fail; the pipeline logs a warning to stderr and moves on, so the report may show "Summary is unavailable" or "Trace not planned" on that section. That is expected — the stderr log carries the reason.

## Offline / airtight mode

Pass `--no-mermaid-cdn` when the user needs an air-gapped report. Mermaid source stays visible as monospace text (still legible), just unrendered.
