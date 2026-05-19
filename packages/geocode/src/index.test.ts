import { describe, expect, it } from 'bun:test';
import { formatCandidate, geocodeCity } from './index';

describe('@atmosfera/geocode', () => {
  it('formats candidate with region', () => {
    expect(
      formatCandidate({
        source: 'open-meteo',
        canonicalName: 'Columbia',
        region: 'South Carolina',
        country: 'United States',
        latitude: 0,
        longitude: 0,
        timezone: 'America/New_York',
        population: null,
      }),
    ).toBe('Columbia, South Carolina, United States');
  });

  it('formats candidate without region', () => {
    expect(
      formatCandidate({
        source: 'open-meteo',
        canonicalName: 'Reykjavík',
        region: null,
        country: 'Iceland',
        latitude: 0,
        longitude: 0,
        timezone: 'Atlantic/Reykjavik',
        population: null,
      }),
    ).toBe('Reykjavík, Iceland');
  });

  it('geocodes Buenos Aires via Open-Meteo (live)', async () => {
    const candidates = await geocodeCity('Buenos Aires');
    expect(candidates.length).toBeGreaterThan(0);
    const top = candidates[0]!;
    expect(top.country).toBe('Argentina');
    expect(top.timezone).toMatch(/Argentina/);
    expect(Math.round(top.latitude)).toBe(-35);
  }, 15_000);
});
