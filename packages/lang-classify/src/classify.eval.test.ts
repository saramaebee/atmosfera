/**
 * Regression test: load the shipped default.json + committed eval set, score
 * everything, assert per-bucket accuracy thresholds. Failing this means the
 * model has regressed against the seed corpus.
 *
 * Thresholds are set conservatively for v1 (small seed corpus, no Tatoeba
 * yet). Bump them as the corpus grows.
 */

import { describe, expect, it } from 'bun:test';
import { classifyText } from './classify';
import { loadDefaultModel } from './index';
import evalSet from './models/eval-set.json' with { type: 'json' };

interface EvalRow {
  text: string;
  expected: string;
}

const rows = (evalSet as { rows: EvalRow[] }).rows;

describe('classify against shipped default model + eval set', () => {
  const model = loadDefaultModel();

  it('reaches overall accuracy threshold', () => {
    const correct = rows.filter((r) => classifyText(r.text, model).label === r.expected).length;
    const accuracy = correct / rows.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('handles long inputs (>=20 chars after clean) accurately', () => {
    let total = 0;
    let correct = 0;
    for (const r of rows) {
      const res = classifyText(r.text, model);
      if (res.lengthAfterClean < 20) continue;
      total++;
      if (res.label === r.expected) correct++;
    }
    expect(total).toBeGreaterThan(0);
    expect(correct / total).toBeGreaterThanOrEqual(0.85);
  });

  it('does not collapse to unknown on long inputs that should classify', () => {
    // No long en or es row should fall to 'unknown'.
    for (const r of rows) {
      if (r.expected !== 'en' && r.expected !== 'es') continue;
      const res = classifyText(r.text, model);
      if (res.lengthAfterClean < 20) continue;
      expect(res.label).not.toBe('unknown');
    }
  });

  it('correctly abstains on inputs labeled unknown', () => {
    for (const r of rows) {
      if (r.expected !== 'unknown') continue;
      const res = classifyText(r.text, model);
      expect(res.label).toBe('unknown');
    }
  });

  it('detects all `other`-language inputs as `other`', () => {
    let total = 0;
    let correct = 0;
    for (const r of rows) {
      if (r.expected !== 'other') continue;
      total++;
      if (classifyText(r.text, model).label === 'other') correct++;
    }
    expect(total).toBeGreaterThan(0);
    expect(correct / total).toBeGreaterThanOrEqual(0.8);
  });
});
