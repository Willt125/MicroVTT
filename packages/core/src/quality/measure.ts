/**
 * Measuring cue text the way a viewer reads it: markup removed, character references decoded,
 * ruby annotations left out, and characters counted as graphemes (what a reader sees as one
 * character), so combining marks and emoji count once.
 */
import { parseCueText, type CueNode } from '../cuetext.ts';
import { hasUnspaced } from '../script.ts';

const lineCache = new Map<string, string[]>();
const lengthCache = new Map<string, number>();
const CACHE_LIMIT = 100_000;

/** The text a viewer reads, line by line. Cached by cue text (most cues are unchanged between checks). */
export function readableLines(text: string): string[] {
  let lines = lineCache.get(text);
  if (lines) return lines;
  if (!/[<&]/.test(text)) {
    lines = text.split('\n');
  } else {
    let out = '';
    const walk = (nodes: CueNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'text') out += node.value;
        else if (node.type === 'timestamp' || node.type === 'rt') continue;
        else walk(node.children);
      }
    };
    walk(parseCueText(text).children);
    lines = out.split('\n');
  }
  if (lineCache.size >= CACHE_LIMIT) lineCache.clear();
  lineCache.set(text, lines);
  return lines;
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
