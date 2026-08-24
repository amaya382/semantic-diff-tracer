export type PrInput =
  | { kind: 'url'; value: string }
  | { kind: 'number'; owner: string; repo: string; number: number }
  | { kind: 'branch'; branch: string; base?: string }
  | { kind: 'local'; base: string; head?: string };

export type PrRef =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      number: number;
      baseSha: string;
      headSha: string;
      baseRef: string;
      headRef: string;
      headOwner: string;
      headRepo: string;
      headCloneUrl: string;
    }
  | {
      kind: 'local';
      baseSha: string;
      headSha: string;
      baseRef: string;
      headRef: string;
    };

export function prRefKey(ref: PrRef): string {
  if (ref.kind === 'github') {
    return `github:${ref.owner}/${ref.repo}#${ref.number}@${ref.headSha}`;
  }
  return `local:${ref.baseRef}..${ref.headRef}@${ref.headSha}`;
}
