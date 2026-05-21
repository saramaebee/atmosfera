import { describe, expect, it } from 'bun:test';
import { fToC } from '@atmosfera/climate';
import {
  formatWetBulbDual,
  formatWetBulbWithLabel,
  monthName,
  wetBulbTakeaway,
} from './wetbulb-format';

describe('formatWetBulbDual', () => {
  it('shows both units with °C primary at 1 decimal', () => {
    expect(formatWetBulbDual(26.111)).toBe('26.1°C / 79°F');
    expect(formatWetBulbDual(0)).toBe('0.0°C / 32°F');
  });

  it('returns n/a for non-finite input', () => {
    expect(formatWetBulbDual(Number.NaN)).toBe('n/a');
    expect(formatWetBulbDual(Number.POSITIVE_INFINITY)).toBe('n/a');
  });
});

describe('formatWetBulbWithLabel', () => {
  it('appends the heat-stress label', () => {
    expect(formatWetBulbWithLabel(fToC(82))).toContain('high heat stress');
    expect(formatWetBulbWithLabel(fToC(60))).toContain('comfortable');
  });
});

describe('wetBulbTakeaway', () => {
  it('returns non-empty text for every label band', () => {
    for (const f of [50, 72, 77, 82, 87, 92]) {
      expect(wetBulbTakeaway(fToC(f)).length).toBeGreaterThan(10);
    }
  });

  it('handles missing data gracefully', () => {
    expect(wetBulbTakeaway(Number.NaN)).toMatch(/not enough/i);
  });
});

describe('monthName', () => {
  it('returns full English month names by 0-index', () => {
    expect(monthName(0)).toBe('January');
    expect(monthName(11)).toBe('December');
  });
});
