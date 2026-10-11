/** Roll-up captions made from ordinary cues: regions that scroll up, or repeated lines. */
import { describe, expect, it } from 'vitest';
import type { Cue, VttDocument } from '../src/index.ts';
import {
  SRT_TEXT,
  createCue,
  createDocument,
  cueLines,
  makeRollUp,
  serialize,
  styleSheetProblems,
  validate,
} from '../src/index.ts';

const doc = (): VttDocument => ({
  ...createDocument(),
  body: [
    createCue(1000, 5000, 'Welcome back to\n<00:00:03.100>the workshop.'),
    createCue(5000, 9000, 'Today we build\n<i>a bench</i>.'),
    createCue(9100, 12000, 'With <00:00:10.000>care.'),
    createCue(15000, 17000, 'After a pause.'),
  ],
});
const cuesOf = (d: VttDocument): Cue[] => d.body.filter((i): i is Cue => i.type === 'cue');
const rows = (d: VttDocument): [number, number, string][] =>
  cuesOf(d).map((c) => [c.startMs, c.endMs, c.text]);

describe('the lines of a cue', () => {
  it('times each line from the word timing before it, or by length', () => {
    const [timed, spread] = [0, 1].map((i) => cueLines(doc().body[i] as Cue, i));
    expect(timed?.map((l) => [l.text, l.startMs])).toEqual([
      ['Welcome back to', 1000],
      ['<00:00:03.100>the workshop.', 3100],
    ]);
    // "Today we build" is 14 of the cue's 22 characters.
    expect(spread?.map((l) => [l.text, l.startMs])).toEqual([
      ['Today we build', 5000],
      ['<i>a bench</i>.', 7545],
    ]);
  });

  it('closes and reopens spans across a line break', () => {
    const lines = cueLines(createCue(0, 2000, '<i>one\ntwo</i>'), 0);
    expect(lines.map((l) => l.text)).toEqual(['<i>one</i>', '<i>two</i>']);
  });
});

describe('making roll-up captions', () => {
  it('writes one-line cues in a scroll:up region, each shown until pushed out', () => {
    const r = makeRollUp(doc(), [0, 1, 2, 3]);
    expect(r).toMatchObject({ lines: 6, cues: 6, region: 'rollup' });
    expect(r.document.head).toContainEqual(
      expect.objectContaining({ type: 'region', id: 'rollup', lines: 3, scroll: 'up' }),
    );
    expect(rows(r.document)).toEqual([
      [1000, 7545, 'Welcome back to'],
      [3100, 9100, 'the workshop.'],
      [5000, 12000, 'Today we build'],
      [7545, 12000, '<i>a bench</i>.'],
      [9100, 12000, 'With <00:00:10.000>care.'],
      // A pause clears the screen.
      [15000, 17000, 'After a pause.'],
    ]);
    expect(cuesOf(r.document).every((c) => c.region === 'rollup' && c.line === 'auto')).toBe(true);
    // Each line keeps its own background, as pop-on cues do, rather than the region's box.
    const sheets = r.document.head.flatMap((h) => (h.type === 'style' ? [h.css] : []));
    expect(sheets).toEqual(['::cue-region(#rollup) {\n  background: transparent;\n}']);
    expect(styleSheetProblems(sheets[0] as string)).toEqual([]);
    const boxed = makeRollUp(doc(), [0, 1, 2, 3], { lineBackgrounds: false }).document;
    expect(boxed.head.some((h) => h.type === 'style')).toBe(false);
    expect(validate(serialize(r.document)).diagnostics).toEqual([]);
  });

  it('writes cues that repeat the lines before them, for players without regions', () => {
    const r = makeRollUp(doc(), [0, 1, 2, 3], { form: 'repeat', lines: 2 });
    expect(r.region).toBeNull();
    expect(r.document.head).toEqual([]);
    expect(rows(r.document)).toEqual([
      [1000, 3100, 'Welcome back to'],
      [3100, 5000, 'Welcome back to\nthe workshop.'],
      [5000, 7545, 'the workshop.\nToday we build'],
      [7545, 9100, 'Today we build\n<i>a bench</i>.'],
      [9100, 12000, '<i>a bench</i>.\nWith <00:00:10.000>care.'],
      [15000, 17000, 'After a pause.'],
    ]);
    expect(validate(serialize(r.document)).diagnostics).toEqual([]);
  });

  it('works on part of the file, keeps notes, and needs cues next to each other', () => {
    const d = doc();
    d.body.splice(2, 0, { type: 'note', text: 'kept' });
    const r = makeRollUp(d, [0, 1]);
    expect(r.document.body.map((i) => i.type)).toEqual([
      'cue',
      'cue',
      'cue',
      'cue',
      'note',
      'cue',
      'cue',
    ]);
    expect(() => makeRollUp(doc(), [0, 2])).toThrow(RangeError);
    // A second roll-up gets a region of its own.
    expect(makeRollUp(r.document, [5, 6]).region).toBe('rollup2');
  });

  it('works for SubRip text, which has no word timings', () => {
    const srt = {
      ...createDocument(),
      body: [createCue(0, 4000, 'one two\n<i>three four</i>'), createCue(4000, 6000, 'five')],
    };
    const r = makeRollUp(srt, [0, 1], { form: 'repeat', lines: 2 }, SRT_TEXT);
    expect(rows(r.document)).toEqual([
      // "one two" is 7 of the cue's 17 characters.
      [0, 1647, 'one two'],
      [1647, 4000, 'one two\n<i>three four</i>'],
      [4000, 6000, '<i>three four</i>\nfive'],
    ]);
  });
});
