import { describe, expect, it } from 'bun:test';
import { NA_COLOR, TEMPERATURE_BANDS, bandForCelsius, colorForCelsius } from './palette';

describe('TEMPERATURE_BANDS', () => {
  it('covers -100 to 100 contiguously', () => {
    for (let i = 0; i < TEMPERATURE_BANDS.length - 1; i++) {
      expect(TEMPERATURE_BANDS[i]!.maxC).toBe(TEMPERATURE_BANDS[i + 1]!.minC);
    }
    expect(TEMPERATURE_BANDS[0]!.minC).toBe(-100);
    expect(TEMPERATURE_BANDS[TEMPERATURE_BANDS.length - 1]!.maxC).toBe(100);
  });
});

describe('colorForCelsius', () => {
  it('returns NA_COLOR for NaN and Infinity', () => {
    expect(colorForCelsius(Number.NaN)).toBe(NA_COLOR);
    expect(colorForCelsius(Number.POSITIVE_INFINITY)).toBe(NA_COLOR);
  });

  it('picks the correct band at boundaries', () => {
    expect(bandForCelsius(-50)?.name).toBe('frigid');
    expect(bandForCelsius(-9)?.name).toBe('freezing'); // -9 inclusive in freezing
    expect(bandForCelsius(0)?.name).toBe('very cold');
    expect(bandForCelsius(20)?.name).toBe('comfortable');
    expect(bandForCelsius(35)?.name).toBe('sweltering');
    expect(bandForCelsius(50)?.name).toBe('sweltering');
  });
});
