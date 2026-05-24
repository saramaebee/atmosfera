import { describe, expect, it } from 'bun:test';
import {
  LABEL_KEYS,
  alreadyLabelledTexts,
  bucketOf,
  computeCoverage,
  hashQueue,
  mulberry32,
  parseLabelledLine,
  parseQueueLine,
  shuffleSeeded,
} from './label';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const aOut = Array.from({ length: 5 }, () => a());
    const bOut = Array.from({ length: 5 }, () => b());
    expect(aOut).toEqual(bOut);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });
});

describe('shuffleSeeded', () => {
  it('returns the same order for the same seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(shuffleSeeded(items, 7)).toEqual(shuffleSeeded(items, 7));
  });

  it('changes order between seeds', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    // Astronomically unlikely to collide for a 10-element permutation under
    // two distinct seeds; if this ever flakes, the PRNG broke.
    expect(shuffleSeeded(items, 1)).not.toEqual(shuffleSeeded(items, 2));
  });

  it('preserves the multiset of inputs', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffleSeeded(items, 99).slice().sort()).toEqual(items.slice().sort());
  });

  it('does not mutate the input array', () => {
    const items = ['a', 'b', 'c'];
    const copy = items.slice();
    shuffleSeeded(items, 1);
    expect(items).toEqual(copy);
  });
});

describe('bucketOf', () => {
  it('classifies short text after preprocessing', () => {
    expect(bucketOf('hi there')).toBe('short');
  });

  it('classifies medium text after preprocessing', () => {
    // 30 chars after preprocess → falls in [20, 50)
    expect(bucketOf('a medium length sentence here')).toBe('medium');
  });

  it('classifies long text after preprocessing', () => {
    expect(
      bucketOf(
        'this is a substantially longer sentence that definitely exceeds fifty characters total',
      ),
    ).toBe('long');
  });

  it('uses cleaned length — URLs collapse', () => {
    // After URL strip + ws collapse the cleaned text is well under 20 chars.
    expect(bucketOf('hi https://example.com/very/long/url/path')).toBe('short');
  });
});

describe('parseQueueLine', () => {
  it('extracts text', () => {
    expect(parseQueueLine('{"text":"hello"}')).toEqual({ text: 'hello' });
  });

  it('strips lang field — labeller must not see ground truth', () => {
    const row = parseQueueLine('{"lang":"es","text":"hola amigo"}');
    expect(row).toEqual({ text: 'hola amigo' });
    expect(row).not.toHaveProperty('lang');
  });

  it('strips expected field — pre-existing labels must not leak through', () => {
    const row = parseQueueLine('{"text":"hello","expected":"en"}');
    expect(row).toEqual({ text: 'hello' });
    expect(row).not.toHaveProperty('expected');
  });

  it('returns null for blank or invalid lines', () => {
    expect(parseQueueLine('')).toBeNull();
    expect(parseQueueLine('   ')).toBeNull();
    expect(parseQueueLine('not json')).toBeNull();
    expect(parseQueueLine('{"text":""}')).toBeNull();
    expect(parseQueueLine('{"notText":"hi"}')).toBeNull();
  });
});

describe('parseLabelledLine', () => {
  it('parses a labelled row', () => {
    const row = parseLabelledLine('{"text":"hi","expected":"en","ts":"2026-01-01T00:00:00Z"}');
    expect(row).toEqual({ text: 'hi', expected: 'en', ts: '2026-01-01T00:00:00Z' });
  });

  it('tolerates missing ts', () => {
    const row = parseLabelledLine('{"text":"hi","expected":"en"}');
    expect(row).toEqual({ text: 'hi', expected: 'en', ts: '' });
  });

  it('returns null for malformed rows', () => {
    expect(parseLabelledLine('{ not json')).toBeNull();
    expect(parseLabelledLine('{"text":"hi"}')).toBeNull();
    expect(parseLabelledLine('')).toBeNull();
  });
});

describe('alreadyLabelledTexts', () => {
  it('returns the set of texts present in a JSONL file', () => {
    const jsonl = [
      JSON.stringify({ text: 'one', expected: 'en', ts: 't1' }),
      JSON.stringify({ text: 'dos', expected: 'es', ts: 't2' }),
      '', // blank line tolerated
      JSON.stringify({ text: 'tres', expected: 'mixed', ts: 't3' }),
    ].join('\n');
    const set = alreadyLabelledTexts(jsonl);
    expect(set.size).toBe(3);
    expect(set.has('one')).toBe(true);
    expect(set.has('dos')).toBe(true);
    expect(set.has('tres')).toBe(true);
  });

  it('ignores malformed rows so a partial file can resume', () => {
    const jsonl = [
      JSON.stringify({ text: 'ok', expected: 'en', ts: 't1' }),
      '{ not valid json',
      '{"text":"missing-expected"}',
    ].join('\n');
    const set = alreadyLabelledTexts(jsonl);
    expect(set).toEqual(new Set(['ok']));
  });
});

describe('computeCoverage', () => {
  it('counts labelled vs total across three buckets', () => {
    const queue = [
      { text: 'hi' }, // short
      { text: 'hey' }, // short
      { text: 'a medium length sentence here' }, // medium
      {
        text: 'this is a substantially longer sentence that definitely exceeds fifty characters total',
      }, // long
    ];
    const labelled = new Set(['hi', 'a medium length sentence here']);
    const cov = computeCoverage(queue, labelled);
    expect(cov.short.total).toBe(2);
    expect(cov.short.labelled).toBe(1);
    expect(cov.medium.total).toBe(1);
    expect(cov.medium.labelled).toBe(1);
    expect(cov.long.total).toBe(1);
    expect(cov.long.labelled).toBe(0);
  });
});

describe('hashQueue', () => {
  it('is stable for the same queue', () => {
    const queue = [{ text: 'a' }, { text: 'b' }];
    expect(hashQueue(queue)).toBe(hashQueue(queue));
  });

  it('changes when contents change', () => {
    expect(hashQueue([{ text: 'a' }])).not.toBe(hashQueue([{ text: 'b' }]));
  });

  it('changes when order changes', () => {
    expect(hashQueue([{ text: 'a' }, { text: 'b' }])).not.toBe(
      hashQueue([{ text: 'b' }, { text: 'a' }]),
    );
  });
});

describe('LABEL_KEYS', () => {
  it('maps one-keystroke keys to canonical labels matching evaluate.ts', () => {
    expect(LABEL_KEYS).toEqual({
      e: 'en',
      s: 'es',
      m: 'mixed',
      o: 'other',
      u: 'unknown',
    });
  });
});
