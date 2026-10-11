/**
 * Measuring cue text the way a viewer reads it: markup removed, character references decoded,
 * ruby annotations left out, and characters counted as graphemes (what a reader sees as one
 * character), so combining marks and emoji count once.
 */
import { WEBVTT_TEXT } from '../format/webvtt-text.ts';
import { hasUnspaced } from '../script.ts';

const lengthCache = new Map<string, number>();
const CACHE_LIMIT = 100_000;

/** The text a viewer reads of WebVTT cue text, line by line (see `TextDialect.readableLines`). */
export function readableLines(text: string): string[] {
  return WEBVTT_TEXT.readableLines(text);
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Characters as a reader counts them (grapheme clusters). */
export function graphemeLength(text: string): number {
  // Below U+0300 (combining marks start there) every character is a grapheme of its own.
  if (/^[\x20-\u02ff]*$/.test(text)) return text.length;
  let n = lengthCache.get(text);
  if (n !== undefined) return n;
  if (!segmenter) n = Array.from(text).length;
  else {
    n = 0;
    for (const _ of segmenter.segment(text)) n++;
  }
  if (lengthCache.size >= CACHE_LIMIT) lengthCache.clear();
  lengthCache.set(text, n);
  return n;
}

/**
 * Half-width characters, which some guides (Japanese, Korean) count as half a character: Latin
 * letters with their accents, ASCII digits, punctuation and spaces, and the half-width forms of
 * katakana, Hangul and symbols (U+FF61–FFEE). Full-width forms, CJK punctuation and other
 * scripts count as one.
 */
const HALF_WIDTH = /^[\x20-\u036f\uff61-\uffdc\uffe8-\uffee]/;
const weightedCache = new Map<string, number>();

/**
 * Length as a guide counts it: graphemes, with half-width ones counting `halfWidth` (1 counts
 * every character alike, as most guides do).
 */
export function displayLength(text: string, halfWidth = 1): number {
  if (halfWidth === 1) return graphemeLength(text);
  const key = `${halfWidth}\u0000${text}`;
  let n = weightedCache.get(key);
  if (n !== undefined) return n;
  n = 0;
  if (segmenter)
    for (const { segment } of segmenter.segment(text))
      n += HALF_WIDTH.test(segment) ? halfWidth : 1;
  else for (const ch of text) n += HALF_WIDTH.test(ch) ? halfWidth : 1;
  if (weightedCache.size >= CACHE_LIMIT) weightedCache.clear();
  weightedCache.set(key, n);
  return n;
}

/** A count for a message: whole, or to one decimal when half-width characters count half. */
export const formatCount = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Words: runs of non-space text containing a letter or digit, or in scripts written without
 * spaces, the words `Intl.Segmenter` finds.
 */
export function wordCount(text: string): number {
  if (!hasUnspaced(text)) return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  let n = 0;
  for (const s of wordSegmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}
let wordSegmenter: Intl.Segmenter | undefined;
