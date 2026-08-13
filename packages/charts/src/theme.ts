/**
 * Color tokens for the generated graphics. Two themes, dark is the default
 * everywhere (`resolveTheme` and every renderer's default parameter agree on
 * this). Dark values are aligned with the admin web app's palette
 * (apps/web/src/views/styles.ts) so the whole project reads as one system.
 *
 * Deliberately theme-invariant (not tokens here): TEMPERATURE_BANDS and
 * CITY_COLORS (saturated mid-tones that read on both backgrounds), the
 * heatmap night overlay and month gridlines (they act on band colors, not the
 * page), and the radar city marker.
 */

import type { BasemapStyle } from '@atmosfera/climate';

export type ThemeName = 'light' | 'dark';

export interface RadarTheme {
  /** Frame background behind the tiles (visible in polar blanks and seams). */
  backdrop: string;
  /** CARTO basemap style for the base layer. */
  basemapStyle: BasemapStyle;
  /**
   * Optional transparent labels layer composited above the rain overlay with
   * a brightness boost — dark_nolabels + boosted dark_only_labels, because
   * dark_all's baked-in labels are too dim to read.
   */
  labelsStyle: BasemapStyle | null;
  /** Brightness multiplier for the labels layer (1 = as served). */
  labelsBoost: number;
  pillFill: string;
  pillOpacity: number;
  barFill: string;
  barOpacity: number;
  text: string;
  muted: string;
}

export interface ChartTheme {
  name: ThemeName;
  bg: string;
  text: string;
  muted: string;
  tick: string;
  gridline: string;
  gridlineFaint: string;
  border: string;
  panelBorder: string;
  divider: string;
  naColor: string;
  /** Halo separating the muggy peak dot from its line — always the page color. */
  peakHalo: string;
  /**
   * Precipitation-probability text on the now card. Related to but distinct
   * from the theme-invariant RAIN_COLOR icon stroke in weather-icons.ts —
   * fine text needs more contrast per background than a glyph stroke does.
   */
  precip: string;
  radar: RadarTheme;
}

export const LIGHT_THEME: ChartTheme = {
  name: 'light',
  bg: '#ffffff',
  text: '#111827',
  muted: '#6b7280',
  tick: '#9ca3af',
  gridline: '#eef2f7',
  gridlineFaint: '#f3f4f6',
  border: '#cbd5e1',
  panelBorder: '#94a3b8',
  divider: '#eef2f7',
  naColor: '#e5e7eb',
  peakHalo: '#ffffff',
  precip: '#2563eb',
  radar: {
    backdrop: '#e8e8e6',
    basemapStyle: 'light',
    labelsStyle: null,
    labelsBoost: 1,
    pillFill: '#ffffff',
    pillOpacity: 0.85,
    barFill: '#ffffff',
    barOpacity: 0.8,
    text: '#111827',
    muted: '#4b5563',
  },
};

// Neutral grays anchored on Discord's Dark-theme chat background (#1a1a1e,
// sampled), so attachments blend into the chat instead of reading as a card.
// Discord's Ash/Onyx variants are neutral too, so the edge stays subtle there;
// only an exact match for one theme is possible with an opaque PNG.
export const DARK_THEME: ChartTheme = {
  name: 'dark',
  bg: '#1a1a1e',
  text: '#e8e9eb',
  muted: '#9a9ba2',
  tick: '#606169',
  gridline: '#28282d',
  gridlineFaint: '#232327',
  border: '#3f4046',
  panelBorder: '#54555e',
  divider: '#28282d',
  naColor: '#37383f',
  peakHalo: '#1a1a1e',
  precip: '#60a5fa',
  radar: {
    // Matches the dark_nolabels tile tone (not the Discord bg): it only shows
    // in polar blank slots and sub-pixel seams between tiles.
    backdrop: '#141417',
    basemapStyle: 'dark',
    labelsStyle: 'dark-labels',
    labelsBoost: 1.6,
    pillFill: '#202024',
    pillOpacity: 0.88,
    barFill: '#1a1a1e',
    barOpacity: 0.85,
    // Attribution credit must stay clearly legible (CARTO license), so this
    // is brighter than the chart muted tone.
    text: '#e8e9eb',
    muted: '#a4a5ac',
  },
};

export function resolveTheme(name?: ThemeName | null): ChartTheme {
  return name === 'light' ? LIGHT_THEME : DARK_THEME;
}
