import { describe, expect, it } from 'bun:test';
import { DARK_THEME, LIGHT_THEME, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('defaults to dark', () => {
    expect(resolveTheme()).toBe(DARK_THEME);
    expect(resolveTheme(undefined)).toBe(DARK_THEME);
    expect(resolveTheme(null)).toBe(DARK_THEME);
    expect(resolveTheme('dark')).toBe(DARK_THEME);
  });

  it('returns light only when asked explicitly', () => {
    expect(resolveTheme('light')).toBe(LIGHT_THEME);
  });

  it('keeps theme name and basemap style consistent', () => {
    expect(LIGHT_THEME.name).toBe('light');
    expect(LIGHT_THEME.radar.basemapStyle).toBe('light');
    expect(LIGHT_THEME.radar.labelsStyle).toBeNull();
    expect(DARK_THEME.name).toBe('dark');
    expect(DARK_THEME.radar.basemapStyle).toBe('dark');
    expect(DARK_THEME.radar.labelsStyle).toBe('dark-labels');
    expect(DARK_THEME.radar.labelsBoost).toBeGreaterThan(1);
  });
});
