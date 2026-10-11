/**
 * SubRip cue text as players read it: HTML-like tags (`<b>`, `<i>`, `<u>`, `<s>`, `<font>`) and
 * override blocks in braces borrowed from ASS (`{\an8}` for the position, `{\i1}` … `{\i0}`).
 * Everything else, `&` and a stray `<` included, is plain text.
 */
import type { TextDialect } from '../format/dialect.ts';

/** One tag players know, or one override block (any `{\…}`). */
const TAG = String.raw`</?(?:[bBiIuUsS]|[fF][oO][nN][tT])(?:\s[^>\n]*)?>|\{\\[^}\n]*\}`;
const CLOSING = String.raw`</(?:[bBiIuUsS]|[fF][oO][nN][tT])\s*>|\{\\[bius]0\}`;

const TAG_RE = new RegExp(TAG, 'g');
const ANCHOR_RE = /\{\\an([1-9])\}/;

/** Override blocks that set a style for the rest of the cue: `{\i1}` on, `{\i0}` off. */
const TOGGLE_RE = /^\{\\([bius])([01])\}$/;

/** The text with the markup removed. */
const strip = (text: string): string => text.replace(TAG_RE, '');

/** The position a cue's `{\anN}` block gives (numeric keypad layout: 1 bottom left … 9 top right), or null. */
export function srtAnchor(text: string): number | null {
  const m = ANCHOR_RE.exec(text);
  return m ? Number(m[1]) : null;
}

/** The text with its position set to `anchor` (2, bottom centre, is the default and written as none). */
export function withSrtAnchor(text: string, anchor: number | null): string {
  const rest = text.replace(/\{\\an[1-9]\}/g, '');
  return anchor === null || anchor === 2 ? rest : `{\\an${anchor}}${rest}`;
}

interface Open {
  name: string;
  /** The tag that opened it, to reopen it with. */
  tag: string;
}

/**
 * Divides SubRip text near `offset`: never inside a tag; elements open at the split are closed
 * in the first part and reopened in the second, and the second keeps the cue's position.
 */
function splitText(text: string, offset: number): [string, string] {
  let at = Math.max(0, Math.min(text.length, offset));
  const tags = [...text.matchAll(TAG_RE)];
  for (const m of tags) {
    if (m.index < at && at < m.index + m[0].length) at = m.index;
  }
  const open: Open[] = [];
  const toggles = new Map<string, boolean>();
  for (const m of tags) {
    if (m.index >= at) break;
    const tag = m[0];
    const toggle = TOGGLE_RE.exec(tag);
    if (toggle) {
      toggles.set(toggle[1] as string, toggle[2] === '1');
    } else if (tag.startsWith('</')) {
      const name = tag.slice(2, -1).trim().toLowerCase();
      const i = open.map((o) => o.name).lastIndexOf(name);
      if (i !== -1) open.splice(i, 1);
    } else if (tag.startsWith('<')) {
      open.push({ name: /^<([a-zA-Z]+)/.exec(tag)?.[1]?.toLowerCase() ?? '', tag });
    }
  }
  const on = [...toggles].filter(([, v]) => v).map(([k]) => k);
  const anchor = srtAnchor(text.slice(0, at));
  const before =
    text.slice(0, at).replace(/[ \t\n]+$/, '') +
    open
      .map((o) => `</${o.name}>`)
      .reverse()
      .join('') +
    on.map((k) => `{\\${k}0}`).join('');
  const after =
    (anchor === null ? '' : `{\\an${anchor}}`) +
    on.map((k) => `{\\${k}1}`).join('') +
    open.map((o) => o.tag).join('') +
    text.slice(at).replace(/^[ \t\n]+/, '');
  return [before, after];
}

export const SRT_TEXT: TextDialect = {
  tag: TAG,
  closingTag: CLOSING,
  markupHint: 'SubRip markup, e.g. <i>, <font color="yellow">, {\\an8} for the top',
  hasMarkup: (text) => new RegExp(TAG).test(text),
  readableLines: (text) => strip(text).split('\n'),
  displayLines: (text) => strip(text).split('\n'),
  hasItalics: (text) => /<i>|\{\\i1\}/i.test(text),
  removeItalics: (text) => text.replace(/<\/?i>|\{\\i[01]\}/gi, ''),
  splitText,
  mapTimestamps: (text) => text,
  timestampMarkup: () => '',
};
