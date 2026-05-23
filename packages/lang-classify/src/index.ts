import { type LangModel, assertModel } from './model';
import defaultModelJson from './models/default.json' with { type: 'json' };

export type { LangModel } from './model';
export {
  classifyText,
  classifyCleaned,
  classifyFeatures,
  type ClassifyResult,
  type ClassScore,
} from './classify';
export { extractFeatures, featureMass } from './features';
export { preprocess } from './preprocess';

let cachedDefault: LangModel | null = null;

/**
 * Returns the shipped default model (en / es / other). Cached after first call.
 * Throws if the bundled JSON is malformed — that's a build-time problem, not a
 * runtime fallback condition.
 */
export function loadDefaultModel(): LangModel {
  if (cachedDefault) return cachedDefault;
  const m = defaultModelJson as unknown;
  assertModel(m);
  cachedDefault = m;
  return m;
}
