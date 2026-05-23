import { describe, expect, it } from 'bun:test';
import { preprocess } from './preprocess';

describe('preprocess', () => {
  it('strips fenced code blocks', () => {
    expect(preprocess('hello ```const x = 1;``` world')).toBe('hello world');
  });

  it('strips inline backticks', () => {
    expect(preprocess('use `npm install` then run')).toBe('use then run');
  });

  it('strips URLs', () => {
    expect(preprocess('check https://example.com/foo?bar=1 ok')).toBe('check ok');
  });

  it('strips Discord mentions and custom emoji', () => {
    expect(preprocess('hey <@123> see <#456> <:smile:789> <@&999>')).toBe('hey see');
  });

  it('strips Unicode emoji but preserves Latin Extended', () => {
    expect(preprocess('mañana 🎉 será un día café ☕')).toBe('mañana será un día café');
  });

  it('preserves case, diacritics, and Spanish punctuation', () => {
    expect(preprocess('¿Cómo estás? ¡Genial!')).toBe('¿Cómo estás? ¡Genial!');
  });

  it('collapses repeated letters and punctuation', () => {
    expect(preprocess('nooooo waaay!!!!!')).toBe('noo waay!!');
  });

  it('returns empty for empty / whitespace / null-ish', () => {
    expect(preprocess('')).toBe('');
    expect(preprocess('   \n\t  ')).toBe('');
  });

  it('does not strip combining diacritics on Latin Extended chars', () => {
    // Composed and decomposed forms both pass through.
    expect(preprocess('café résumé niño')).toBe('café résumé niño');
  });

  it('leaves a bare URL message as empty', () => {
    expect(preprocess('https://example.com')).toBe('');
  });
});
