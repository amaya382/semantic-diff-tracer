import type {
  PrInput,
  PrListEntry,
  PrListOptions,
  PrMeta,
  PrPort,
  PrRef,
} from '@semantic-diff-tracer/core';

export interface StubPrOptions {
  ref: PrRef;
  meta: PrMeta;
  list?: PrListEntry[];
}

export class StubPrPort implements PrPort {
  constructor(private readonly options: StubPrOptions) {}

  async resolve(_input: PrInput): Promise<PrRef> {
    return this.options.ref;
  }

  async fetchMeta(_ref: PrRef): Promise<PrMeta> {
    return this.options.meta;
  }

  async list(_owner: string, _repo: string, options?: PrListOptions): Promise<PrListEntry[]> {
    const all = this.options.list ?? [];
    if ((options?.state ?? 'open') === 'open') {
      return all.filter((p) => p.state === 'open');
    }
    return all;
  }
}
