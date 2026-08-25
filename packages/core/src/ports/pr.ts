import type { PrInput, PrRef } from '../domain/pr-ref.js';

export interface PrMeta {
  title: string;
  body: string;
  author: string;
  url?: string;
  baseRef: string;
  headRef: string;
}

export type PrListEntryState = 'open' | 'closed' | 'merged';

export interface PrListEntry {
  number: number;
  title: string;
  author: string;
  url: string;
  headRef: string;
  baseRef: string;
  isDraft: boolean;
  state: PrListEntryState;
}

export interface PrListOptions {
  /** 'open' returns open PRs only; 'all' includes closed and merged. Defaults to 'open'. */
  state?: 'open' | 'all';
}

export interface PrPort {
  resolve(input: PrInput): Promise<PrRef>;
  fetchMeta(ref: PrRef): Promise<PrMeta>;
  /** Enumerate PRs of a repo, most-recently-updated first. Used by pickPr Quick Pick. */
  list(owner: string, repo: string, options?: PrListOptions): Promise<PrListEntry[]>;
}
