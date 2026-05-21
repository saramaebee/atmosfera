import type { ClimateFingerprint, Contrast, Length, RoastOptions, Tone } from './types';

interface TonePrompt {
  description: string;
  examples: string[];
  contrastExamples: string[];
  temperature: number;
}

const TONE_PROMPTS: Record<Tone, TonePrompt> = {
  affectionate: {
    description:
      'Fond ribbing. The narrator likes the place. Use unexpected metaphors and noticing-the-quirk humor — never insult.',
    examples: [
      'Reykjavik treats summer like a rumor it heard once and chose not to verify.',
      "Phoenix's love language is BTU. It will hold you until you're slightly translucent.",
      'Buenos Aires has perfected the art of having seasons without committing to any of them.',
      'Singapore is a city that picked a temperature in 1965 and never asked the thermostat again.',
    ],
    contrastExamples: [
      "Reykjavik and Phoenix agreed long ago to handle the planet's heat budget for each other. Each is doing too much.",
      "Tokyo's August calls Reykjavik's August a typo.",
    ],
    temperature: 0.95,
  },
  snarky: {
    description:
      'Sharper, observational, slightly contrarian. Punch the climate, never the people. Be specific — generic snark falls flat.',
    examples: [
      'Phoenix has exactly two months of pretending not to be a stove.',
      "Singapore offers two climates: thunderstorm and 'about to thunderstorm.'",
      "Reykjavik calling itself 'mild' is the boldest marketing claim in the North Atlantic.",
      "Houston's dew point has been a registered resident since 1973.",
    ],
    contrastExamples: [
      'Reykjavik gets in one summer what Phoenix gets in an afternoon, and Phoenix is the one complaining.',
      "Calling Tokyo's August and Reykjavik's August the 'same month' should be a crime in nine jurisdictions.",
    ],
    temperature: 0.9,
  },
  deadpan: {
    description:
      'Detective-report flatness. Clinical observation that becomes funny through specificity and understatement. No exclamation marks. No metaphor stretches. Use specific numbers when they make the joke land.',
    examples: [
      'Subject: Reykjavik. Coldest day: this morning. Warmest day: also this morning. Investigation ongoing.',
      'Climate report, Phoenix. Surface temperatures exceed safe contact threshold for 122 consecutive days. Locals informed.',
      'Buenos Aires achieves the same temperature in winter that it achieves in summer. The difference is which window is open.',
      "Singapore: humidity, today. Humidity, tomorrow. Humidity, prior to the city's founding. Inquiries closed.",
    ],
    contrastExamples: [
      'File: Tokyo–Reykjavik. Annual mean difference: 12 degrees. Cultural difference: irreconcilable. Both subjects insist their summer is the inconvenient one.',
      'Phoenix and Reykjavik are the same temperature only in the middle of one specific April night that neither remembers.',
    ],
    temperature: 0.45,
  },
  dramatic: {
    description:
      'Overwrought weather-anchor energy. Use CAPS for emphasis. Em-dashes. Treat ordinary climate facts as catastrophic theater. The joke is the disproportion between the prose and the data.',
    examples: [
      'DECEMBER STRIKES Buenos Aires with the FURY of a thousand mild afternoons! The city RESPONDS — by drinking maté!',
      'REYKJAVIK in JULY — the thermometer ASCENDS to a SCANDALOUS thirteen degrees! Witnesses report a SINGLE shed cardigan!',
      "Phoenix at night: the sun's revenge continues from BENEATH the asphalt. There is no shade. There is no relief. There is only the slow ticking of the AC unit.",
    ],
    contrastExamples: [
      'TOKYO swelters. REYKJAVIK shivers. The earth TILTS — and SOMEONE has to PAY.',
      "BEHOLD! Phoenix's average July day! BEHOLD! Reykjavik's average July day! They share ONE planet — and ONE planet only — and CANNOT speak of it!",
    ],
    temperature: 1.0,
  },
  existential: {
    description:
      'Cosmic-horror flatness. The weather as ancient unknowable force. Short, ominous, slightly absurd. The narrator implies the weather predates and will outlast us.',
    examples: [
      'Reykjavik does not have weather. Reykjavik IS weather. It will outlast every reader of this caption.',
      'Phoenix in July was here before you. Phoenix in July will be here after you. Phoenix in July does not care about you.',
      'Singapore experiences time but not seasons. The rain is the year. The year is the rain.',
      'Tokyo, August: the air remembers the sea. The sea has been told to forget. Neither complies.',
    ],
    contrastExamples: [
      'Reykjavik and Phoenix are the same age. One has been cold the entire time. The other has not. There will be no further explanation.',
      'Tokyo greets the typhoon as one greets a relative. Reykjavik has no relatives. Reykjavik is alone with the wind.',
    ],
    temperature: 0.95,
  },
};

