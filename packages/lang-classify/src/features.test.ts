import { describe, expect, it } from 'bun:test';
import { extractFeatures, featureMass } from './features';

describe('extractFeatures', () => {
  it('returns empty for empty input', () => {
    expect(extractFeatures('').size).toBe(0);
  });

  it('produces char n-grams n=1..5 including boundary spaces', () => {
    const feats = extractFeatures('hi');
    // padded: " hi "
    expect(feats.get('c1:h')).toBe(1);
    expect(feats.get('c1:i')).toBe(1);
    expect(feats.get('c2: h')).toBe(1);
    expect(feats.get('c2:hi')).toBe(1);
    expect(feats.get('c2:i ')).toBe(1);
    expect(feats.get('c3: hi')).toBe(1);
    expect(feats.get('c3:hi ')).toBe(1);
    expect(feats.get('c4: hi ')).toBe(1);
  });

  it('lowercases for char features', () => {
    const a = extractFeatures('Hi');
    const b = extractFeatures('hi');
    expect(a.get('c2:hi')).toBe(b.get('c2:hi'));
  });

  it('extracts stopwords as separate w: features', () => {
    const feats = extractFeatures('the cat and the dog');
    expect(feats.get('w:the')).toBe(2);
    expect(feats.get('w:and')).toBe(1);
    // 'cat' is not in the stopword list
    expect(feats.has('w:cat')).toBe(false);
  });

  it('counts Spanish diacritics and ¿¡', () => {
    const feats = extractFeatures('¿Cómo estás? ¡Mañana!');
    expect(feats.get('d:¿')).toBe(1);
    expect(feats.get('d:¡')).toBe(1);
    expect(feats.get('d:ó')).toBe(1);
    expect(feats.get('d:á')).toBe(1);
    expect(feats.get('d:ñ')).toBe(1);
  });

  it('feature mass is the sum of counts', () => {
    const feats = extractFeatures('hi');
    expect(featureMass(feats)).toBeGreaterThan(0);
  });

  it('strips whitespace-only n-grams for n>=2', () => {
    const feats = extractFeatures('a  b');
    // No "  " bigram should be present
    expect(feats.has('c2:  ')).toBe(false);
  });
});
