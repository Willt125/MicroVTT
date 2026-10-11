/**
 * The format seam: WebVTT's text dialect, and the shared operations (editing, quality fixes)
 * driven by another dialect, so that nothing common assumes WebVTT markup.
 */
import { describe, expect, it } from 'vitest';
import type { QualityRuleId, Ruleset, TextDialect, VttDocument } from '../src/index.ts';
import {
  WEBVTT,
  WEBVTT_TEXT,
  applyQualityFix,
  checkQuality,
  createCue,
  createDocument,
  formatOf,
  mergeCues,
  shiftCues,
  splitCue,
  textTimestamps,
} from '../src/index.ts';

/**
 * A dialect with override blocks in braces (`{\an8}`, `{\i1}` … `{\i0}`) and no word timings,
 * like SubRip's; spans are not closed and reopened at a split, which is enough here.
 */
const BRACES: TextDialect = {
  tag: '\\{[^}\\n]*\\}',
  closingTag: '\\{\\\\i0\\}',
  markupHint: 'braces',
  hasMarkup: (text) => /[{]/.test(text),
  readableLines: (text) => text.replace(/\{[^}\n]*\}/g, '').split('\n'),
  displayLines: (text) => text.replace(/\{[^}\n]*\}/g, '').split('\n'),
  hasItalics: (text) => text.includes('{\\i1}'),
  removeItalics: (text) => text.replace(/\{\\i[01]\}/g, ''),
  splitText: (text, offset) => [text.slice(0, offset).trimEnd(), text.slice(offset).trimStart()],
  mapTimestamps: (text) => text,
  timestampMarkup: () => '',
};

const doc = (...texts: string[]): VttDocument => ({
  ...createDocument(),
  body: texts.map((t, i) => createCue(i * 2000, i * 2000 + 1500, t)),
});

const only = (id: QualityRuleId, params?: Record<string, number>): Ruleset => ({
  id: 'test',
  name: 'Test',
  description: '',
  sources: [],
  notChecked: [],
  rules: { [id]: { severity: 'warning', ...(params ? { params } : {}) } },
});

describe('WebVTT text', () => {
  it('reads, displays and edits WebVTT cue text', () => {
    const text = '<ruby>漢<rt>かん</rt></ruby> <i>a&amp;b</i>';
    expect(WEBVTT_TEXT.readableLines(text)).toEqual(['漢 a&b']);
    expect(WEBVTT_TEXT.displayLines(text)).toEqual(['漢かん a&b']);
    expect(WEBVTT_TEXT.hasMarkup('plain')).toBe(false);
    expect(WEBVTT_TEXT.hasItalics(text)).toBe(true);
    expect(WEBVTT_TEXT.removeItalics(text)).toBe('<ruby>漢<rt>かん</rt></ruby> a&amp;b');
    expect(WEBVTT_TEXT.splitText('<i>one two</i>', 7)).toEqual(['<i>one</i>', '<i>two</i>']);
    expect(textTimestamps(WEBVTT_TEXT, 'a<00:00:01.000> b<00:00:02.500>')).toEqual([1000, 2500]);
    expect(WEBVTT_TEXT.timestampMarkup(1500)).toBe('<00:00:01.500>');
  });

  it('recognises WebVTT files', () => {
    expect(formatOf('a.txt', 'WEBVTT\n\n')).toBe(WEBVTT);
    expect(formatOf('a.vtt', '')).toBe(WEBVTT);
    expect(formatOf('a.txt', 'hello')).toBe(WEBVTT); // Read as WebVTT, which reports the problem.
  });
});

describe('shared operations with another dialect', () => {
  it('splits, merges and retimes through the dialect', () => {
    const split = splitCue(doc('{\\an8}one two'), 0, 700, 10, BRACES);
    expect(split.body.map((c) => c.type === 'cue' && c.text)).toEqual(['{\\an8}one', 'two']);
    // No word timings in this dialect: nothing is added at the join.
    const merged = mergeCues(doc('one', 'two'), 0, 1, BRACES);
    expect(merged.body[0]?.type === 'cue' && merged.body[0].text).toBe('one\ntwo');
    // Text that looks like a WebVTT timestamp is just text here.
    const shifted = shiftCues(doc('at <00:00:01.000>'), 1000, undefined, BRACES);
    expect(shifted.body[0]?.type === 'cue' && shifted.body[0].text).toBe('at <00:00:01.000>');
  });

  it('measures what is read and keeps the markup in fixes', () => {
    const d = doc('{\\an8}-Hi\n{\\an8}-Hello');
    const [finding] = checkQuality(
      d,
      only('speaker-hyphen', { space: 1 }),
      {},
      { dialect: BRACES },
    );
    expect(finding?.message).toBe('A speaker hyphen with no space after it.');
    const fixed = applyQualityFix(d, finding!);
    expect(fixed.body[0]?.type === 'cue' && fixed.body[0].text).toBe('{\\an8}- Hi\n{\\an8}- Hello');
    // Plain-text rewrites are offered only when the text has no markup in this dialect: here a
    // "<" is just a character, and the cue can be joined.
    const join = checkQuality(doc('a <b\nc'), only('single-line'), {}, { dialect: BRACES });
    expect(join[0]?.fix?.change).toEqual({ kind: 'text', text: 'a <b c' });
    expect(checkQuality(doc('a <b\nc'), only('single-line'))[0]?.fix).toBeUndefined();
  });

  it('applies CJK fixes outside the dialect’s tags', () => {
    const d = doc('{\\an8}本当?');
    const [finding] = checkQuality(d, only('ja-punctuation'), {}, { dialect: BRACES });
    const fixed = finding && applyQualityFix(d, finding);
    expect(fixed?.body[0]?.type === 'cue' && fixed.body[0].text).toBe('{\\an8}本当？');
  });
});
