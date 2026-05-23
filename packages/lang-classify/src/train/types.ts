/**
 * Training corpus row. `lang` is the raw language code (`en`, `es`, `pt`, …).
 * The trainer maps these to top-level classes via `OTHER_SUBCLASSES`.
 */
export interface CorpusRow {
  lang: string;
  text: string;
  source?: string;
}

/** Languages exposed as first-class top-level classes. */
export const FIRST_CLASS_LANGS = ['en', 'es'] as const;
export type FirstClassLang = (typeof FIRST_CLASS_LANGS)[number];

/** Languages pooled into the 'other' bucket. Promotable to first-class later. */
export const OTHER_SUBCLASSES = ['pt', 'fr', 'it', 'de', 'ca', 'gl', 'ro', 'nl'] as const;
export type OtherSubclass = (typeof OTHER_SUBCLASSES)[number];

export function toTopLevelClass(lang: string): string {
  if ((FIRST_CLASS_LANGS as readonly string[]).includes(lang)) return lang;
  return 'other';
}
