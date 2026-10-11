/**
 * Editing markup in raw cue text: the spans the text has and where they are, wrapping a
 * selection in a span, removing spans, and word timings (karaoke timestamps).
 *
 * Cue text stays a string; these work on it by offset, so everything not touched is kept exactly
 * as written. Spans are found the way players build them: WebVTT by the cue text parser's rules
 * (§6.4: an end tag closes only the element it names when that is the current one), SubRip the
 * way its players read tags (case-insensitive, an end tag closes the latest span it names).
 */
import { isValidLanguageTag } from './bcp47.ts';
import { formatTimestamp, parseTimestamp } from './timestamp.ts';

/** Which markup the text is written in. */
export type MarkupKind = 'webvtt' | 'srt';

export interface TextRange {
  start: number;
  end: number;
}

export interface MarkupSpan {
  /** Element name, lower case: c, i, b, u, v, lang, ruby, rt (WebVTT); i, b, u, s, font (SubRip). */
  name: string;
  /** The start tag as written. */
  tag: string;
  classes: string[];
  /** The voice name, language tag, or a SubRip font tag's attributes; '' when none. */
  annotation: string;
  /** Where the start tag is. */
  open: TextRange;
  /** Where the end tag is, or null when the span is closed without one (at the end of the text, or by </ruby>). */
  close: TextRange | null;
  /** The span's content, between its tags. */
  inner: TextRange;
}

/** The span plus its tags. */
export const outerRange = (span: MarkupSpan): TextRange => ({
  start: span.open.start,
  end: span.close?.end ?? span.inner.end,
});

const WEBVTT_ELEMENTS = new Set(['c', 'i', 'b', 'u', 'v', 'lang', 'ruby', 'rt']);
const SRT_ELEMENTS = new Set(['i', 'b', 'u', 's', 'font']);
const SRT_TAG = /<(\/?)([a-zA-Z]+)(\s[^>\n]*)?>/g;
const SRT_ONE_TAG = /^<\/?[a-zA-Z]+(?:\s[^>\n]*)?>$/;

interface Building {
  span: MarkupSpan;
  /** Index in the result, for setting its end. */
  index: number;
}

/** Every span in `text`, in the order their start tags appear. */
export function markupSpans(text: string, kind: MarkupKind = 'webvtt'): MarkupSpan[] {
  return kind === 'srt' ? srtSpans(text) : webvttSpans(text);
}

function webvttSpans(text: string): MarkupSpan[] {
  const out: MarkupSpan[] = [];
  const stack: Building[] = [];
  const end = (b: Building, at: number, close: TextRange | null): void => {
    b.span.inner.end = at;
    b.span.close = close;
  };
  let pos = 0;
  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) break;
    const gt = text.indexOf('>', lt + 1);
    const tagEnd = gt === -1 ? text.length : gt + 1;
    const inner = text.slice(lt + 1, gt === -1 ? text.length : gt);
    pos = tagEnd;
    if (inner.startsWith('/')) {
      const name = inner.slice(1);
      const top = stack.at(-1);
      if (top?.span.name === name) {
        end(top, lt, { start: lt, end: tagEnd });
        stack.pop();
      } else if (name === 'ruby' && top?.span.name === 'rt' && stack.at(-2)?.span.name === 'ruby') {
        end(top, lt, null);
        end(stack.at(-2) as Building, lt, { start: lt, end: tagEnd });
        stack.splice(-2);
      }
      continue;
    }
    if (/^[0-9]/.test(inner)) continue; // A timestamp.
    const m = /^([^\s./]*)((?:\.[^\s.]*)*)(?:\s([\s\S]*))?$/.exec(inner);
    const name = m?.[1] ?? '';
    if (!WEBVTT_ELEMENTS.has(name)) continue;
    if (name === 'rt' && stack.at(-1)?.span.name !== 'ruby') continue;
    const span: MarkupSpan = {
      name,
      tag: text.slice(lt, tagEnd),
      classes: (m?.[2] ?? '').split('.').filter((c) => c !== ''),
      annotation: name === 'v' || name === 'lang' ? (m?.[3] ?? '').trim().replace(/\s+/g, ' ') : '',
      open: { start: lt, end: tagEnd },
      close: null,
      inner: { start: tagEnd, end: text.length },
    };
    stack.push({ span, index: out.length });
    out.push(span);
  }
  return out;
}

