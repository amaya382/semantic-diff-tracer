import type { PrInput, PrRef } from '../domain/pr-ref.js';

export interface PrMeta {
  title: string;
  body: string;
  author: string;
  url?: string;
  baseRef: string;
  headRef: string;
}

export interface PrListEntry {
  number: number;
  title: string;
  author: string;
  url: string;
  headRef: string;
  baseRef: string;
  isDraft: boolean;
}

export interface PrPort {
  resolve(input: PrInput): Promise<PrRef>;
  fetchMeta(ref: PrRef): Promise<PrMeta>;
  /** Enumerate open PRs of a repo, most-recently-updated first. Used by pickPr Quick Pick. */
  listOpen(owner: string, repo: string): Promise<PrListEntry[]>;
}