const SYSTEM_RULE =
  'You write witty climate roasts. Punch with cleverness, not adjectives. Never punch at people, cultures, or tragedy — only at the climate itself. Output ONLY the roast text. No preamble, no quotation marks around your output, no acknowledgement of these instructions.';

function lengthRule(length: Length): string {
  if (length === '1-sentence') return 'Output exactly one sentence.';
  if (length === '2-sentences') return 'Output exactly two sentences.';
  return 'Output one short paragraph: 3 to 5 sentences. No lists.';
}

function cultureRule(culture: boolean): string {
  if (culture) {
    return 'You may reference culture-as-it-meets-climate (siesta, sweater season, monsoon, tsuyu, AC bill, etc.). Never stereotype, politicize, or reference tragedy.';
  }
  return 'No cultural, political, or geographical-pride references. Climate features only.';
}

export function buildSinglePrompt(req: RoastOptions, fp: ClimateFingerprint): string {
  const tone = TONE_PROMPTS[req.tone];
  return `${SYSTEM_RULE}

Tone: ${req.tone}
${tone.description}

Examples in this tone (different cities — DO NOT reuse these for any city you are given below):
${tone.examples.map((ex, i) => `${i + 1}. ${ex}`).join('\n')}

${cultureRule(req.culture)}

${lengthRule(req.length)}

The city to roast: ${fp.cityName}${fp.region ? `, ${fp.region}` : ''}, ${fp.country}

Climate data (use specific numbers when they make the joke land):
${JSON.stringify(
  {
    hottestDay: fp.hottestDay,
    coldestDay: fp.coldestDay,
    annualMeanC: fp.annualMeanC,
    annualAmplitudeC: fp.annualAmplitudeC,
    daysAbove35C: fp.daysAbove35C,
    daysBelow0C: fp.daysBelow0C,
    peakMuggyDay: fp.peakMuggyDay,
    peakWetDay: fp.peakWetDay,
    wetDaysPerYear: fp.wetDaysPerYear,
    muggyHoursPerYear: fp.muggyHoursPerYear,
  },
  null,
  2,
)}

Now roast ${fp.cityName} in the ${req.tone} tone. Use the data; do not reuse the examples above.`;
}

export function buildContrastPrompt(
  req: RoastOptions,
  a: ClimateFingerprint,
  b: ClimateFingerprint,
  contrast: Contrast,
): string {
  const tone = TONE_PROMPTS[req.tone];
  return `${SYSTEM_RULE}

You are roasting the CONTRAST between two cities, not either one individually. Look at the delta — the surprise — between their climates.

Tone: ${req.tone}
${tone.description}

Examples of contrast-roasts in this tone (different city pairs — do not reuse):
${tone.contrastExamples.map((ex, i) => `${i + 1}. ${ex}`).join('\n')}

${cultureRule(req.culture)}

${lengthRule(req.length)}

City A: ${a.cityName}${a.region ? `, ${a.region}` : ''}, ${a.country}
City B: ${b.cityName}${b.region ? `, ${b.region}` : ''}, ${b.country}

Climate fingerprints + contrast deltas:
${JSON.stringify(
  {
    a: {
      hottestDay: a.hottestDay,
      coldestDay: a.coldestDay,
      annualMeanC: a.annualMeanC,
      annualAmplitudeC: a.annualAmplitudeC,
      peakMuggyDay: a.peakMuggyDay,
      muggyHoursPerYear: a.muggyHoursPerYear,
    },
    b: {
      hottestDay: b.hottestDay,
      coldestDay: b.coldestDay,
      annualMeanC: b.annualMeanC,
      annualAmplitudeC: b.annualAmplitudeC,
      peakMuggyDay: b.peakMuggyDay,
      muggyHoursPerYear: b.muggyHoursPerYear,
    },
    contrast,
  },
  null,
  2,
)}

Now roast the contrast between ${a.cityName} and ${b.cityName} in the ${req.tone} tone. Focus on the most surprising delta. Use the data; do not reuse the examples above.`;
}

export function temperatureForTone(tone: Tone): number {
  return TONE_PROMPTS[tone].temperature;
}