function srtSpans(text: string): MarkupSpan[] {
  const out: MarkupSpan[] = [];
  const open: MarkupSpan[] = [];
  for (const m of text.matchAll(SRT_TAG)) {
    const name = (m[2] as string).toLowerCase();
    if (!SRT_ELEMENTS.has(name)) continue;
    const range = { start: m.index, end: m.index + m[0].length };
    if (m[1] === '/') {
      const i = open.map((s) => s.name).lastIndexOf(name);
      if (i === -1) continue;
      const span = open[i] as MarkupSpan;
      span.inner.end = range.start;
      span.close = range;
      open.splice(i, 1);
      continue;
    }
    const span: MarkupSpan = {
      name,
      tag: m[0],
      classes: [],
      annotation: name === 'font' ? (m[3] ?? '').trim() : '',
      open: range,
      close: null,
      inner: { start: range.end, end: text.length },
    };
    open.push(span);
    out.push(span);
  }
  return out;
}

/** The spans the range `start`..`end` (or the caret, when they are equal) is inside, outermost first. */
export function spansAt(
  text: string,
  start: number,
  end = start,
  kind: MarkupKind = 'webvtt',
): MarkupSpan[] {
  return markupSpans(text, kind).filter((s) => s.inner.start <= start && end <= s.inner.end);
}

/** Moves `at` out of a tag (and in WebVTT, a character reference), towards `side`. */
function snap(text: string, at: number, side: 'before' | 'after', kind: MarkupKind): number {
  const lt = text.lastIndexOf('<', at - 1);
  if (lt !== -1) {
    const gt = text.indexOf('>', lt + 1);
    const tagEnd = gt === -1 ? text.length : gt + 1;
    const isTag = kind === 'webvtt' || SRT_ONE_TAG.test(text.slice(lt, tagEnd));
    if (isTag && at > lt && at < tagEnd) return side === 'before' ? lt : tagEnd;
  }
  if (kind === 'srt') {
    // An override block, e.g. {\an8}.
    const brace = text.lastIndexOf('{', at - 1);
    const block = brace === -1 ? null : /^\{\\[^}\n]*\}/.exec(text.slice(brace));
    if (block && at > brace && at < brace + block[0].length)
      return side === 'before' ? brace : brace + block[0].length;
  }
  if (kind === 'webvtt') {
    const amp = text.lastIndexOf('&', at - 1);
    const ref = amp === -1 ? null : /^&[#0-9A-Za-z]*;?/.exec(text.slice(amp));
    if (ref && at > amp && at < amp + ref[0].length)
      return side === 'before' ? amp : amp + ref[0].length;
  }
  return at;
}

/**
 * The range `start`..`end` moved out of tags and character references, and grown until no span
 * crosses its edges (a span starting inside and ending outside it, or the other way round), so
 * that markup put around it stays well-formed.
 */
export function wellFormedRange(
  text: string,
  start: number,
  end: number,
  kind: MarkupKind = 'webvtt',
): TextRange {
  let a = snap(text, Math.min(start, end), 'before', kind);
  let b = snap(text, Math.max(start, end), 'after', kind);
  const spans = markupSpans(text, kind);
  for (let changed = true; changed;) {
    changed = false;
    for (const s of spans) {
      const o = outerRange(s);
      // One edge inside the span, the other outside it or on its end tag. (A span closed
      // without an end tag runs to the end of its parent, so ending there is inside it.)
      const past = s.close ? b >= o.end : b > o.end;
      const ruby =
        s.name === 'rt' && a <= o.start && b > o.start
          ? spans
              .filter((r) => r.name === 'ruby' && r.inner.start <= o.start && o.start < r.inner.end)
              .at(-1)
          : undefined;
      if (ruby) {
        // Ruby text must stay directly inside its ruby: take the whole ruby.
        const ro = outerRange(ruby);
        if (ro.start >= a && ro.end <= b) continue;
        a = Math.min(a, ro.start);
        b = Math.max(b, ro.end);
      } else if (a > o.start && a < o.end && past) a = o.start;
      else if (a <= o.start && b > o.start && b < o.end) b = o.end;
      else continue;
      changed = true;
    }
  }
  return { start: a, end: b };
}

/** Text with a change, and the range to select afterwards. */
export interface MarkupEdit {
  text: string;
  start: number;
  end: number;
}

/**
 * Puts `before` and `after` around `start`..`end` (grown to a well-formed range first), and
 * returns the new text with the wrapped content selected (the caret between the tags when the
 * range is empty).
 */
