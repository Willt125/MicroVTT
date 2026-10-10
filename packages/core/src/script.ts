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

/** Whether text contains any character of a script written without spaces. */
export const hasUnspaced = (text: string): boolean => UNSPACED.test(text);

/** Chinese and Japanese characters, punctuation and full-width forms. */
const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\u30fc\uff00-\uffef]/u;

/** Cue text as read: markup and zero-width spaces removed. */
const visible = (text: string): string => text.replace(/<[^>]*>/g, '').replace(/\u200b/g, '');

/**
 * Whether two lines of a caption join into one without a space: Chinese and Japanese on both
 * sides. (Thai, Khmer and Myanmar separate phrases with spaces, so a line break between them most
 * likely stood for one.) Without `before`, the text after decides alone.
 */
export function joinsWithoutSpace(before: string | undefined, after: string): boolean {
  const next = [...visible(after)][0];
  const cjk = (ch: string | undefined): boolean => ch !== undefined && CJK.test(ch);
  if (before === undefined) return cjk(next);
  return cjk([...visible(before)].at(-1)) && cjk(next);
}

/** Lines of plain text joined into one, with a space only where the scripts need one. */
export function joinLines(lines: readonly string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    out += out === '' || joinsWithoutSpace(out, line) ? line : ` ${line}`;
  }
  return out;
}

/** A piece of text a line may break before, and what separates it from the piece before. */
export interface BreakUnit {
  text: string;
  /** A space, or nothing within a script written without spaces. */
  gap: string;
}

let wordSegmenter: Intl.Segmenter | undefined;
const OPENERS = /^[\p{Ps}\p{Pi}]+$/u;
const KANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;
const JAPANESE_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー\p{Pe}\p{Pf}]$/u;

/**
 * Plain text split where a line may break: at spaces, and inside runs of scripts written
 * without spaces at the word boundaries `Intl.Segmenter` finds (Chinese, Japanese and Thai
 * dictionaries). Punctuation stays with the word it belongs to (a full stop with the word before,
 * an opening bracket with the word after), and Japanese particles and verb endings in hiragana
 * stay with the word before, so breaks fall between phrases.
 */
export function breakUnits(text: string): BreakUnit[] {
  const units: BreakUnit[] = [];
  for (const m of joinLines(text.split('\n')).matchAll(/(\s*)(\S+)/g)) {
    const token = m[2] as string;
    let gap = units.length === 0 ? '' : ' ';
    if (!hasUnspaced(token)) {
      units.push({ text: token, gap });
      continue;
    }
    wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
    let opener = '';
    let first = true;
    for (const { segment, isWordLike } of wordSegmenter.segment(token)) {
      const prev = first ? undefined : units.at(-1);
      if (!isWordLike && OPENERS.test(segment)) {
        opener += segment;
      } else if (
        prev &&
        opener === '' &&
        ((!isWordLike && !/^\s+$/.test(segment)) ||
          (KANA_ONLY.test(segment) && JAPANESE_END.test(prev.text)))
      ) {
        prev.text += segment;
      } else {
        units.push({ text: opener + segment, gap });
        opener = '';
        gap = '';
        first = false;
      }
    }
    if (opener !== '') units.push({ text: opener, gap });
  }
  return units;
}

/**
 * Whether two pieces of text with nothing between them are one word, so a line or cue must not
 * break between them: letters of a spaced script on both sides (Korean "헤드" + "라인"), or a
 * Japanese ending in hiragana after the word it belongs to ("わから" + "ない").
 */
export function continuesWord(before: string, after: string): boolean {
  const prev = [...visible(before)].at(-1);
  const next = visible(after);
  const first = [...next][0];
  if (prev === undefined || first === undefined) return false;
  const letter = /[\p{L}\p{M}\p{N}]/u;
  if (letter.test(prev) && letter.test(first) && !isUnspaced(prev) && !isUnspaced(first))
    return true;
  const word = next.replace(/\p{P}+$/u, '');
  return word !== '' && KANA_ONLY.test(word) && JAPANESE_END.test(prev);
}
