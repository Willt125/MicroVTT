/** WebVTT cue text (spec §4.2.2, parsed by §6.4) as a text dialect. */
import { parseCueText, type CueNode } from '../cuetext.ts';
import { formatTimestamp, parseTimestamp } from '../timestamp.ts';
import type { TextDialect } from './dialect.ts';

const CACHE_LIMIT = 100_000;
const readableCache = new Map<string, string[]>();
const displayCache = new Map<string, string[]>();

/** The text of `nodes`, timestamps left out, and ruby text too unless `ruby`. */
function textOf(nodes: CueNode[], ruby: boolean): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else if (node.type === 'timestamp' || (node.type === 'rt' && !ruby)) continue;
    else out += textOf(node.children, ruby);
  }
  return out;
}

function linesOf(text: string, ruby: boolean, cache: Map<string, string[]>): string[] {
  let lines = cache.get(text);
  if (lines) return lines;
  lines = (/[<&]/.test(text) ? textOf(parseCueText(text).children, ruby) : text).split('\n');
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, lines);
  return lines;
}

/**
 * Calls `fn` for every timestamp tag in raw cue text and splices in its result (a new time in
 * ms, or null to remove the tag). Tags are found the way the cue text tokenizer finds them, so
 * text inside other tags' annotations is never touched.
 */
export function mapTextTimestamps(text: string, fn: (ms: number) => number | null): string {
  let out = '';
  let pos = 0;
  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) break;
    const gt = text.indexOf('>', lt + 1);
    const tagEnd = gt === -1 ? text.length : gt + 1;
    const inner = text.slice(lt + 1, gt === -1 ? text.length : gt);
    out += text.slice(pos, lt);
    const ts = /^[0-9]/.test(inner) ? parseTimestamp(inner) : null;
    if (ts?.ok && ts.end === inner.length) {
      const mapped = fn(ts.ms);
      if (mapped !== null) out += `<${formatTimestamp(Math.max(0, Math.round(mapped)))}>`;
    } else {
      out += text.slice(lt, tagEnd);
    }
    pos = tagEnd;
  }
  return out + text.slice(pos);
}

/** Elements that can be open across a split point (the cue text parser's element names). */
const ELEMENTS = new Set(['c', 'i', 'b', 'u', 'ruby', 'rt', 'v', 'lang']);

interface OpenTag {
  name: string;
  /** The start tag as written, e.g. `<v.loud Bob>`. */
  tag: string;
  at: number;
}

/**
 * Finds where raw cue text can be divided near `offset`: never inside a tag or a character
 * reference, and never just inside an element's start or end tag. Returns the adjusted offset and
 * the elements open there, outermost first.
 */
function splitPoint(text: string, offset: number): { at: number; open: OpenTag[] } {
  let at = Math.max(0, Math.min(text.length, offset));
  // Not inside a character reference ("&amp;" split as "&am" + "p;").
  const amp = text.lastIndexOf('&', at - 1);
  if (amp !== -1 && /^&[#0-9A-Za-z]*$/.test(text.slice(amp, at))) at = amp;
  const open: OpenTag[] = [];
  let pos = 0;
  while (pos < at) {
    const lt = text.indexOf('<', pos);
    if (lt === -1 || lt >= at) break;
    const gt = text.indexOf('>', lt + 1);
    const end = gt === -1 ? text.length : gt + 1;
    if (at < end) {
      at = lt; // Inside a tag: split before it.
      break;
    }
    const inner = text.slice(lt + 1, gt === -1 ? text.length : gt);
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      if (open.at(-1)?.name === name) open.pop();
      else if (name === 'ruby' && open.at(-1)?.name === 'rt' && open.at(-2)?.name === 'ruby')
        open.splice(-2);
    } else {
      const name = /^[^\s./>]*/.exec(inner)?.[0] ?? '';
      if (ELEMENTS.has(name)) open.push({ name, tag: text.slice(lt, end), at: lt });
    }
    pos = end;
  }
  for (;;) {
    const top = open.at(-1);
    if (top && top.at + top.tag.length === at) {
      // Right after a start tag: the element belongs wholly to the second cue.
      at = top.at;
      open.pop();
      continue;
    }
    const close = top && new RegExp(`^</${top.name}\\s*>`).exec(text.slice(at));
    if (top && close) {
      // Right before an end tag: the element belongs wholly to the first cue.
      at += close[0].length;
      open.pop();
      continue;
    }
    return { at, open };
  }
}

export const WEBVTT_TEXT: TextDialect = {
  tag: '<[^>\\n]*>',
  closingTag: '</[^>\\n]*>',
  markupHint: 'WebVTT markup, e.g. <i>, <v Name>, &amp;',
  hasMarkup: (text) => /[<&]/.test(text),
  readableLines: (text) => linesOf(text, false, readableCache),
  displayLines: (text) => linesOf(text, true, displayCache),
  hasItalics: (text) => /<i[\s.>]/.test(text),
  removeItalics: (text) => text.replace(/<\/?i(?:[\s.][^>]*)?>/g, ''),
  splitText(text, offset) {
    const { at, open } = splitPoint(text, offset);
    const closers = open
      .map((t) => `</${t.name}>`)
      .reverse()
      .join('');
    return [
      text.slice(0, at).replace(/[ \t\n]+$/, '') + closers,
      open.map((t) => t.tag).join('') + text.slice(at).replace(/^[ \t\n]+/, ''),
    ];
  },
  mapTimestamps: mapTextTimestamps,
  timestampMarkup: (ms) => `<${formatTimestamp(ms)}>`,
};
