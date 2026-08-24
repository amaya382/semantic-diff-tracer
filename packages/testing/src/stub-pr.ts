import type { PrInput, PrListEntry, PrMeta, PrPort, PrRef } from '@semantic-diff-tracer/core';

export interface StubPrOptions {
  ref: PrRef;
  meta: PrMeta;
  openList?: PrListEntry[];
}

export class StubPrPort implements PrPort {
  constructor(private readonly options: StubPrOptions) {}

  async resolve(_input: PrInput): Promise<PrRef> {
    return this.options.ref;
  }

  async fetchMeta(_ref: PrRef): Promise<PrMeta> {
    return this.options.meta;
  }

  async listOpen(_owner: string, _repo: string): Promise<PrListEntry[]> {
    return this.options.openList ?? [];
  }
}
