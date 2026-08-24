import type { PrRef } from '@semantic-diff-tracer/core';
import { mergeBase, revParse } from './git.js';

export interface ResolveLocalArgs {
  cwd: string;
  base: string;
  head?: string;
}

export async function resolveLocalRef(args: ResolveLocalArgs): Promise<PrRef> {
  const headRef = args.head ?? 'HEAD';
  const headSha = await revParse(headRef, args.cwd);
  const baseSha = await mergeBase(args.base, headRef, args.cwd);
  return {
    kind: 'local',
    baseSha,
    headSha,
    baseRef: args.base,
    headRef,
  };
}
