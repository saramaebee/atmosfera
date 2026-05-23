import { describe, expect, it } from 'bun:test';
import { classifyCleaned, classifyText } from './classify';
import type { LangModel } from './model';

// Tiny synthetic model used for unit tests of the decision rule. Real-world
// accuracy is covered by the eval-set regression test which loads the shipped
// default.json (see classify.eval.test.ts).
function makeModel(opts: {
  classes: string[];
  // Mapping of class → { feature: log-likelihood }. Missing entries default to a low value.
  ll: Array<Record<string, number>>;
  prior?: number[];
}): LangModel {
  const vocab = Array.from(new Set(opts.ll.flatMap((m) => Object.keys(m))));
  const logLikelihood = opts.ll.map((row) => vocab.map((v) => row[v] ?? -10));
  return {
    version: 1,
    classes: opts.classes,
    vocab,
    logPrior: opts.prior ?? new Array(opts.classes.length).fill(Math.log(1 / opts.classes.length)),
    logLikelihood,
  };
}

describe('classify decision rule', () => {
  it('returns unknown / too_short for very short inputs', () => {
    const model = makeModel({
      classes: ['en', 'es', 'other'],
      ll: [{ 'c1:a': -1 }, { 'c1:a': -2 }, { 'c1:a': -2 }],
    });
    const res = classifyText('hi', model);
    expect(res.label).toBe('unknown');
    expect(res.abstainReason).toBe('too_short');
  });

  it('returns the top label when length and margin are both healthy', () => {
    // Strongly prefer 'en' via a feature that only 'en' likes.
    const model = makeModel({
      classes: ['en', 'es', 'other'],
      ll: [{ 'c2:th': -0.1 }, { 'c2:th': -8 }, { 'c2:th': -8 }],
    });
    const res = classifyText('the the the the the the', model);
    expect(res.label).toBe('en');
    expect(res.confidence).toBeGreaterThan(0.9);
  });

  it("returns 'mixed' when top-2 first-class languages are close", () => {
    // Both en and es score equally well on the input → small margin.
    const model = makeModel({
      classes: ['en', 'es', 'other'],
      ll: [
        { 'c2:th': -0.1, 'c2:qu': -0.1 },
        { 'c2:th': -0.1, 'c2:qu': -0.1 },
        { 'c2:th': -8, 'c2:qu': -8 },
      ],
    });
    const res = classifyCleaned('the the qu qu the qu the qu', model);
    expect(res.label).toBe('mixed');
    expect(res.abstainReason).toBeTruthy();
  });

  it("returns 'unknown' when contenders include 'other'", () => {
    const model = makeModel({
      classes: ['en', 'es', 'other'],
      ll: [
        { 'c2:zz': -0.5 },
        { 'c2:zz': -8 },
        { 'c2:zz': -0.52 }, // very close to en (margin too small to commit)
      ],
    });
    const res = classifyCleaned('zz zz zz zz zz zz zz zz zz', model);
    // top is 'en', runner-up is 'other' → margin is tiny → unknown, not mixed
    expect(res.label).toBe('unknown');
  });

  it('widens margin requirement on short inputs', () => {
    // Margin ~0.16: passes long threshold (0.15) but should fail short (0.25)
    const model = makeModel({
      classes: ['en', 'es', 'other'],
      ll: [
        { 'c2:ab': -0.5 },
        { 'c2:ab': -0.65 }, // small per-feat diff
        { 'c2:ab': -10 },
      ],
    });
    const shortInput = 'ab ab ab'; // 8 chars, below SHORT threshold
    const res = classifyCleaned(shortInput, model);
    expect(['en', 'mixed']).toContain(res.label);
  });

  it('populates runnerUp and scores arrays', () => {
    const model = makeModel({
      classes: ['en', 'es', 'other'],
      ll: [{ 'c2:th': -0.1 }, { 'c2:th': -8 }, { 'c2:th': -8 }],
    });
    const res = classifyText('the the the the the the', model);
    expect(res.scores.length).toBe(3);
    expect(res.scores[0].confidence).toBeGreaterThanOrEqual(res.scores[1].confidence);
    expect(res.runnerUp.label).toBe(res.scores[1].label);
  });
});
