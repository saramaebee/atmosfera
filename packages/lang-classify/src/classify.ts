import { extractFeatures } from './features';
import type { LangModel } from './model';
import stopwords from './models/stopwords.json' with { type: 'json' };
import { preprocess } from './preprocess';

// Per-language unique stopwords: tokens that appear in *only* this language's
// stopword vocab. Shared function words like "no" / "a" appear in both en and
// es; counting them as evidence for either side creates false-positive 'mixed'
// labels on plain Spanish. Restricting to unique stopwords keeps the override
// honest.
const FIRST_CLASS_STOPWORDS: Map<string, Set<string>> = (() => {
  const all = stopwords as Record<string, string[]>;
  const result = new Map<string, Set<string>>();
  for (const [lang, words] of Object.entries(all)) {
    const unique = new Set<string>();
    for (const w of words) {
      let foundElsewhere = false;
      for (const [otherLang, otherWords] of Object.entries(all)) {
        if (otherLang === lang) continue;
        if (otherWords.includes(w)) {
          foundElsewhere = true;
          break;
        }
      }
      if (!foundElsewhere) unique.add(w);
    }
    result.set(lang, unique);
  }
  return result;
})();
const WORD_SPLIT = /[^\p{L}\p{N}']+/u;
// At least this many stopwords from each of two first-class languages is
// strong evidence of code-switching — NB tends to commit to one language with
// >99% confidence even on Spanglish, so we override via this lexical check.
const MIXED_MIN_STOPWORDS_PER_LANG = 2;
const MIXED_MAX_RATIO = 3.0;

export interface ClassScore {
  label: string;
  confidence: number;
}

export interface ClassifyResult {
  /**
   * `'mixed'`  — top-2 are both first-class languages and the margin is below
   *              the length-adjusted threshold.
   * `'unknown'` — too short, or top class isn't confident enough and the
   *              runner-up isn't first-class.
   * Any other value is one of `model.classes` (e.g., `'en'`, `'es'`, `'other'`).
   */
  label: string;
  /** P(label) under the model. 0 for `'mixed'` / `'unknown'`. */
  confidence: number;
  /** All classes scored, sorted descending. */
  scores: ClassScore[];
  /** Second-place class (always populated for inspection). */
  runnerUp: ClassScore;
  /** Length of preprocessed text in chars. */
  lengthAfterClean: number;
  /** Reason for abstain, if abstained. */
  abstainReason?: 'too_short' | 'low_confidence' | 'low_margin';
}

const MIN_LENGTH_HARD_ABSTAIN = 8;
const SHORT_LENGTH_THRESHOLD = 20;
const TOP_PROB_FLOOR = 0.55;
const MARGIN_LONG = 0.15;
const MARGIN_SHORT = 0.25;
const OTHER_LABEL = 'other';

export function classifyText(text: string, model: LangModel): ClassifyResult {
  const cleaned = preprocess(text);
  return classifyCleaned(cleaned, model);
}

/**
 * Score `cleaned` (already-preprocessed text) against the model. Exposed for
 * the trainer/evaluator, which avoids redundant preprocess passes.
 */
export function classifyCleaned(cleaned: string, model: LangModel): ClassifyResult {
  const lengthAfterClean = cleaned.length;
  const feats = extractFeatures(cleaned);
  const result = classifyFeatures(feats, lengthAfterClean, model);
  // Lexical mixed-language override: NB will happily call obvious Spanglish
  // 'es' at 99.9%. Counting stopwords from each first-class language catches
  // these cases cheaply.
  const mixedOverride = detectMixedByStopwords(cleaned, model);
  if (mixedOverride) {
    return {
      ...result,
      label: 'mixed',
      confidence: 0,
      abstainReason: result.abstainReason ?? 'low_margin',
    };
  }
  return result;
}

function detectMixedByStopwords(cleaned: string, model: LangModel): boolean {
  // Only run if the model has at least two first-class languages (non-'other').
  const firstClass = model.classes.filter((c) => c !== 'other' && FIRST_CLASS_STOPWORDS.has(c));
  if (firstClass.length < 2) return false;
  const lower = cleaned.toLowerCase();
  const counts = new Map<string, number>();
  for (const lang of firstClass) counts.set(lang, 0);
  for (const tok of lower.split(WORD_SPLIT)) {
    if (!tok) continue;
    for (const lang of firstClass) {
      if (FIRST_CLASS_STOPWORDS.get(lang)?.has(tok)) {
        counts.set(lang, (counts.get(lang) ?? 0) + 1);
      }
    }
  }
  // Both languages must clear the floor; the smaller count must be within
  // MIXED_MAX_RATIO of the larger so we don't flag a single stray foreign word.
  const vals = Array.from(counts.values()).sort((a, b) => b - a);
  if (vals.length < 2) return false;
  const [top, second] = vals;
  if (second < MIXED_MIN_STOPWORDS_PER_LANG) return false;
  if (top / second > MIXED_MAX_RATIO) return false;
  return true;
}

export function classifyFeatures(
  feats: Map<string, number>,
  lengthAfterClean: number,
  model: LangModel,
): ClassifyResult {
  const vocabIdx = vocabIndex(model);
  const scoresLog = new Array<number>(model.classes.length);
  for (let c = 0; c < model.classes.length; c++) {
    scoresLog[c] = model.logPrior[c] ?? 0;
  }
  for (const [feat, count] of feats) {
    const idx = vocabIdx.get(feat);
    if (idx === undefined) continue;
    for (let c = 0; c < model.classes.length; c++) {
      scoresLog[c] += count * model.logLikelihood[c][idx];
    }
  }

  const probs = softmax(scoresLog);
  const scores: ClassScore[] = model.classes.map((label, i) => ({ label, confidence: probs[i] }));
  scores.sort((a, b) => b.confidence - a.confidence);
  const top = scores[0];
  const runnerUp = scores[1];

  if (lengthAfterClean < MIN_LENGTH_HARD_ABSTAIN) {
    return {
      label: 'unknown',
      confidence: 0,
      scores,
      runnerUp,
      lengthAfterClean,
      abstainReason: 'too_short',
    };
  }

  const marginThreshold = lengthAfterClean < SHORT_LENGTH_THRESHOLD ? MARGIN_SHORT : MARGIN_LONG;
  const margin = top.confidence - runnerUp.confidence;

  if (top.confidence < TOP_PROB_FLOOR) {
    return {
      label: mixedOrUnknown(top, runnerUp),
      confidence: 0,
      scores,
      runnerUp,
      lengthAfterClean,
      abstainReason: 'low_confidence',
    };
  }

  if (margin < marginThreshold) {
    return {
      label: mixedOrUnknown(top, runnerUp),
      confidence: 0,
      scores,
      runnerUp,
      lengthAfterClean,
      abstainReason: 'low_margin',
    };
  }

  return {
    label: top.label,
    confidence: top.confidence,
    scores,
    runnerUp,
    lengthAfterClean,
  };
}

function mixedOrUnknown(top: ClassScore, runnerUp: ClassScore): 'mixed' | 'unknown' {
  // 'mixed' only when both contenders are first-class (non-'other') languages.
  if (top.label !== OTHER_LABEL && runnerUp.label !== OTHER_LABEL) return 'mixed';
  return 'unknown';
}

const VOCAB_INDEX_CACHE = new WeakMap<LangModel, Map<string, number>>();

function vocabIndex(model: LangModel): Map<string, number> {
  let idx = VOCAB_INDEX_CACHE.get(model);
  if (idx) return idx;
  idx = new Map();
  for (let i = 0; i < model.vocab.length; i++) idx.set(model.vocab[i], i);
  VOCAB_INDEX_CACHE.set(model, idx);
  return idx;
}

function softmax(xs: number[]): number[] {
  let max = Number.NEGATIVE_INFINITY;
  for (const x of xs) if (x > max) max = x;
  let sum = 0;
  const out = new Array<number>(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const e = Math.exp(xs[i] - max);
    out[i] = e;
    sum += e;
  }
  for (let i = 0; i < xs.length; i++) out[i] /= sum;
  return out;
}
