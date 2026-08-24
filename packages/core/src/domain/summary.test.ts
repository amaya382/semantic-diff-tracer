import { describe, expect, it } from 'vitest';
import { sanitizeSummaryVisuals } from './summary.js';

describe('sanitizeSummaryVisuals', () => {
  it('keeps well-formed visuals', () => {
    const kept = sanitizeSummaryVisuals([
      { kind: 'mermaid', source: 'graph TD;A-->B', caption: 'flow' },
      { kind: 'diff', source: '- old\n+ new', caption: 'change', language: 'ts' },
    ]);
    expect(kept).toEqual([
      { kind: 'mermaid', source: 'graph TD;A-->B', caption: 'flow' },
      { kind: 'diff', source: '- old\n+ new', caption: 'change', language: 'ts' },
    ]);
  });

  it('drops unknown kinds so the UI never gets a headingless card', () => {
    const kept = sanitizeSummaryVisuals([
      { kind: 'sequence', source: 'A->B: hi', caption: 'greeting' },
      { kind: 'mermaid', source: 'graph TD;A', caption: 'ok' },
    ]);
    expect(kept).toEqual([{ kind: 'mermaid', source: 'graph TD;A', caption: 'ok' }]);
  });

  it('drops visuals whose source or caption is empty', () => {
    const kept = sanitizeSummaryVisuals([
      { kind: 'mermaid', source: '', caption: 'empty source' },
      { kind: 'mermaid', source: 'graph TD;A', caption: '   ' },
      { kind: 'mermaid', source: 'graph TD;A', caption: 'kept' },
    ]);
    expect(kept).toEqual([{ kind: 'mermaid', source: 'graph TD;A', caption: 'kept' }]);
  });

  it('defaults diff/code language to null when missing or wrong-typed', () => {
    const kept = sanitizeSummaryVisuals([
      { kind: 'code', source: 'x = 1', caption: 'assign' },
      { kind: 'code', source: 'x = 1', caption: 'assign', language: 42 },
    ]);
    expect(kept).toEqual([
      { kind: 'code', source: 'x = 1', caption: 'assign', language: null },
      { kind: 'code', source: 'x = 1', caption: 'assign', language: null },
    ]);
  });

  it('returns [] for non-array input', () => {
    expect(sanitizeSummaryVisuals(undefined)).toEqual([]);
    expect(sanitizeSummaryVisuals(null)).toEqual([]);
    expect(sanitizeSummaryVisuals('mermaid')).toEqual([]);
  });
});
