export const TONES = ['affectionate', 'snarky', 'deadpan', 'dramatic', 'existential'] as const;
export type Tone = (typeof TONES)[number];

export const LENGTHS = ['1-sentence', '2-sentences', 'paragraph'] as const;
export type Length = (typeof LENGTHS)[number];

export const DEFAULT_TONE: Tone = 'snarky';
export const DEFAULT_LENGTH: Length = '1-sentence';
export const DEFAULT_CULTURE = true;

export interface RoastOptions {
  tone: Tone;
  culture: boolean;
  length: Length;
}

export interface ClimateFingerprint {
  cityName: string;
  region: string | null;
  country: string;
  peakMuggyDay: { doy: number; monthDay: string; probability: number };
  peakWetDay: { doy: number; monthDay: string; probability: number };
  hottestDay: { doy: number; monthDay: string; meanC: number };
  coldestDay: { doy: number; monthDay: string; meanC: number };
  annualMeanC: number;
  annualAmplitudeC: number;
  daysAbove35C: number;
  daysBelow0C: number;
  wetDaysPerYear: number;
  muggyHoursPerYear: number;
}

export interface Contrast {
  tempDeltaAnnualC: number;
  tempDeltaSummerC: number;
  tempDeltaWinterC: number;
  muggyDeltaPctPeak: number;
  amplitudeRatio: number;
  wetDaysDelta: number;
}

export class RoastApiKeyMissingError extends Error {
  constructor() {
    super('GEMINI_API_KEY not configured');
    this.name = 'RoastApiKeyMissingError';
  }
}
