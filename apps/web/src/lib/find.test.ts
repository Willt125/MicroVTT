import { describe, expect, it } from 'vitest';
import type { VttDocument } from '@microvtt/core';
import { createCue, createDocument } from '@microvtt/core';
import {
  buildPattern,
  findAll,
  nextMatch,
  previousMatch,
  replaceAll,
  replaceOne,
  type FindOptions,
} from './find.ts';
import { cueAt, loopTarget, sliceDocument, splitOffset, splitTime } from './media.ts';

const opts = (query: string, extra: Partial<FindOptions> = {}): FindOptions => ({
  query,
  matchCase: false,
  wholeWord: false,
  regex: false,
  ...extra,
});

const pattern = (query: string, extra: Partial<FindOptions> = {}): RegExp =>
  buildPattern(opts(query, extra)) as RegExp;

const doc = (...texts: string[]): VttDocument => ({
  ...createDocument(),
  body: texts.map((t, i) => createCue(i * 1000, i * 1000 + 1000, t)),
});

describe('find', () => {
  it('builds literal, case-sensitive, whole-word and regex patterns', () => {
    expect(buildPattern(opts(''))).toBeNull();
    expect(pattern('a.b').test('axb')).toBe(false);
    expect('A.B a.b'.match(pattern('a.b'))).toEqual(['A.B', 'a.b']);
    expect('A.B a.b'.match(pattern('a.b', { matchCase: true }))).toEqual(['a.b']);
    expect('kissa kissat Kissa'.match(pattern('kissa', { wholeWord: true }))).toEqual([
      'kissa',
      'Kissa',
    ]);
    expect('äiti äitiä'.match(pattern('äiti', { wholeWord: true }))).toEqual(['äiti']);
    expect(buildPattern(opts('(', { regex: true }))).toMatch(/Invalid|Unterminated/);
  });

  it('finds matches in table order and steps with wraparound', () => {
    const d = doc('one two', 'two', 'three');
    const rows = [0, 1, 2];
    const matches = findAll(d, rows, pattern('t'));
    expect(matches).toEqual([
      { bodyIndex: 0, start: 4, end: 5 },
      { bodyIndex: 1, start: 0, end: 1 },
      { bodyIndex: 2, start: 0, end: 1 },
    ]);
    const rowOf = (i: number): number => i;
    expect(nextMatch(matches, rowOf, 0, 5)).toBe(1);
    expect(nextMatch(matches, rowOf, 2, 1)).toBe(0); // Wraps.
    expect(previousMatch(matches, rowOf, 1, 0)).toBe(0);
    expect(previousMatch(matches, rowOf, 0, 0)).toBe(2); // Wraps.
    expect(findAll(d, rows, pattern('x*', { regex: true }))).toEqual([]); // No empty matches.
  });

  it('replaces one match and all matches, with $-patterns in regex mode', () => {
    const p = pattern('(\\w+) (\\w+)', { regex: true });
    expect(replaceOne('ab cd ef gh', { start: 6, end: 11 }, p, '$2 $1', true)).toBe('ab cd gh ef');
    expect(replaceOne('a $1 b', { start: 2, end: 4 }, pattern('$1'), '$&!', false)).toBe('a $&! b');
    const d = doc('uh huh', 'no', 'UH');
    const { doc: replaced, count } = replaceAll(
      d,
      [0, 1, 2],
      pattern('uh', { wholeWord: true }),
      '',
      false,
    );
    expect(count).toBe(2);
    expect(replaced.body.map((c) => (c.type === 'cue' ? c.text : ''))).toEqual([' huh', 'no', '']);
    expect(replaced.body[1]).toBe(d.body[1]); // Untouched cues are shared.
    const named = pattern('(?<w>o+)', { regex: true });
    expect(replaceAll(doc('foo'), [0], named, '[$<w>]', true).doc.body[0]).toMatchObject({
      text: 'f[oo]',
    });
    expect(replaceAll(d, [0], pattern('zz'), 'x', false).doc).toBe(d);
  });
});

describe('media helpers', () => {
  it('finds the most recently started cue at a time', () => {
    const d: VttDocument = {
      ...createDocument(),
      body: [
        createCue(0, 5000, 'long'),
        createCue(1000, 2000, 'short'),
        createCue(5000, 6000, 'x'),
      ],
    };
    expect(cueAt(d, [0, 1, 2], 500)).toBe(0);
    expect(cueAt(d, [0, 1, 2], 1500)).toBe(1);
    expect(cueAt(d, [0, 1, 2], 5000)).toBe(2); // End times are exclusive.
    expect(cueAt(d, [0, 1, 2], 7000)).toBe(-1);
  });

  it('slices the cues showing in a time window', () => {
    const d: VttDocument = {
      ...createDocument(),
      body: [createCue(0, 1000, 'a'), { type: 'note', text: 'n' }, createCue(1000, 2000, 'b')],
    };
    expect(sliceDocument(d, 999, 1000).body.map((c) => c.text)).toEqual(['a']);
    expect(sliceDocument(d, 500, 1500).body.map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('loops at the end of the cue', () => {
    const cue = createCue(1000, 2000, '');
    expect(loopTarget(cue, 1500)).toBeNull();
    expect(loopTarget(cue, 2000)).toBe(1000);
    expect(loopTarget(cue, 800)).toBeNull();
    expect(loopTarget(cue, 100)).toBe(1000);
  });

  it('picks a split time from the playhead or the text offset', () => {
    const cue = createCue(1000, 3000, 'abcd');
    expect(splitTime(cue, 1500, 0)).toBe(1500);
    expect(splitTime(cue, 5000, 2)).toBe(2000);
    expect(splitTime(cue, null, 0)).toBe(1001);
    expect(splitTime(createCue(0, 1, 'x'), null, 0)).toBeNull();
  });

  it('splits text at the nearest space outside tags', () => {
    expect(splitOffset('one two three', 0.5)).toBe(7);
    expect(splitOffset('a<c.x y>bc</c>', 0.5)).toBe(7); // No usable space: the ratio point.
    expect(splitOffset('one<00:00:01.000><c> two</c>', 0.9)).toBe(20); // The space inside <c>.
  });
});
