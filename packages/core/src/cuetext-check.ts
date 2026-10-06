/**
 * Strict syntax checks for cue payloads (§4.2): caption/subtitle cue text and chapter title text.
 *
 * This is separate from the lenient cue text parser (§6.4): the parser must accept everything
 * user agents accept, the checker must reject everything the syntax forbids.
 */
import { isValidLanguageTag } from './bcp47.ts';
import type { Diagnostic, DiagnosticCode } from './diagnostics.ts';
import { diagnostic } from './diagnostics.ts';
import { NAMED_CHARACTER_REFERENCES } from './entities.generated.ts';
import { parseTimestamp } from './timestamp.ts';

const TIMESTAMP = /^(?:[0-9]{2,}:)?[0-5][0-9]:[0-5][0-9]\.[0-9]{3}$/;
const SPAN_NAMES = new Set(['c', 'i', 'b', 'u', 'ruby', 'rt', 'v', 'lang']);
const NEEDS_ANNOTATION = new Set(['v', 'lang']);

/** A code point that numeric character references must not produce (HTML syntax). */
function isForbiddenReference(cp: number): boolean {
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return true;
  if (cp === 0x0d) return true;
  const asciiWhitespace = cp === 0x09 || cp === 0x0a || cp === 0x0c || cp === 0x20;
  if ((cp < 0x20 && !asciiWhitespace) || (cp >= 0x7f && cp <= 0x9f)) return true;
  // Noncharacters: U+FDD0–U+FDEF and the last two code points of every plane.
  return (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe;
}

/**
 * Length of a valid character reference at `pos` (pointing at "&"), or 0 if there is none.
 * Valid means HTML's syntax: a known name ending in ";", or a permitted numeric reference with ";".
 */
export function validReferenceLength(text: string, pos: number): number {
  const m = /^&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/.exec(
    text.slice(pos, pos + 40),
  );
  if (!m) return 0;
  if (m[3] !== undefined) return NAMED_CHARACTER_REFERENCES.has(`${m[3]};`) ? m[0].length : 0;
  const digits = (m[1] ?? m[2]) as string;
  const cp = digits.length > 8 ? Infinity : parseInt(digits, m[1] !== undefined ? 10 : 16);
  return isForbiddenReference(cp) ? 0 : m[0].length;
}

interface Frame {
  name: string;
  start: number;
  /** Ruby bookkeeping: completed <rt> groups, and base content seen since the last </rt>. */
  groups: number;
  pendingBase: boolean;
}

class Checker {
  readonly diagnostics: Diagnostic[] = [];
  readonly text: string;
  readonly offset: number;

  constructor(text: string, offset: number) {
    this.text = text;
    this.offset = offset;
  }

  add(code: DiagnosticCode, message: string, start: number, end: number): void {
    this.diagnostics.push(
      diagnostic(code, message, {
        start: this.offset + start,
        end: this.offset + Math.max(end, start + 1),
      }),
    );
  }

  /** Checks "&" at `pos`; returns the index after the reference (or after the "&"). */
  reference(pos: number): number {
    const len = validReferenceLength(this.text, pos);
    if (len > 0) return pos + len;
    const word = /^&#?[A-Za-z0-9]*;?/.exec(this.text.slice(pos))?.[0] ?? '&';
    this.add(
      'cue-text-character-reference',
      `"${word}" is not a valid character reference; write "&" as "&amp;".`,
      pos,
      pos + word.length,
    );
    return pos + 1;
  }
}

/**
 * Checks WebVTT caption or subtitle cue text. `offset` is where the payload starts in the
 * normalized input; times are the cue's, in milliseconds.
 */
export function checkCueText(
  text: string,
  offset: number,
  startMs: number,
  endMs: number,
): Diagnostic[] {
  const c = new Checker(text, offset);
  const stack: Frame[] = [];
  let previousTimestamp = startMs;
  let componentCount = 0;
  let firstWasVoice = false;
  let pos = 0;

  const top = (): Frame | undefined => stack[stack.length - 1];
  const markContent = (isWhitespace: boolean): void => {
    const frame = top();
    if (frame?.name === 'ruby' && !isWhitespace) frame.pendingBase = true;
  };

  while (pos < text.length) {
    const ch = text[pos] as string;
    if (ch === '&') {
      markContent(false);
      if (stack.length === 0) componentCount++;
      pos = c.reference(pos);
      continue;
    }
    if (ch !== '<') {
      // A run of text up to the next "&" or "<".
      let end = pos;
      while (end < text.length && text[end] !== '&' && text[end] !== '<') end++;
      const run = text.slice(pos, end);
      const ws = /^[ \t\n]*$/.test(run);
      markContent(ws);
      if (stack.length === 0 && run.replace(/\n/g, '') !== '') componentCount++;
      pos = end;
      continue;
    }

    // A tag: no tag, class or annotation may contain a line break, so one must end before it.
    const close = text.indexOf('>', pos);
    const lf = text.indexOf('\n', pos);
    if (close === -1 || (lf !== -1 && lf < close)) {
      const end = lf !== -1 && (close === -1 || lf < close) ? lf : text.length;
      c.add(
        'cue-text-tag',
        'This "<" does not start a complete tag; write a literal "<" as "&lt;".',
        pos,
        end,
      );
      markContent(false);
      pos = end;
      continue;
    }
    const raw = text.slice(pos + 1, close);
    const tagStart = pos;
    const tagEnd = close + 1;
    pos = tagEnd;
    if (stack.length === 0) componentCount++;

    // Timestamp tag.
    if (/^[0-9]/.test(raw)) {
      if (!TIMESTAMP.test(raw)) {
        c.add('cue-text-timestamp', `"<${raw}>" is not a valid timestamp.`, tagStart, tagEnd);
        continue;
      }
      const ms = (parseTimestamp(raw) as { ms: number }).ms;
      if (ms <= previousTimestamp || ms >= endMs) {
        const why =
          ms >= endMs
            ? 'is not before the cue end'
            : ms <= startMs
              ? 'is not after the cue start'
              : 'is not after the previous timestamp';
        c.add('cue-text-timestamp', `Timestamp <${raw}> ${why}.`, tagStart, tagEnd);
      } else {
        previousTimestamp = ms;
      }
      continue;
    }

    // End tag.
    if (raw.startsWith('/')) {
      const name = raw.slice(1);
      if (!SPAN_NAMES.has(name)) {
        c.add('cue-text-tag', `"<${raw}>" is not a valid end tag.`, tagStart, tagEnd);
        continue;
      }
      const frame = top();
      if (frame?.name === name) {
        stack.pop();
        if (name === 'rt') {
          const ruby = top();
          if (ruby) {
            ruby.groups++;
            ruby.pendingBase = false;
          }
        } else if (name === 'ruby') {
          checkRubyEnd(c, frame, tagStart, tagEnd);
        }
      } else if (name === 'ruby' && frame?.name === 'rt') {
        // The last </rt> may be omitted.
        stack.pop();
        const ruby = stack.pop() as Frame;
        ruby.groups++;
        ruby.pendingBase = false;
      } else {
        c.add(
          'cue-text-nesting',
          frame
            ? `"</${name}>" does not close the open <${frame.name}>.`
            : `"</${name}>" has no matching start tag.`,
          tagStart,
          tagEnd,
        );
      }
      continue;
    }

    // Start tag: name, classes, optional annotation.
    const m = /^([^\t\n\f\r .>]*)((?:\.[^\t\n\r .]*)*)(?:([ \t])([\s\S]*))?$/.exec(raw);
    const name = m?.[1] ?? '';
    if (!m || !SPAN_NAMES.has(name)) {
      c.add(
        'cue-text-tag',
        `"<${raw}>" is not a valid tag; write a literal "<" as "&lt;".`,
        tagStart,
        tagEnd,
      );
      continue;
    }
    const classes = (m[2] ?? '').split('.').slice(1);
    if (classes.some((cls) => cls === '' || /[&<]/.test(cls))) {
      c.add(
        'cue-text-class',
        `Tag "<${raw}>" has an empty or invalid class name.`,
        tagStart,
        tagEnd,
      );
    }
    const annotation = m[4];
    if (NEEDS_ANNOTATION.has(name)) {
      if (annotation === undefined || !/[^ \t]/.test(decodeReferences(annotation))) {
        c.add(
          'cue-text-annotation',
          `<${name}> needs an annotation, e.g. <${name === 'v' ? 'v Speaker' : 'lang en'}>.`,
          tagStart,
          tagEnd,
        );
      } else {
        checkAnnotation(c, annotation, tagStart + 1 + (raw.length - annotation.length));
        if (name === 'lang' && !isValidLanguageTag(decodeReferences(annotation).trim())) {
          c.add(
            'cue-text-language',
            `"${annotation}" is not a valid BCP 47 language tag.`,
            tagStart,
            tagEnd,
          );
        }
      }
    } else if (annotation !== undefined) {
      c.add('cue-text-annotation', `<${name}> does not take an annotation.`, tagStart, tagEnd);
    }

    if (name === 'rt') {
      const frame = top();
      if (frame?.name !== 'ruby') {
        c.add('cue-text-ruby', '<rt> is only allowed directly inside <ruby>.', tagStart, tagEnd);
        continue; // Parsers ignore it; do not push.
      }
    } else {
      markContent(false);
    }
    if (stack.length === 0 && componentCount === 1 && name === 'v') firstWasVoice = true;
    stack.push({ name, start: tagStart, groups: 0, pendingBase: false });
  }

  // Unclosed spans at the end of the cue.
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i] as Frame;
    const isOnlyVoice = i === 0 && frame.name === 'v' && firstWasVoice && componentCount === 1;
    if (isOnlyVoice) continue;
    c.add(
      'cue-text-nesting',
      `<${frame.name}> is never closed.`,
      frame.start,
      frame.start + 1 + frame.name.length,
    );
  }
  return c.diagnostics;
}

