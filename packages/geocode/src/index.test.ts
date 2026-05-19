import { describe, expect, it } from 'bun:test';
import {
  type GeocodeCandidate,
  classifyCandidates,
  formatCandidate,
  geocodeCity,
  geocodeResolve,
} from './index';

function candidate(overrides: Partial<GeocodeCandidate>): GeocodeCandidate {
  return {
    source: 'open-meteo',
    canonicalName: 'Test',
    region: null,
    country: 'Testland',
    latitude: 0,
    longitude: 0,
    timezone: 'UTC',
    population: null,
    openMeteoId: 1,
    ...overrides,
  };
}

describe('formatCandidate', () => {
  it('formats with region', () => {
    expect(
      formatCandidate(
        candidate({
          canonicalName: 'Columbia',
          region: 'South Carolina',
          country: 'United States',
        }),
      ),
    ).toBe('Columbia, South Carolina, United States');
  });

  it('formats without region', () => {
    expect(formatCandidate(candidate({ canonicalName: 'Reykjavík', country: 'Iceland' }))).toBe(
      'Reykjavík, Iceland',
    );
  });
});

describe('classifyCandidates', () => {
  it('returns none for empty list', () => {
    expect(classifyCandidates([], 'foo')).toEqual({ kind: 'none', query: 'foo' });
  });

  it('returns dominant for single candidate', () => {
    const c = candidate({});
    const result = classifyCandidates([c], 'foo');
    expect(result.kind).toBe('dominant');
    if (result.kind === 'dominant') expect(result.candidate).toBe(c);
  });

  it('returns dominant when top has >=5x population AND >=100k', () => {
    const top = candidate({ canonicalName: 'A', population: 5_000_000 });
    const small = candidate({ canonicalName: 'B', population: 500_000 });
    const result = classifyCandidates([top, small], 'A');
    expect(result.kind).toBe('dominant');
  });

  it('returns ambiguous when populations are similar', () => {
    const a = candidate({ canonicalName: 'A', population: 142_416 });
    const b = candidate({ canonicalName: 'A', population: 129_330 });
    const result = classifyCandidates([a, b], 'A');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2);
  });

  it('returns ambiguous when top is below 100k even at >5x ratio', () => {
    const a = candidate({ population: 50_000 });
    const b = candidate({ population: 1_000 });
    const result = classifyCandidates([a, b], 'A');
    expect(result.kind).toBe('ambiguous');
  });
});

describe('geocodeResolve (live, hits Open-Meteo)', () => {
  it('"Buenos Aires" resolves dominantly to BA, Argentina', async () => {
    const result = await geocodeResolve('Buenos Aires');
    expect(result.kind).toBe('dominant');
    if (result.kind === 'dominant') {
      expect(result.candidate.country).toBe('Argentina');
    }
  }, 15_000);

  it('"Columbia, South Carolina" filters down to SC dominantly', async () => {
    const result = await geocodeResolve('Columbia, South Carolina');
    expect(result.kind).toBe('dominant');
    if (result.kind === 'dominant') {
      expect(result.candidate.region).toBe('South Carolina');
    }
  }, 15_000);

  it('"Columbia SC" (state abbrev) also resolves dominantly to SC', async () => {
    const result = await geocodeResolve('Columbia SC');
    expect(result.kind).toBe('dominant');
    if (result.kind === 'dominant') {
      expect(result.candidate.region).toBe('South Carolina');
    }
  }, 15_000);

  it('bare "Columbia" is ambiguous (4 US Columbias with similar populations)', async () => {
    const result = await geocodeResolve('Columbia');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
      const regions = result.candidates.map((c) => c.region);
      expect(regions).toContain('South Carolina');
      expect(regions).toContain('Missouri');
    }
  }, 15_000);

  it('"Paris, France" resolves dominantly to Paris, France', async () => {
    const result = await geocodeResolve('Paris, France');
    expect(result.kind).toBe('dominant');
    if (result.kind === 'dominant') {
      expect(result.candidate.country).toBe('France');
    }
  }, 15_000);
});

describe('geocodeCity raw (live)', () => {
  it('finds Buenos Aires', async () => {
    const candidates = await geocodeCity('Buenos Aires');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.country).toBe('Argentina');
  }, 15_000);
});
