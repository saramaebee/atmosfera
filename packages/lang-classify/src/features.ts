/**
 * Feature extraction shared by training and inference.
 *
 * Three feature families, each keyed with a distinct prefix so they coexist in
 * a single sparse vector:
 *
 *  - `c<n>:<gram>` — char n-grams over the lowercased cleaned text, n=1..5.
 *    Includes spaces so word-boundary morphemes (`" the "`, `" que "`) survive.
 *    Lowercased to keep the vocabulary tractable; case signal is captured at
 *    the word level via stopwords (Spanish doesn't capitalize months/days etc.,
 *    but that shows up better through the stopword feature family).
 *
 *  - `w:<token>` — word presence for tokens in the union stopword vocab.
 *    Restricting to a curated stopword set is the cheapest way to fight OOV
 *    and is the highest-precision short-text signal we have.
 *
 *  - `d:<char>` — diacritic / Spanish-punctuation indicator counts. Tiny, but
 *    resolves a lot of 6-word messages on its own.
 */

import stopwords from './models/stopwords.json' with { type: 'json' };

export const CHAR_NGRAM_MIN = 1;
export const CHAR_NGRAM_MAX = 5;

const DIACRITIC_CHARS = ['ñ', 'á', 'é', 'í', 'ó', 'ú', 'ü', '¿', '¡'];

const STOPWORD_VOCAB: Set<string> = (() => {
  const set = new Set<string>();
  for (const lang of Object.keys(stopwords) as Array<keyof typeof stopwords>) {
    for (const w of stopwords[lang]) set.add(w);
  }
  return set;
})();

const WORD_SPLIT = /[^\p{L}\p{N}']+/u;

export function extractFeatures(cleaned: string): Map<string, number> {
  const feats = new Map<string, number>();
  if (!cleaned) return feats;

  const lower = cleaned.toLowerCase();

  // Char n-grams. Pad with a single leading + trailing space so begin/end
  // boundary positions can be distinguished from interior positions for n>=2.
  const padded = ` ${lower} `;
  for (let n = CHAR_NGRAM_MIN; n <= CHAR_NGRAM_MAX; n++) {
    const limit = padded.length - n;
    for (let i = 0; i <= limit; i++) {
      const gram = padded.slice(i, i + n);
      // Skip all-whitespace n-grams except the unigram " " which carries
      // average-word-length signal.
      if (n > 1 && gram.trim().length === 0) continue;
      const key = `c${n}:${gram}`;
      feats.set(key, (feats.get(key) ?? 0) + 1);
    }
  }

  // Word-level stopword presence (count, not just boolean — repeated function
  // words still signal language).
  for (const tok of lower.split(WORD_SPLIT)) {
    if (!tok) continue;
    if (STOPWORD_VOCAB.has(tok)) {
      const key = `w:${tok}`;
      feats.set(key, (feats.get(key) ?? 0) + 1);
    }
  }

  // Diacritic / Spanish-punctuation indicator counts.
  for (const ch of DIACRITIC_CHARS) {
    let count = 0;
    // Count occurrences in the original (case-folded already) cleaned text.
    for (let i = 0; i < lower.length; i++) {
      if (lower[i] === ch) count++;
    }
    if (count > 0) feats.set(`d:${ch}`, count);
  }

  return feats;
}

/**
 * Total feature mass — the "document length" in NB terms. Used by callers that
 * need to bucket short vs long inputs after preprocessing.
 */
export function featureMass(feats: Map<string, number>): number {
  let total = 0;
  for (const v of feats.values()) total += v;
  return total;
}
