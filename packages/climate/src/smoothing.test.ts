import { describe, expect, it } from 'bun:test';
import { circularSmooth1d, gaussianKernel1d, gaussianSmooth1d } from './smoothing';

describe('gaussianKernel1d', () => {
  it('produces weights summing to 1', () => {
    const k = gaussianKernel1d(3);
    const sum = k.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('is symmetric around the center', () => {
    const k = gaussianKernel1d(2.5);
    const mid = (k.length - 1) / 2;
    for (let i = 0; i < mid; i++) {
      expect(k[mid - i]).toBeCloseTo(k[mid + i]!, 10);
    }
  });

  it('rejects non-positive sigma', () => {
    expect(() => gaussianKernel1d(0)).toThrow();
    expect(() => gaussianKernel1d(-1)).toThrow();
  });
});

describe('circularSmooth1d', () => {
  it('preserves constant signals', () => {
    const values = new Array(20).fill(7);
    const k = gaussianKernel1d(2);
    const out = circularSmooth1d(values, k);
    for (const v of out) expect(v).toBeCloseTo(7, 6);
  });

  it('wraps at boundaries (a single spike contributes to the opposite end)', () => {
    const values = new Array(20).fill(0);
    values[0] = 1;
    const k = gaussianKernel1d(2);
    const out = gaussianSmooth1d(values, 2);
    // The end of the array should pick up some weight from the wrap-around
    expect(out[19]).toBeGreaterThan(0);
    expect(out[18]).toBeGreaterThan(0);
  });

  it('handles NaN gracefully by reweighting', () => {
    const values = [1, 1, Number.NaN, 1, 1];
    const k = [0.25, 0.5, 0.25];
    const out = circularSmooth1d(values, k);
    for (const v of out) expect(v).toBeCloseTo(1, 6);
  });
});
