/**
 * Metadata files: cue payloads are data for scripts (§4.2.4), often JSON. A payload cannot hold
 * a blank line (it would end the cue) or "-->" (it would read as a timing line); these help
 * write JSON payloads that avoid both, and guess a file's type from what it holds.
 */
import type { FileType } from './validate.ts';
import type { VttDocument } from './document.ts';
import { extractChapterTitle } from './cuetext.ts';

/** Whether a payload is meant as JSON: an object or an array. */
export const looksLikeJson = (text: string): boolean => /^\s*[[{]/.test(text);

/** Why `text` is not JSON (the parser's message), or null when it parses. */
export function jsonProblem(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * JSON rewritten for a metadata payload: indented by `indent` spaces (0 for one line), with
 * "-->" inside strings written "-->" (the same string to a JSON parser). Throws a
 * SyntaxError when the text is not JSON.
 */
export function formatJson(text: string, indent = 2): string {
  return JSON.stringify(JSON.parse(text), null, indent).replace(/-->/g, '--\\u003e');
}

/** What a metadata payload cannot hold, each with a message; empty when it is fine. */
export function metadataPayloadProblems(text: string): string[] {
  const out: string[] = [];
  if (/\n[ \t]*\n/.test(text.trim()))
    out.push('A blank line would end the cue; export removes it.');
  if (text.includes('-->'))
    out.push(
      looksLikeJson(text)
        ? '"-->" would end the cue; in JSON write it as "--\\u003e" (Format does this).'
        : '"-->" would end the cue; export writes it as "-- >".',
    );
  return out;
}

/** A guess at a file's type, with the reason to show. */
export interface FileTypeGuess {
  type: Exclude<FileType, 'captions' | 'any'>;
  reason: string;
}

/**
 * Guesses that a document is chapters or metadata rather than captions: from its name
 * ("…chapters.vtt", "…metadata.vtt"), from every payload being JSON, or from chapter-like cues
 * (two or more, each at least 20 s long, one short line without markup, following each other
 * with no gaps). Null when it looks like captions.
 */
export function guessFileType(doc: VttDocument, name = ''): FileTypeGuess | null {
  const cues = doc.body.filter((i) => i.type === 'cue');
  if (cues.length === 0) return null;
  const base = name.replace(/\.[^.]*$/, '');
  if (/(^|[^a-z])(chapters?|kapitel|chapitres?|cap[ií]tulos?)([^a-z]|$)/i.test(base))
    return { type: 'chapters', reason: 'the file name says it holds chapters' };
  if (/(^|[^a-z])metadata([^a-z]|$)/i.test(base))
    return { type: 'metadata', reason: 'the file name says it holds metadata' };
  if (cues.every((c) => looksLikeJson(c.text) && jsonProblem(c.text) === null))
    return { type: 'metadata', reason: 'every cue holds JSON data' };
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  const chapterLike =
    sorted.length >= 2 &&
    sorted.every(
      (c, i) =>
        c.endMs - c.startMs >= 20_000 &&
        !c.text.includes('\n') &&
        !c.text.includes('<') &&
        extractChapterTitle(c.text).length <= 80 &&
        (i === 0 || Math.abs(c.startMs - (sorted[i - 1]?.endMs ?? 0)) <= 1000),
    );
  return chapterLike
    ? { type: 'chapters', reason: 'its cues are long, one-line titles that follow each other' }
    : null;
}