export function wrapRange(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
  kind: MarkupKind = 'webvtt',
): MarkupEdit {
  const r = wellFormedRange(text, start, end, kind);
  return {
    text: text.slice(0, r.start) + before + text.slice(r.start, r.end) + after + text.slice(r.end),
    start: r.start + before.length,
    end: r.end + before.length,
  };
}

/** Removes a span's tags and keeps its content; ruby text (`rt`) goes with its tags, content and all. */
export function removeSpan(text: string, span: MarkupSpan, kind: MarkupKind = 'webvtt'): string {
  return cut(text, spanCuts(text, span, kind));
}

/** What `removeSpan` takes out. */
function spanCuts(text: string, span: MarkupSpan, kind: MarkupKind): TextRange[] {
  const cuts: TextRange[] = [];
  if (span.name === 'rt') cuts.push(outerRange(span));
  else {
    cuts.push(span.open);
    if (span.close) cuts.push(span.close);
    if (span.name === 'ruby')
      for (const s of markupSpans(text, kind))
        if (s.name === 'rt' && s.open.start >= span.inner.start && s.open.start < span.inner.end)
          cuts.push(outerRange(s));
  }
  return cuts;
}

/** `text` with the ranges removed (they may nest or touch). */
function cut(text: string, ranges: TextRange[]): string {
  const sorted = [...ranges].sort((x, y) => x.start - y.start);
  let out = '';
  let pos = 0;
  for (const r of sorted) {
    if (r.start > pos) out += text.slice(pos, r.start);
    pos = Math.max(pos, r.end);
  }
  return out + text.slice(pos);
}

/** Where offset `at` goes once `ranges` are cut out. */
const afterCuts = (ranges: TextRange[], at: number): number =>
  at - ranges.reduce((n, c) => n + Math.max(0, Math.min(at, c.end) - c.start), 0);

const endTag = (span: MarkupSpan, kind: MarkupKind): string =>
  kind === 'srt'
    ? `</${span.tag.slice(1).match(/^[a-zA-Z]+/)?.[0] ?? span.name}>`
    : `</${span.name}>`;

/**
 * Takes the range `start`..`end` out of `span`: the whole span is removed when the range is
 * empty or covers all its content; otherwise the span is closed before the range and reopened
 * after it (and any spans inside it that the range is in, too), so `<i>a|b|c</i>` becomes
 * `<i>a</i>b<i>c</i>`.
 */
export function unwrapRange(
  text: string,
  span: MarkupSpan,
  start: number,
  end: number,
  kind: MarkupKind = 'webvtt',
): MarkupEdit {
  const r = wellFormedRange(text, start, end, kind);
  if (r.start === r.end || (r.start <= span.inner.start && r.end >= span.inner.end)) {
    const cuts = spanCuts(text, span, kind);
    return { text: cut(text, cuts), start: afterCuts(cuts, r.start), end: afterCuts(cuts, r.end) };
  }
  const a = Math.max(r.start, span.inner.start);
  const b = Math.min(r.end, span.inner.end);
  // Spans inside `span` that the range is in: closed and reopened around it too.
  const between = spansAt(text, a, b, kind).filter(
    (s) => s.open.start > span.open.start && s.open.start < span.inner.end,
  );
  if (a === span.inner.start || b === span.inner.end)
    return unwrapAtEdge(text, span, a, b, between, kind, a === span.inner.start);
  const closeAll = [...between]
    .reverse()
    .map((s) => endTag(s, kind))
    .join('');
  const reopen = between.map((s) => s.tag).join('');
  const head = closeAll + endTag(span, kind) + reopen;
  const tail = closeAll + span.tag + reopen;
  const out = text.slice(0, a) + head + text.slice(a, b) + tail + text.slice(b);
  return { text: out, start: a + head.length, end: b + head.length };
}

function unwrapAtEdge(
  text: string,
  span: MarkupSpan,
  a: number,
  b: number,
  between: MarkupSpan[],
  kind: MarkupKind,
  atStart: boolean,
): MarkupEdit {
  const closeAll = [...between]
    .reverse()
    .map((s) => endTag(s, kind))
    .join('');
  const reopen = between.map((s) => s.tag).join('');
  if (atStart) {
    // <i>|ab|c</i> → ab<i>c</i>: the start tag moves to after the range.
    const insert = closeAll + span.tag + reopen;
    const withTag = text.slice(0, b) + insert + text.slice(b);
    const out = withTag.slice(0, span.open.start) + withTag.slice(span.open.end);
    const shift = span.open.end - span.open.start;
    return { text: out, start: a - shift, end: b - shift };
  }
  // <i>a|bc|</i> → <i>a</i>bc: the end tag moves to before the range.
  const insert = closeAll + endTag(span, kind) + reopen;
  const close = span.close;
  let out = close ? text.slice(0, close.start) + text.slice(close.end) : text;
  out = out.slice(0, a) + insert + out.slice(a);
  return { text: out, start: a + insert.length, end: b + insert.length };
}