function checkRubyEnd(c: Checker, frame: Frame, start: number, end: number): void {
  if (frame.groups === 0) {
    c.add('cue-text-ruby', 'A <ruby> span needs at least one <rt> annotation.', frame.start, end);
  } else if (frame.pendingBase) {
    c.add('cue-text-ruby', 'Ruby base text must be followed by an <rt> annotation.', start, end);
  }
}

/** Checks references in an annotation; `start` is the annotation's index in the cue text. */
function checkAnnotation(c: Checker, annotation: string, start: number): void {
  for (let i = annotation.indexOf('&'); i !== -1; i = annotation.indexOf('&', i + 1)) {
    if (validReferenceLength(annotation, i) === 0) {
      const word = /^&#?[A-Za-z0-9]*;?/.exec(annotation.slice(i))?.[0] ?? '&';
      c.add(
        'cue-text-character-reference',
        `"${word}" is not a valid character reference.`,
        start + i,
        start + i + word.length,
      );
    }
  }
}

/** Decodes the valid character references in `text` (invalid ones are left as they are). */
function decodeReferences(text: string): string {
  let out = '';
  for (let i = 0; i < text.length;) {
    const len = text[i] === '&' ? validReferenceLength(text, i) : 0;
    if (len === 0) {
      out += text[i];
      i++;
      continue;
    }
    const ref = text.slice(i + 1, i + len - 1);
    out +=
      ref[0] === '#'
        ? String.fromCodePoint(
            parseInt(
              ref.slice(ref[1] === 'x' || ref[1] === 'X' ? 2 : 1),
              ref[1] === 'x' || ref[1] === 'X' ? 16 : 10,
            ),
          )
        : (NAMED_CHARACTER_REFERENCES.get(`${ref};`) as string);
    i += len;
  }
  return out;
}

/** Checks WebVTT chapter title text: text and character references only. */
export function checkChapterTitle(text: string, offset: number): Diagnostic[] {
  const c = new Checker(text, offset);
  for (let pos = 0; pos < text.length;) {
    const ch = text[pos];
    if (ch === '&') {
      pos = c.reference(pos);
    } else if (ch === '<') {
      const close = text.indexOf('>', pos);
      const end = close === -1 ? text.length : close + 1;
      c.add(
        'chapter-title-markup',
        'Chapter titles cannot contain tags or timestamps; write a literal "<" as "&lt;".',
        pos,
        end,
      );
      pos = end;
    } else {
      pos++;
    }
  }
  return c.diagnostics;
}
