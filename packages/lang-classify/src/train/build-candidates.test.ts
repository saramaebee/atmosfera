import { describe, expect, it } from 'bun:test';
import type { ClassifyResult } from '../classify';
import {
  type Cell,
  type ClassifiedRow,
  DEFAULT_TARGETS,
  assignBand,
  parseTargets,
  stratify,
} from './build-candidates';

function fakeResult(
  partial: { confidence?: number; abstainReason?: ClassifyResult['abstainReason'] } = {},
): ClassifyResult {
  return {
    label: 'en',
    confidence: partial.confidence ?? 0.9,
    scores: [{ label: 'en', confidence: partial.confidence ?? 0.9 }],
    runnerUp: { label: 'es', confidence: 1 - (partial.confidence ?? 0.9) },
    lengthAfterClean: 100,
    abstainReason: partial.abstainReason,
  };
}

describe('assignBand', () => {
  it('returns low when abstainReason is set, regardless of confidence', () => {
    expect(assignBand(fakeResult({ confidence: 0.99, abstainReason: 'low_margin' }), 0.7)).toBe(
      'low',
    );
    expect(assignBand(fakeResult({ confidence: 0.0, abstainReason: 'too_short' }), 0.7)).toBe(
      'low',
    );
  });

  it('returns low when confidence is strictly below the threshold', () => {
    expect(assignBand(fakeResult({ confidence: 0.5 }), 0.7)).toBe('low');
    expect(assignBand(fakeResult({ confidence: 0.69 }), 0.7)).toBe('low');
  });

  it('returns high when confidence meets or exceeds the threshold', () => {
    expect(assignBand(fakeResult({ confidence: 0.7 }), 0.7)).toBe('high');
    expect(assignBand(fakeResult({ confidence: 0.99 }), 0.7)).toBe('high');
  });
});

describe('parseTargets', () => {
  it('parses a comma-separated list of cell=count entries', () => {
    expect(parseTargets('short-low=10,medium-high=5')).toEqual({
      'short-low': 10,
      'medium-high': 5,
    });
  });

  it('tolerates whitespace and an empty list', () => {
    expect(parseTargets(' short-low = 7 , long-low=3 ')).toEqual({
      'short-low': 7,
      'long-low': 3,
    });
    expect(parseTargets('')).toEqual({});
  });

  it('throws on a bad cell name', () => {
    expect(() => parseTargets('short-medium=10')).toThrow(/cell name/);
  });

  it('throws on a negative or non-numeric count', () => {
    expect(() => parseTargets('short-low=-1')).toThrow();
    expect(() => parseTargets('short-low=abc')).toThrow();
  });

  it('throws when an entry is missing =', () => {
    expect(() => parseTargets('short-low')).toThrow(/missing/);
  });
});

describe('stratify', () => {
  function makeRow(text: string, bucket: ClassifiedRow['bucket'], band: ClassifiedRow['band']): ClassifiedRow {
    return { text, bucket, band };
  }

  it('caps each cell at its target and skips empty cells without crashing', () => {
    const rows: ClassifiedRow[] = [
      ...Array.from({ length: 5 }, (_, i) => makeRow(`sl${i}`, 'short', 'low')),
      ...Array.from({ length: 2 }, (_, i) => makeRow(`mh${i}`, 'medium', 'high')),
      // no 'long-*' rows at all → those cells are empty
    ];
    const targets: Record<Cell, number> = {
      'short-low': 3,
      'short-high': 1,
      'medium-low': 0,
      'medium-high': 10,
      'long-low': 5,
      'long-high': 5,
    };
    const result = stratify(rows, targets, 1);
    expect(result.cellCounts['short-low']).toBe(3); // capped at target
    expect(result.cellCounts['short-high']).toBe(0); // no rows available
    expect(result.cellCounts['medium-low']).toBe(0); // target=0
    expect(result.cellCounts['medium-high']).toBe(2); // capped by pool size
    expect(result.cellCounts['long-low']).toBe(0);
    expect(result.cellCounts['long-high']).toBe(0);

    const underfilledCells = result.underfilled.map((u) => u.cell).sort();
    expect(underfilledCells).toEqual(['long-high', 'long-low', 'medium-high', 'short-high']);
  });

  it('is deterministic given the same input and seed', () => {
    const rows: ClassifiedRow[] = Array.from({ length: 20 }, (_, i) =>
      makeRow(`row${i}`, 'short', 'low'),
    );
    const targets: Record<Cell, number> = { ...DEFAULT_TARGETS, 'short-low': 5 };
    const a = stratify(rows, targets, 42);
    const b = stratify(rows, targets, 42);
    expect(a.selected.map((s) => s.text)).toEqual(b.selected.map((s) => s.text));
  });

  it('produces a different order under a different seed', () => {
    const rows: ClassifiedRow[] = Array.from({ length: 20 }, (_, i) =>
      makeRow(`row${i}`, 'short', 'low'),
    );
    const targets: Record<Cell, number> = { ...DEFAULT_TARGETS, 'short-low': 5 };
    const a = stratify(rows, targets, 1).selected.map((s) => s.text);
    const b = stratify(rows, targets, 999).selected.map((s) => s.text);
    expect(a).not.toEqual(b);
  });

  it('only emits the text field on selected rows (no leaked bucket/band)', () => {
    const rows: ClassifiedRow[] = [makeRow('hi', 'short', 'low')];
    const targets: Record<Cell, number> = { ...DEFAULT_TARGETS, 'short-low': 1 };
    const result = stratify(rows, targets, 1);
    expect(result.selected[0]).toEqual({ text: 'hi', cell: 'short-low' });
    expect(result.selected[0]).not.toHaveProperty('band');
    expect(result.selected[0]).not.toHaveProperty('bucket');
  });
});
