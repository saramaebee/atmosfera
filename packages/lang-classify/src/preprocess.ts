/**
 * Preprocessing shared between training and inference. The same string passed
 * to the trainer and the runtime must produce the same cleaned text — never
 * branch behavior between train- and run-time.
 *
 * Preserves case, diacritics, and ¿¡ — all signal for en/es discrimination.
 */

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]+`/g;
const URL = /\b(?:https?|ftp):\/\/[^\s<>"']+/gi;
const DISCORD_USER_MENTION = /<@!?\d+>/g;
const DISCORD_ROLE_MENTION = /<@&\d+>/g;
const DISCORD_CHANNEL_MENTION = /<#\d+>/g;
const DISCORD_CUSTOM_EMOJI = /<a?:[A-Za-z0-9_~]+:\d+>/g;

// Common Unicode emoji ranges. Conservative — we only strip glyphs that are
// clearly emoji; we never strip combining marks or Latin Extended (which carry
// diacritics like á/ñ/ü). ZWJ and VS-16 are written as alternations rather
// than inside the class because biome flags joiners inside character classes
// (they compose multi-codepoint emoji sequences); the practical behavior is
// the same here since we want to strip them when they appear standalone too.
const EMOJI =
  /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{2300}-\u{23FF}]|[\u{1F300}-\u{1F9FF}]|[\u{1FA00}-\u{1FAFF}]|\u{200D}|\u{FE0F}/gu;

const REPEATED_LETTER = /([A-Za-zÀ-ÿ])\1{2,}/g;
const REPEATED_PUNCT = /([!?.,])\1{2,}/g;
const WS = /\s+/g;

export function preprocess(input: string): string {
  if (!input) return '';
  let s = input;
  s = s.replace(FENCED_CODE, ' ');
  s = s.replace(INLINE_CODE, ' ');
  s = s.replace(URL, ' ');
  s = s.replace(DISCORD_CUSTOM_EMOJI, ' ');
  s = s.replace(DISCORD_USER_MENTION, ' ');
  s = s.replace(DISCORD_ROLE_MENTION, ' ');
  s = s.replace(DISCORD_CHANNEL_MENTION, ' ');
  s = s.replace(EMOJI, ' ');
  // Collapse "noooo" → "noo", "!!!!" → "!!" so the same word with varying
  // emphasis doesn't pollute the n-gram vocabulary.
  s = s.replace(REPEATED_LETTER, '$1$1');
  s = s.replace(REPEATED_PUNCT, '$1$1');
  s = s.replace(WS, ' ').trim();
  return s;
}
