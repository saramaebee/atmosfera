/**
 * Parse human queries like "Columbia, South Carolina" or "Columbia SC" into
 * a primary name (to send to Open-Meteo's `name=` param, which is single-token)
 * plus a qualifier we can use to filter candidates on this side.
 */

export interface ParsedQuery {
  name: string;
  qualifier: string | null;
}

// US state abbreviations → full name, for matching admin1 fields returned by Open-Meteo.
// Lowercase keys, lowercase values for case-insensitive comparison.
const US_STATE_ABBR: ReadonlyMap<string, string> = new Map([
  ['al', 'alabama'],
  ['ak', 'alaska'],
  ['az', 'arizona'],
  ['ar', 'arkansas'],
  ['ca', 'california'],
  ['co', 'colorado'],
  ['ct', 'connecticut'],
  ['de', 'delaware'],
  ['fl', 'florida'],
  ['ga', 'georgia'],
  ['hi', 'hawaii'],
  ['id', 'idaho'],
  ['il', 'illinois'],
  ['in', 'indiana'],
  ['ia', 'iowa'],
  ['ks', 'kansas'],
  ['ky', 'kentucky'],
  ['la', 'louisiana'],
  ['me', 'maine'],
  ['md', 'maryland'],
  ['ma', 'massachusetts'],
  ['mi', 'michigan'],
  ['mn', 'minnesota'],
  ['ms', 'mississippi'],
  ['mo', 'missouri'],
  ['mt', 'montana'],
  ['ne', 'nebraska'],
  ['nv', 'nevada'],
  ['nh', 'new hampshire'],
  ['nj', 'new jersey'],
  ['nm', 'new mexico'],
  ['ny', 'new york'],
  ['nc', 'north carolina'],
  ['nd', 'north dakota'],
  ['oh', 'ohio'],
  ['ok', 'oklahoma'],
  ['or', 'oregon'],
  ['pa', 'pennsylvania'],
  ['ri', 'rhode island'],
  ['sc', 'south carolina'],
  ['sd', 'south dakota'],
  ['tn', 'tennessee'],
  ['tx', 'texas'],
  ['ut', 'utah'],
  ['vt', 'vermont'],
  ['va', 'virginia'],
  ['wa', 'washington'],
  ['wv', 'west virginia'],
  ['wi', 'wisconsin'],
  ['wy', 'wyoming'],
  ['dc', 'district of columbia'],
]);

export function parseQuery(input: string): ParsedQuery {
  const trimmed = input.trim();
  if (trimmed === '') return { name: '', qualifier: null };

  // Comma form: "Columbia, South Carolina" or "Paris, France" — accept any qualifier
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx !== -1) {
    const name = trimmed.slice(0, commaIdx).trim();
    const qualifier = trimmed.slice(commaIdx + 1).trim();
    return { name, qualifier: qualifier.length > 0 ? qualifier : null };
  }

  // Space form: only when last token is a known US state abbreviation
  // (otherwise "Buenos Aires" would mis-parse as name="Buenos", qualifier="Aires").
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace !== -1) {
    const lastToken = trimmed.slice(lastSpace + 1).toLowerCase();
    if (US_STATE_ABBR.has(lastToken)) {
      return { name: trimmed.slice(0, lastSpace).trim(), qualifier: lastToken };
    }
  }

  return { name: trimmed, qualifier: null };
}

export interface QualifierTargets {
  country: string;
  region: string | null;
}

export function matchesQualifier(target: QualifierTargets, qualifier: string): boolean {
  const q = qualifier.toLowerCase().trim();
  if (q === '') return true;

  const country = target.country.toLowerCase();
  const region = target.region?.toLowerCase() ?? '';

  // Direct substring matches against country/region
  if (country === q || country.includes(q)) return true;
  if (region === q || region.includes(q)) return true;

  // Expand US state abbreviations and retry
  const expanded = US_STATE_ABBR.get(q);
  if (expanded) {
    if (region === expanded || region.includes(expanded)) return true;
  }

  return false;
}
