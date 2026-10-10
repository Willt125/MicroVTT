/**
 * Writing systems, as far as editing needs them: whether words are separated by spaces, and
 * which way text runs.
 */

/**
 * Characters of scripts written without spaces between words (Chinese, Japanese, Thai, Lao,
 * Khmer, Myanmar, Tibetan), and CJK punctuation and full-width forms.
 */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\u3000-\u303f\uff00-\uffef]/u;

/** Whether a character belongs to a script written without spaces between words. */
export const isUnspaced = (ch: string | undefined): boolean =>
  ch !== undefined && UNSPACED.test(ch);

/** Cue text as read: markup and zero-width spaces removed. */
const visible = (text: string): string => text.replace(/<[^>]*>/g, '').replace(/\u200b/g, '');

/**
 * Whether two pieces of text join without a space (both sides in a script written without
 * spaces), as when two lines of a caption are joined into one. Without `before`, the text after
 * decides alone.
 */
export function joinsWithoutSpace(before: string | undefined, after: string): boolean {
  const next = [...visible(after)][0];
  if (before === undefined) return isUnspaced(next);
  const prev = [...visible(before)].at(-1);
  return isUnspaced(prev) && isUnspaced(next);
}