/**
 * Removes the spans whose content lies wholly in `start`..`end` (the whole text when the range
 * is empty). Word timings and character references are kept.
 */
export function clearMarkup(
  text: string,
  start: number,
  end: number,
  kind: MarkupKind = 'webvtt',
): MarkupEdit {
  const r =
    start === end ? { start: 0, end: text.length } : wellFormedRange(text, start, end, kind);
  const spans = markupSpans(text, kind).filter(
    (s) => s.inner.start >= r.start && s.inner.end <= r.end,
  );
  const cuts = spans.flatMap((s) =>
    s.name === 'rt' ? [outerRange(s)] : [s.open, ...(s.close ? [s.close] : [])],
  );
  return { text: cut(text, cuts), start: afterCuts(cuts, r.start), end: afterCuts(cuts, r.end) };
}

/** Text as WebVTT cue text: `&` and `<` escaped. */
export const escapeCueText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A voice name or language tag as a WebVTT tag annotation: `&` and `>` escaped, one line. */
export const escapeAnnotation = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').replace(/&/g, '&amp;').replace(/>/g, '&gt;');

/** Why `name` cannot be a WebVTT class name, or null. */
export function classProblem(name: string): string | null {
  if (name === '') return 'Enter a class name.';
  if (/[\s.<>&]/.test(name)) return 'A class name cannot contain spaces, ".", "<", ">" or "&".';
  return null;
}

/** Why `tag` cannot be a `<lang>` tag's language, or null. */
export function languageProblem(tag: string): string | null {
  if (tag.trim() === '') return 'Enter a language tag, e.g. fr or pt-BR.';
  return isValidLanguageTag(tag.trim()) ? null : `"${tag.trim()}" is not a BCP 47 language tag.`;
}

/** WebVTT start and end tags for a span. */
export function spanTags(
  span:
    | { name: 'i' | 'b' | 'u' }
    | { name: 'c'; classes: string[] }
    | { name: 'v'; voice: string; classes?: string[] }
    | { name: 'lang'; language: string }
    | { name: 'ruby'; annotation: string },
): [string, string] {
  switch (span.name) {
    case 'c':
      return [`<c${span.classes.map((c) => `.${c}`).join('')}>`, '</c>'];
    case 'v':
      return [
        `<v${(span.classes ?? []).map((c) => `.${c}`).join('')} ${escapeAnnotation(span.voice)}>`,
        '</v>',
      ];
    case 'lang':
      return [`<lang ${escapeAnnotation(span.language)}>`, '</lang>'];
    case 'ruby':
      return ['<ruby>', `<rt>${escapeCueText(span.annotation)}</rt></ruby>`];
    default:
      return [`<${span.name}>`, `</${span.name}>`];
  }
}

// Word timings.

/** A timestamp tag in WebVTT cue text. */
export interface TimestampTag extends TextRange {
  ms: number;
}

/** The timestamp tags in `text`, in order, found as the cue text tokenizer finds them. */
export function timestampTags(text: string): TimestampTag[] {
  const out: TimestampTag[] = [];
  let pos = 0;
  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) break;
    const gt = text.indexOf('>', lt + 1);
    const tagEnd = gt === -1 ? text.length : gt + 1;
    const inner = text.slice(lt + 1, gt === -1 ? text.length : gt);
    const ts = /^[0-9]/.test(inner) ? parseTimestamp(inner) : null;
    if (ts?.ok && ts.end === inner.length) out.push({ ms: ts.ms, start: lt, end: tagEnd });
    pos = tagEnd;
  }
  return out;
}

const timestampTag = (ms: number): string => `<${formatTimestamp(Math.max(0, Math.round(ms)))}>`;

/** `text` with its `index`th timestamp set to `ms`. */
export function setTimestamp(text: string, index: number, ms: number): string {
  const tag = timestampTags(text)[index];
  if (!tag) throw new RangeError(`No timestamp ${index + 1} in the text.`);
  return text.slice(0, tag.start) + timestampTag(ms) + text.slice(tag.end);
}

