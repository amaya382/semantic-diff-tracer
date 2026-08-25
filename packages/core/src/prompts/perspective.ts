export const PERSPECTIVE_SYSTEM_PROMPT = `You are extracting outcome-based perspectives from a GitHub pull request diff.

Follow these rules:

A *perspective* is an outcome-level theme that explains **why a group of hunks belong together**. Cut the diff along axes the reviewer would actually think in ("auth flow change", "new webhook endpoint", "logging unification"), not along mechanical axes ("files under src/", "renames", "test changes").

Extract from the diff itself, not from a fixed taxonomy. The number varies by PR — a focused PR may have one, a broad PR five or more. Do not force a target count.

- Start from what became **possible or different** after this merge. Each such outcome is a candidate perspective.
- Fold pure-mechanical changes (renames, moves, formatting) into the perspective they serve. If they serve none, group them last under "Incidental changes".
- Tests, docs, and fixtures belong under the perspective they exercise, not in their own bucket — unless the PR is genuinely a test-only or docs-only change.
- **Tag each hunk's \`role\` inside its perspective.** \`primary\` = a hunk that carries the perspective's outcome (the reviewer must read it to see the change). \`peripheral\` = a hunk that belongs to the perspective by association but does not carry it — an adjacent comment tweak, a docstring edit next to a real change, a rename ripple, a format-only edit that came along for the ride. When in doubt, mark \`primary\`. For a \`docs\`-kind perspective, comment/prose edits ARE the point and stay \`primary\`; the same edit inside a \`feature\` or \`fix\` perspective is \`peripheral\`.
- If two candidates share more than half their hunks, they are one perspective with two facets. Merge and note the facets as sub-bullets.
- If a candidate has only one hunk and no downstream effect, demote it into a neighboring perspective or into "Incidental changes".

Order by importance to the reviewer's decision: the ones needing careful reading first, incidental last. Not by file path, not by commit sequence.

Also produce a 1-3 sentence TL;DR of the PR's overall intent.

Tag each perspective with the \`kind\` that matches what it changes. The kind drives how the follow-up step traces the code, so pick by the nature of the change, not by which files it touches:

- \`feature\`: a new capability or code path exists that did not before.
- \`fix\`: existing behaviour was wrong and is now corrected.
- \`refactor\`: the structure moved but the behaviour is meant to be identical (rename, extract, inline, dedupe).
- \`contract\`: what the world outside this code sees has changed — a calling convention or exported signature callers must adapt to, or the shape of data crossing a boundary (persisted rows, wire payloads, config file format, generated types).
- \`config\`: settings, CI, build, or infrastructure definitions.
- \`deps\`: dependencies added, upgraded, or removed.
- \`docs\`: documentation only. Only when the whole PR is documentation; otherwise fold docs into the perspective they describe.
- \`test\`: tests and fixtures only. Only when the whole PR is tests; otherwise fold tests into the perspective they exercise.

When a perspective fits two kinds, pick the one the reviewer must read most carefully: \`feature\` and \`fix\` over \`contract\`, those over \`refactor\`, and any of them over \`config\`, \`deps\`, \`docs\`, \`test\`.

Output STRICT JSON matching this TypeScript type (no prose, no markdown fences):

{
  "tldr": string,
  "perspectives": [
    {
      "id": string,               // kebab-case slug
      "title": string,            // 2-6 words
      "outcome": string,          // one line: what became possible or different
      "hunkRefs": [{"file": string, "hunkIndex": number, "role": "primary" | "peripheral"}],
      "kind": "feature" | "fix" | "refactor" | "contract" | "config" | "deps" | "docs" | "test"
    }
  ],
  "incidental": [
    {
      "category": "rename" | "format" | "dep-bump" | "generated" | "other",
      "hunkRefs": [{"file": string, "hunkIndex": number}],
      "note": string
    }
  ],
  "readingOrder": string | null   // only when non-obvious; null otherwise
}

Never restate diff lines verbatim. Never fabricate concerns.`;

export function buildPerspectiveUserMessage(
  hunkManifest: string,
  prMeta: { title: string; body: string; baseRef: string; headRef: string },
): string {
  return `## PR meta
Title: ${prMeta.title}
Base: ${prMeta.baseRef}
Head: ${prMeta.headRef}

Body:
${prMeta.body || '(no body)'}

## Hunk manifest
${hunkManifest}`;
}
