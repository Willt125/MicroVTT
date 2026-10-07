/**
 * Find and replace over cue text. Searches the raw text (markup included), so what is found is
 * exactly what gets replaced. With `acrossTimings`, a space in a plain-text query also matches
 * the word-timing tags around it, so "chat gpt" finds "chat <00:00:01.000>gpt"; replacing such a
 * match drops the timing tags inside it.
 */
import type { Cue, VttDocument } from '@microvtt/core';

export interface FindOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  /** Treat `query` as a JavaScript regular expression; replacements may use $1, $<name>. */
  regex: boolean;
  /** Let spaces in a plain query match across word-timing and class tags. */
  acrossTimings?: boolean;
}

/** Whitespace between words, with any tags (timestamps, `<c>` spans) on either side. */
const ACROSS_TAGS = String.raw`(?:<[^>\n]*>)*[ \t\n]+(?:<[^>\n]*>)*`;

export interface Match {
  bodyIndex: number;
  start: number;
  end: number;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** Builds the search pattern, or returns an error message for an invalid expression. */
export function buildPattern(options: FindOptions): RegExp | string | null {
  if (options.query === '') return null;
  let source = options.regex
    ? options.query
    : options.acrossTimings
      ? options.query
          .trim()
          .split(/[ \t\n]+/)
          .map(escape)
          .join(ACROSS_TAGS)
      : escape(options.query);
  if (source === '') return null;
  // \b only knows ASCII; words in other scripts need Unicode classes.
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${options.matchCase ? '' : 'i'}`);
  } catch (error) {
    return (error as Error).message;
  }
}

/** Non-empty matches in one text. */
function matchesIn(text: string, pattern: RegExp): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(pattern)) {
    if (m[0] !== '') out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** All matches, in cue table order. */
export function findAll(doc: VttDocument, rows: readonly number[], pattern: RegExp): Match[] {
  const out: Match[] = [];
  for (const bodyIndex of rows) {
    const cue = doc.body[bodyIndex] as Cue;
    for (const m of matchesIn(cue.text, pattern)) out.push({ bodyIndex, ...m });
  }
  return out;
}

/**
 * Index of the first match at or after (`row`, `offset`), wrapping around; -1 if there are none.
 * `rowOf` maps a body index to its row.
 */
export function nextMatch(
  matches: readonly Match[],
  rowOf: (bodyIndex: number) => number,
  row: number,
  offset: number,
): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => {
    const r = rowOf(m.bodyIndex);
    return r > row || (r === row && m.start >= offset);
  });
  return i === -1 ? 0 : i;
}

/** Index of the last match before (`row`, `offset`), wrapping around; -1 if there are none. */
export function previousMatch(
  matches: readonly Match[],
  rowOf: (bodyIndex: number) => number,
  row: number,
  offset: number,
): number {
  if (matches.length === 0) return -1;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i] as Match;
    const r = rowOf(m.bodyIndex);
    if (r < row || (r === row && m.start < offset)) return i;
  }
  return matches.length - 1;
}

/** Expands $-patterns in a regex replacement, as String.prototype.replace does. */
function expand(replacement: string, m: RegExpMatchArray, text: string): string {
  const index = m.index ?? 0;
  return replacement.replace(
    /\$(\$|&|`|'|\d{1,2}|<([^>]*)>)/g,
    (all, token: string, name?: string) => {
      if (token === '$') return '$';
      if (token === '&') return m[0];
      if (token === '`') return text.slice(0, index);
      if (token === "'") return text.slice(index + m[0].length);
      if (name !== undefined) return m.groups ? (m.groups[name] ?? '') : all;
      const n = Number(token);
      if (n >= 1 && n < m.length) return m[n] ?? '';
      // "$12" with fewer than 12 groups means group 1 followed by "2".
      const one = Number(token[0]);
      if (token.length === 2 && one >= 1 && one < m.length) return (m[one] ?? '') + token[1];
      return all;
    },
  );
}

/** Replaces one match in a cue's text. */
export function replaceOne(
  text: string,
  match: { start: number; end: number },
  pattern: RegExp,
  replacement: string,
  regex: boolean,
): string {
  let value = replacement;
  if (regex) {
    // Re-run the pattern at the match so groups and lookarounds see the whole text.
    const sticky = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'y');
    sticky.lastIndex = match.start;
    const m = sticky.exec(text);
    if (m) value = expand(replacement, m, text);
  }
  return text.slice(0, match.start) + value + text.slice(match.end);
}

/** Replaces every non-empty match in the given rows. Returns the new document and the count. */
export function replaceAll(
  doc: VttDocument,
  rows: readonly number[],
  pattern: RegExp,
  replacement: string,
  regex: boolean,
): { doc: VttDocument; count: number } {
  let count = 0;
  const body = [...doc.body];
  for (const bodyIndex of rows) {
    const cue = body[bodyIndex] as Cue;
    let text = '';
    let pos = 0;
    for (const m of cue.text.matchAll(pattern)) {
      if (m[0] === '') continue;
      text +=
        cue.text.slice(pos, m.index) + (regex ? expand(replacement, m, cue.text) : replacement);
      pos = m.index + m[0].length;
      count++;
    }
    if (pos > 0) {
      const next: Cue = { ...cue, text: text + cue.text.slice(pos) };
      delete next.source;
      body[bodyIndex] = next;
    }
  }
  return { doc: count > 0 ? { ...doc, body } : doc, count };
}
