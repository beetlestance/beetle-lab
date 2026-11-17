import { describe, expect, it } from 'vitest';
import { configChanges } from './changes.js';
import { hunks, lineDiff, maximumDiffCells, sideBySide } from './diff.js';

describe('lineDiff', () => {
  it('reports additions and removals with line numbers on each side', () => {
    const diff = lineDiff('a\nb\nc', 'a\nB\nc\nd')!;
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);
    expect(diff.lines).toEqual([
      { kind: 'same', text: 'a', left: 1, right: 1 },
      { kind: 'del', text: 'b', left: 2 },
      { kind: 'add', text: 'B', right: 2 },
      { kind: 'same', text: 'c', left: 3, right: 3 },
      { kind: 'add', text: 'd', right: 4 },
    ]);
  });

  it('declines inputs whose comparison table would exceed the bound', () => {
    const side = Math.ceil(Math.sqrt(maximumDiffCells));
    const text = Array.from({ length: side }, (_, index) => String(index)).join('\n');
    expect(lineDiff(text, text)).toBeNull();
  });
});

describe('hunks and sideBySide', () => {
  it('folds long unchanged runs but keeps three lines of context around changes', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[10] = 'changed';
    const parts = hunks(lineDiff(before.join('\n'), after.join('\n'))!.lines);
    expect(parts.map((part) => [part.kind, part.lines.length])).toEqual([
      ['fold', 7],
      ['lines', 8],
      ['fold', 6],
    ]);
  });

  it('pairs removals with additions in one row and leaves the rest empty', () => {
    const rows = sideBySide(lineDiff('a\nb\nc', 'a\nx\ny\nc')!.lines);
    expect(rows.map(([left, right]) => [left?.text ?? null, right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['b', 'x'],
      [null, 'y'],
      ['c', 'c'],
    ]);
  });
});

describe('configChanges', () => {
  const base = {
    target: 'http://synthetic.invalid',
    requests: [{ id: 'home' }],
    loadPlan: {
      scenarios: [{ id: 'main', executor: 'constant-arrival-rate', rate: 1200, maxVUs: 200, duration: '5m' }],
      slos: [{ metric: 'http_req_duration' }],
    },
  };

  it('names target, rate, VU, request and threshold changes', () => {
    const after = {
      ...base,
      target: 'http://other.invalid',
      requests: [{ id: 'home' }, { id: 'search' }],
      loadPlan: { scenarios: [{ ...base.loadPlan.scenarios[0]!, rate: 1000, maxVUs: 150 }], slos: [] },
    };
    expect(configChanges(base, after)).toEqual([
      'target: http://synthetic.invalid to http://other.invalid',
      'rate: 1,200 to 1,000',
      'vus: 200 to 150',
      '1 request added',
      'Thresholds changed',
    ]);
  });

  it('is empty for identical configurations', () => {
    expect(configChanges(base, structuredClone(base))).toEqual([]);
  });
});