/** `text` without its `index`th timestamp. */
export function removeTimestamp(text: string, index: number): string {
  const tag = timestampTags(text)[index];
  if (!tag) throw new RangeError(`No timestamp ${index + 1} in the text.`);
  return text.slice(0, tag.start) + text.slice(tag.end);
}

/** `text` without timestamps. */
export const removeTimestamps = (text: string): string => cut(text, timestampTags(text));

/** Inserts a timestamp for `ms` at `offset` (moved out of a tag or reference), returning the caret after it. */
export function insertTimestamp(
  text: string,
  offset: number,
  ms: number,
): { text: string; caret: number } {
  const at = snap(text, offset, 'before', 'webvtt');
  const tag = timestampTag(ms);
  return { text: text.slice(0, at) + tag + text.slice(at), caret: at + tag.length };
}

/** Problems with a cue's word timings: each must be after the one before and inside the cue. */
export function timestampProblems(
  text: string,
  startMs: number,
  endMs: number,
): { index: number; message: string }[] {
  const out: { index: number; message: string }[] = [];
  let previous = startMs;
  timestampTags(text).forEach((t, index) => {
    if (t.ms <= startMs || t.ms >= endMs)
      out.push({ index, message: 'Not inside the cue (after its start, before its end).' });
    else if (t.ms <= previous) out.push({ index, message: 'Not after the timing before it.' });
    else previous = t.ms; // Only timings inside the cue are what the next must follow.
  });
  return out;
}

function wordSegmenter(language: string | undefined): Intl.Segmenter {
  try {
    return new Intl.Segmenter(language, { granularity: 'word' });
  } catch {
    return new Intl.Segmenter(undefined, { granularity: 'word' }); // Not a tag Intl knows.
  }
}

const SIMPLE_REFS: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0' };

/**
 * The words of `text` as a viewer reads them (markup, timestamps and ruby text left out), with
 * the raw offset each starts at. Words are what `Intl.Segmenter` finds, so text without spaces
 * (Chinese, Japanese, Thai) is divided into words too.
 */
export function cueWords(text: string, language?: string): { word: string; start: number }[] {
  let readable = '';
  const at: number[] = [];
  let rtDepth = 0;
  let pos = 0;
  while (pos < text.length) {
    const ch = text[pos] as string;
    if (ch === '<') {
      const gt = text.indexOf('>', pos + 1);
      const tagEnd = gt === -1 ? text.length : gt + 1;
      const inner = text.slice(pos + 1, tagEnd - 1);
      if (/^rt(?:[\s.]|$)/.test(inner)) rtDepth++;
      else if (inner === '/rt' || inner === '/ruby') rtDepth = Math.max(0, rtDepth - 1);
      pos = tagEnd;
      continue;
    }
    if (ch === '&') {
      const ref = /^&(#?[0-9A-Za-z]+);/.exec(text.slice(pos));
      if (ref) {
        if (rtDepth === 0) {
          readable += SIMPLE_REFS[ref[1] as string] ?? 'x';
          at.push(pos);
        }
        pos += ref[0].length;
        continue;
      }
    }
    if (rtDepth === 0) {
      readable += ch;
      at.push(pos);
    }
    pos++;
  }
  const out: { word: string; start: number }[] = [];
  for (const s of wordSegmenter(language).segment(readable))
    if (s.isWordLike) out.push({ word: s.segment, start: at[s.index] as number });
  return out;
}

/**
 * Times the words of `text`: removes its timestamps, then puts `times[i]` before word `i + 1`
 * (the first word starts with the cue). Extra times are ignored.
 */
export function timeWords(text: string, times: readonly number[], language?: string): string {
  const plain = removeTimestamps(text);
  const words = cueWords(plain, language).slice(1, times.length + 1);
  let out = plain;
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i] as { start: number };
    out = out.slice(0, w.start) + timestampTag(times[i] as number) + out.slice(w.start);
  }
  return out;
}

/**
 * Times for each word after the first, spreading the cue's time across its words by their
 * length (a long word is sung for longer), for `timeWords`.
 */
export function spreadWordTimes(
  text: string,
  startMs: number,
  endMs: number,
  language?: string,
): number[] {
  const words = cueWords(removeTimestamps(text), language);
  const lengths = words.map((w) => [...w.word].length);
  const total = lengths.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let done = 0;
  for (let i = 0; i < words.length - 1; i++) {
    done += lengths[i] as number;
    out.push(Math.round(startMs + ((endMs - startMs) * done) / total));
  }
  return out;
}
