import { describe, expect, it } from 'bun:test';
import { WB_75F_C, WB_80F_C, WB_85F_C, cToF, fToC, wetBulbC, wetBulbLabel } from './wetbulb';

describe('wetBulbC (Stull 2011)', () => {
  it('30°C / 50% RH lands in the low 20s', () => {
    // Stull 2011 published worked range — formula gives ~22.3°C.
    expect(wetBulbC(30, 50)).toBeCloseTo(22.3, 1);
  });

  it('at 100% RH wet-bulb equals air temperature', () => {
    expect(wetBulbC(25, 100)).toBeCloseTo(25, 0);
  });

  it('hot and dry: wet-bulb falls well below air temperature', () => {
    // 40°C / 10% RH: Phoenix-like; WB should be deep in the teens.
    const wb = wetBulbC(40, 10);
    expect(wb).toBeLessThan(20);
    expect(wb).toBeGreaterThan(10);
  });

  it('cold humid: wet-bulb tracks air temperature closely', () => {
    expect(wetBulbC(0, 90)).toBeLessThan(2);
    expect(wetBulbC(0, 90)).toBeGreaterThan(-2);
  });
});

describe('cToF / fToC', () => {
  it('round-trips', () => {
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBeCloseTo(212);
    expect(fToC(32)).toBe(0);
    expect(fToC(212)).toBeCloseTo(100);
  });
});

describe('wetBulbLabel', () => {
  it('returns comfortable for cool wet-bulb', () => {
    expect(wetBulbLabel(50)).toBe('comfortable');
    expect(wetBulbLabel(69.99)).toBe('comfortable');
  });

  it('upper-band semantics at boundaries (< not ≤)', () => {
    expect(wetBulbLabel(70)).toBe('humid');
    expect(wetBulbLabel(75)).toBe('muggy');
    expect(wetBulbLabel(80)).toBe('high heat stress');
    expect(wetBulbLabel(85)).toBe('dangerous');
    expect(wetBulbLabel(90)).toBe('extreme');
  });

  it('returns extreme for very high wet-bulb', () => {
    expect(wetBulbLabel(95)).toBe('extreme');
  });
});

describe('WB threshold constants', () => {
  it('match Fahrenheit conversions', () => {
    expect(cToF(WB_75F_C)).toBeCloseTo(75);
    expect(cToF(WB_80F_C)).toBeCloseTo(80);
    expect(cToF(WB_85F_C)).toBeCloseTo(85);
  });
});
