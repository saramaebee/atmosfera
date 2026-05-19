import { describe, expect, it } from 'bun:test';
import { matchesQualifier, parseQuery } from './qualifiers';

describe('parseQuery', () => {
  it('parses bare names with no qualifier', () => {
    expect(parseQuery('Buenos Aires')).toEqual({ name: 'Buenos Aires', qualifier: null });
    expect(parseQuery('Reykjavik')).toEqual({ name: 'Reykjavik', qualifier: null });
    expect(parseQuery('  Columbia  ')).toEqual({ name: 'Columbia', qualifier: null });
  });

  it('parses comma-qualified queries', () => {
    expect(parseQuery('Columbia, South Carolina')).toEqual({
      name: 'Columbia',
      qualifier: 'South Carolina',
    });
    expect(parseQuery('Paris, France')).toEqual({ name: 'Paris', qualifier: 'France' });
    expect(parseQuery('Aragua, Venezuela')).toEqual({ name: 'Aragua', qualifier: 'Venezuela' });
  });

  it('parses US state abbreviations after a space', () => {
    expect(parseQuery('Columbia SC')).toEqual({ name: 'Columbia', qualifier: 'sc' });
    expect(parseQuery('Portland OR')).toEqual({ name: 'Portland', qualifier: 'or' });
  });

  it('does not mis-parse multi-word names as qualifier+name', () => {
    expect(parseQuery('Los Angeles')).toEqual({ name: 'Los Angeles', qualifier: null });
    expect(parseQuery('San Francisco')).toEqual({ name: 'San Francisco', qualifier: null });
  });
});

describe('matchesQualifier', () => {
  it('matches full country names', () => {
    expect(matchesQualifier({ country: 'France', region: 'Île-de-France' }, 'France')).toBe(true);
    expect(matchesQualifier({ country: 'Venezuela', region: 'Anzoátegui' }, 'venezuela')).toBe(
      true,
    );
  });

  it('matches full region names', () => {
    expect(
      matchesQualifier({ country: 'United States', region: 'South Carolina' }, 'South Carolina'),
    ).toBe(true);
  });

  it('matches US state abbreviations against full state names in admin1', () => {
    expect(matchesQualifier({ country: 'United States', region: 'South Carolina' }, 'sc')).toBe(
      true,
    );
    expect(matchesQualifier({ country: 'United States', region: 'Missouri' }, 'sc')).toBe(false);
  });

  it('does not cross-match unrelated regions', () => {
    expect(
      matchesQualifier({ country: 'United States', region: 'Missouri' }, 'South Carolina'),
    ).toBe(false);
  });
});
