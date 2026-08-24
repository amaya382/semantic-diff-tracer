import { Octokit } from '@octokit/rest';
import type { PrPort, PrInput, PrRef, PrMeta, PrListEntry } from '@semantic-diff-tracer/core';
import { parseGithubPrUrl, parseOwnerRepoNumber } from './parse-input.js';

export interface OctokitAdapterOptions {
  token: string;
  userAgent?: string;
  defaultOwner?: string;
  defaultRepo?: string;
}

export class OctokitPrAdapter implements PrPort {
  private readonly octokit: Octokit;

  constructor(options: OctokitAdapterOptions) {
    this.octokit = new Octokit({
      auth: options.token,
      userAgent: options.userAgent ?? 'semantic-diff-tracer/0.0.1',
    });
  }

  async resolve(input: PrInput): Promise<PrRef> {
    if (input.kind === 'url') {
      const loc = parseGithubPrUrl(input.value) ?? parseOwnerRepoNumber(input.value);
      if (!loc) throw new Error(`Unrecognized GitHub PR spec: ${input.value}`);
      return this.fetchPrRef(loc.owner, loc.repo, loc.number);
    }
    if (input.kind === 'number') {
      return this.fetchPrRef(input.owner, input.repo, input.number);
    }
    throw new Error(`OctokitPrAdapter does not resolve input kind: ${input.kind}`);
  }

  async fetchMeta(ref: PrRef): Promise<PrMeta> {
    if (ref.kind !== 'github') throw new Error('OctokitPrAdapter.fetchMeta requires a github PrRef');
    const { data } = await this.octokit.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
    });
    return {
      title: data.title,
      body: data.body ?? '',
      author: data.user?.login ?? 'unknown',
      url: data.html_url,
      baseRef: data.base.ref,
      headRef: data.head.ref,
    };
  }

  async listOpen(owner: string, repo: string): Promise<PrListEntry[]> {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
    });
    return data.map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login ?? 'unknown',
      url: p.html_url,
      headRef: p.head.ref,
      baseRef: p.base.ref,
      isDraft: p.draft === true,
    }));
  }

  private async fetchPrRef(owner: string, repo: string, number: number): Promise<PrRef> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: number,
    });
    const headOwner = data.head.user?.login ?? owner;
    const headRepo = data.head.repo?.name ?? repo;
    const headCloneUrl =
      data.head.repo?.clone_url ?? `https://github.com/${headOwner}/${headRepo}.git`;
    return {
      kind: 'github',
      owner,
      repo,
      number,
      baseSha: data.base.sha,
      headSha: data.head.sha,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      headOwner,
      headRepo,
      headCloneUrl,
    };
  }
}
