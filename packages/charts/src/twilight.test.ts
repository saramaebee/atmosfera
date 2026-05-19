import { describe, expect, it } from 'bun:test';
import { computeTwilightYear, darkHours } from './twilight';

describe('computeTwilightYear', () => {
  it('produces 365 days', () => {
    const tw = computeTwilightYear(0, 0, 'UTC');
    expect(tw).toHaveLength(365);
  });

  it('equator: ~12 hours of dark year-round', () => {
    const tw = computeTwilightYear(0, 0, 'UTC');
    const equinox = tw[78]!; // ~ Mar 20
    expect(darkHours(equinox)).toBeGreaterThan(11);
    expect(darkHours(equinox)).toBeLessThan(13);
    expect(equinox.alwaysDay).toBe(false);
    expect(equinox.alwaysNight).toBe(false);
  });

  it('reykjavik: very short dark in June, long dark in December', () => {
    const tw = computeTwilightYear(64.1355, -21.8954, 'Atlantic/Reykjavik');
    const june21 = tw[171]!;
    const dec21 = tw[354]!;
    expect(darkHours(june21)).toBeLessThan(4);
    expect(darkHours(dec21)).toBeGreaterThan(18);
    // Reykjavik never has 24h darkness (only 66.5°N+ does)
    expect(dec21.alwaysNight).toBe(false);
  });

  it('buenos aires: inverse pattern (winter dark long, summer dark short)', () => {
    const tw = computeTwilightYear(-34.6131, -58.3772, 'America/Argentina/Buenos_Aires');
    const jan15 = tw[14]!;
    const jun21 = tw[171]!;
    expect(darkHours(jan15)).toBeLessThan(12); // BA summer
    expect(darkHours(jun21)).toBeGreaterThan(12); // BA winter
  });

  it('high arctic (78°N): polar day in June, polar night in December', () => {
    const tw = computeTwilightYear(78, 15, 'UTC');
    const june21 = tw[171]!;
    const dec21 = tw[354]!;
    expect(june21.alwaysDay).toBe(true);
    expect(june21.nightSegments).toHaveLength(0);
    expect(dec21.alwaysNight).toBe(true);
  });
});
