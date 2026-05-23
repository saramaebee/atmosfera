/**
 * Shape of the JSON model artifact shipped at `models/default.json` and
 * produced by `train/train.ts`. Versioned so we can evolve the layout without
 * silently mis-scoring against an old file.
 */

export const MODEL_VERSION = 1;

export interface LangModel {
  version: number;
  /** Top-level classes the caller sees. First-class languages plus 'other'. */
  classes: string[];
  /**
   * Languages folded into the `other` bucket. Surfacing this lets the runtime
   * report "Other (likely fr)" via a per-subclass secondary score if the
   * trainer chose to emit one. Promoting a subclass to first-class later is a
   * trainer-side rename; no caller code changes.
   */
  subclassesIn?: Partial<Record<string, string[]>>;
  /**
   * Feature vocabulary. The integer index in `vocab` corresponds to the column
   * index in `logLikelihood[class]`.
   */
  vocab: string[];
  /** Per-class log prior. Same order as `classes`. */
  logPrior: number[];
  /** logLikelihood[classIdx][featIdx] = log P(feature | class). Same order as `vocab`. */
  logLikelihood: number[][];
  /** Free-form metadata: corpus version, train date, hashes. Not consumed by runtime. */
  meta?: Record<string, unknown>;
}

export function assertModel(m: unknown): asserts m is LangModel {
  if (!m || typeof m !== 'object') throw new Error('lang-classify: model is not an object');
  const obj = m as Record<string, unknown>;
  if (obj.version !== MODEL_VERSION) {
    throw new Error(
      `lang-classify: model version ${String(obj.version)} != expected ${MODEL_VERSION}`,
    );
  }
  if (!Array.isArray(obj.classes) || obj.classes.length < 2) {
    throw new Error('lang-classify: model.classes must have at least 2 entries');
  }
  if (!Array.isArray(obj.vocab)) throw new Error('lang-classify: model.vocab missing');
  if (!Array.isArray(obj.logPrior) || obj.logPrior.length !== obj.classes.length) {
    throw new Error('lang-classify: logPrior shape mismatch');
  }
  if (!Array.isArray(obj.logLikelihood) || obj.logLikelihood.length !== obj.classes.length) {
    throw new Error('lang-classify: logLikelihood shape mismatch');
  }
  for (const row of obj.logLikelihood as number[][]) {
    if (!Array.isArray(row) || row.length !== (obj.vocab as unknown[]).length) {
      throw new Error('lang-classify: logLikelihood row length != vocab length');
    }
  }
}
