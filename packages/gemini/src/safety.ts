import {
  HarmBlockThreshold,
  HarmCategory,
  HarmProbability,
  type SafetyRating,
  type SafetySetting,
} from '@google/genai';

/**
 * Disable Gemini's server-side safety filter entirely. Apply local policy via
 * evaluateSafetyRatings() instead — we want the ratings as telemetry but make
 * the allow/block decision ourselves.
 */
export const SAFETY_OFF: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const PROBABILITY_RANK: Record<string, number> = {
  [HarmProbability.HARM_PROBABILITY_UNSPECIFIED]: 0,
  [HarmProbability.NEGLIGIBLE]: 1,
  [HarmProbability.LOW]: 2,
  [HarmProbability.MEDIUM]: 3,
  [HarmProbability.HIGH]: 4,
};

export type SafetyPolicy = Partial<Record<HarmCategory, HarmProbability>>;

export class BlockedBySafetyError extends Error {
  constructor(
    public readonly category: HarmCategory,
    public readonly probability: HarmProbability,
    public readonly source: 'gemini' | 'local',
  ) {
    super(
      `Blocked: content flagged as ${friendlyCategoryName(category)} at ${probability} probability (source=${source}).`,
    );
    this.name = 'BlockedBySafetyError';
  }
}

export function friendlyCategoryName(category: HarmCategory): string {
  switch (category) {
    case HarmCategory.HARM_CATEGORY_HARASSMENT:
      return 'harassment';
    case HarmCategory.HARM_CATEGORY_HATE_SPEECH:
      return 'hate speech';
    case HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT:
      return 'sexually explicit';
    case HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT:
      return 'dangerous content';
    default:
      return category;
  }
}

export function evaluateSafetyRatings(
  ratings: SafetyRating[] | undefined,
  policy: SafetyPolicy,
): void {
  if (!ratings) return;
  for (const rating of ratings) {
    const category = rating.category;
    const probability = rating.probability;
    if (!category || !probability) continue;
    const threshold = policy[category];
    if (!threshold) continue;
    const ratingRank = PROBABILITY_RANK[probability] ?? 0;
    const thresholdRank = PROBABILITY_RANK[threshold] ?? 0;
    if (ratingRank >= thresholdRank) {
      throw new BlockedBySafetyError(category, probability, 'local');
    }
  }
}

export function probabilityRank(p: HarmProbability | string | undefined): number {
  if (!p) return 0;
  return PROBABILITY_RANK[p] ?? 0;
}
