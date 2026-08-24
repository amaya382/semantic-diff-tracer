export interface GithubPrLocator {
  owner: string;
  repo: string;
  number: number;
}

const URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;

export function parseGithubPrUrl(url: string): GithubPrLocator | null {
  const m = url.match(URL_RE);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]!) };
}

export function parseOwnerRepoNumber(spec: string): GithubPrLocator | null {
  const m = spec.trim().match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]!) };
}

/**
 * `#123` or `123` — accepted only when `defaultRepo` is available (typically
 * derived from `git remote get-url origin`).
 */
export function parseNumberOnly(
  input: string,
  defaultRepo?: { owner: string; repo: string },
): GithubPrLocator | null {
  const m = input.trim().match(/^#?(\d+)$/);
  if (!m || !defaultRepo) return null;
  return { owner: defaultRepo.owner, repo: defaultRepo.repo, number: Number(m[1]!) };
}

const SSH_RE = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_RE = /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i;

/** Parse `git remote get-url origin` output into owner/repo. Returns null on non-github URLs. */
export function parseRemoteUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const m1 = trimmed.match(SSH_RE);
  if (m1) return { owner: m1[1]!, repo: m1[2]! };
  const m2 = trimmed.match(HTTPS_RE);
  if (m2) return { owner: m2[1]!, repo: m2[2]! };
  return null;
}
