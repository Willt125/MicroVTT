/** Chapters and metadata files: outline, editing, chapter lists, JSON payloads, type guess. */
import { describe, expect, it } from 'vitest';
import type { Cue, VttDocument } from '../src/index.ts';
import {
  chapterList,
  chapterOutline,
  chaptersFromList,
  createCue,
  createDocument,
  exportDocument,
  formatJson,
  formatListTime,
  guessFileType,
  jsonProblem,
  makeChaptersContinuous,
  metadataPayloadProblems,
  parseChapterList,
  splitChapterAt,
  validate,
} from '../src/index.ts';

const doc = (...cues: Cue[]): VttDocument => ({ ...createDocument(), body: cues });
const spans = (d: VttDocument): [number, number, string][] =>
  d.body.flatMap((c) =>
    c.type === 'cue' ? [[c.startMs, c.endMs, c.text] as [number, number, string]] : [],
  );

describe('chapter outline', () => {
  it('orders chapters, nests them and flags crossings', () => {
    const outline = chapterOutline(
      doc(
        createCue(60_000, 120_000, 'Two'),
        createCue(0, 60_000, 'One &amp; only'),
        createCue(10_000, 20_000, 'One, part A'),
        createCue(110_000, 130_000, 'Crosses'),
      ),
    );
    expect(outline.map((c) => [c.title, c.depth, c.crosses])).toEqual([
      ['One & only', 0, false],
      ['One, part A', 1, false],
      ['Two', 0, true],
      ['Crosses', 0, true],
    ]);
    expect(outline[0]?.index).toBe(1);
  });
});

describe('editing chapters', () => {
  const three = doc(createCue(0, 60_000, 'A'), createCue(60_000, 120_000, 'B'));

  it('splits the chapter at a time, or adds one in a gap or at the end', () => {
    const split = splitChapterAt(three, 30_000, 'A <2>');
    expect(spans(split.document)).toEqual([
      [0, 30_000, 'A'],
      [30_000, 60_000, 'A &lt;2&gt;'],
      [60_000, 120_000, 'B'],
    ]);
    expect(split.index).toBe(1);
    const after = splitChapterAt(three, 150_000, 'C', 200_000);
    expect(spans(after.document).at(-1)).toEqual([150_000, 200_000, 'C']);
    const gap = splitChapterAt(
      doc(createCue(0, 10_000, 'A'), createCue(50_000, 60_000, 'B')),
      20_000,
      'G',
    );
    expect(spans(gap.document)[1]).toEqual([20_000, 50_000, 'G']);
    expect(() => splitChapterAt(three, 60_000, 'X')).toThrow(RangeError);
  });

  it('makes top-level chapters continuous, leaving nested ones', () => {
    const d = doc(
      createCue(2_000, 50_000, 'A'),
      createCue(10_000, 20_000, 'A.1'),
      createCue(60_000, 100_000, 'B'),
      createCue(90_000, 130_000, 'C'),
    );
    expect(spans(makeChaptersContinuous(d, 200_000))).toEqual([
      [0, 60_000, 'A'],
      [10_000, 20_000, 'A.1'],
      [60_000, 90_000, 'B'],
      [90_000, 200_000, 'C'],
    ]);
    const done = makeChaptersContinuous(d, 200_000);
    expect(makeChaptersContinuous(done, 200_000)).toBe(done);
  });
});

describe('chapter lists', () => {
  it('reads the ways chapter lists are written', () => {
    const { chapters, skipped } = parseChapterList(
      [
        'Chapters:',
        '0:00 Intro',
        '01:15 - The problem',
        '(2:30) Fixing it',
        '1:02:03.5 | Long one',
        '• 3:00 – Bullet',
        'Credits 58:10',
        '9:99 Not a time',
      ].join('\n'),
    );
    expect(chapters.map((c) => [formatListTime(c.startMs), c.title])).toEqual([
      ['0:00', 'Intro'],
      ['1:15', 'The problem'],
      ['2:30', 'Fixing it'],
      ['3:00', 'Bullet'],
      ['58:10', 'Credits'],
      ['1:02:03.500', 'Long one'],
    ]);
    expect(skipped).toEqual([1, 8]);
  });

  it('makes chapters that follow each other, the last to the end', () => {
    const { chapters } = parseChapterList('0:00 A & B\n1:00 C\n1:00 Same time');
    const cues = chaptersFromList(chapters, 150_000);
    expect(cues.map((c) => [c.startMs, c.endMs, c.text])).toEqual([
      [0, 60_000, 'A &amp; B'],
      [60_000, 150_000, 'C'],
    ]);
    expect(chaptersFromList(chapters.slice(0, 1)).at(0)?.endMs).toBe(60_000);
    // A valid chapters file.
    const text = exportDocument(doc(...cues), { fileType: 'chapters' }).text;
    expect(validate(text, { fileType: 'chapters' }).diagnostics).toEqual([]);
  });

  it('writes the top-level chapters as a list, with what video sites object to', () => {
    const d = doc(
      createCue(5_000, 65_000, 'Intro &amp; hello'),
      createCue(10_000, 20_000, 'Nested'),
      createCue(65_000, 3_700_000, 'Main'),
    );
    const list = chapterList(d);
    expect(list.text).toBe('0:05 Intro & hello\n1:05 Main');
    expect(list.nestedLeftOut).toBe(1);
    expect(list.notes).toEqual([
      'The first chapter does not start at 0:00.',
      'There are fewer than three chapters.',
    ]);
    expect(formatListTime(3_723_000)).toBe('1:02:03');
  });
});

describe('metadata payloads', () => {
  it('checks and formats JSON, keeping "-->" out of the payload', () => {
    expect(jsonProblem('{"a": 1}')).toBeNull();
    expect(jsonProblem('{"a": }')).not.toBeNull();
    expect(formatJson('{"a":[1,2],"b":"x --> y"}')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ],\n  "b": "x --\\u003e y"\n}',
    );
    expect(JSON.parse(formatJson('{"b":"x --> y"}', 0))).toEqual({ b: 'x --> y' });
    expect(() => formatJson('nope')).toThrow(SyntaxError);
  });

  it('lists what a payload cannot hold', () => {
    expect(metadataPayloadProblems('{"a": 1}')).toEqual([]);
    expect(metadataPayloadProblems('a\n\nb')).toHaveLength(1);
    expect(metadataPayloadProblems('{"a": "-->"}')[0]).toContain('\\u003e');
  });
});

describe('guessing the file type', () => {
  const captions = doc(createCue(0, 2_000, 'Hello'), createCue(2_000, 4_000, 'there'));

  it('reads the name, JSON payloads and chapter-like cues', () => {
    expect(guessFileType(captions, 'talk.vtt')).toBeNull();
    expect(guessFileType(captions, 'talk.chapters.vtt')?.type).toBe('chapters');
    expect(guessFileType(captions, 'talk_metadata.vtt')?.type).toBe('metadata');
    expect(guessFileType(captions, 'chaptersmith.vtt')).toBeNull();
    expect(guessFileType(doc(createCue(0, 1, '{"x": 1}'), createCue(1, 2, '[1]')))?.type).toBe(
      'metadata',
    );
    const chapters = doc(createCue(0, 60_000, 'Intro'), createCue(60_000, 300_000, 'Main part'));
    expect(guessFileType(chapters)).toEqual({
      type: 'chapters',
      reason: 'its cues are long, one-line titles that follow each other',
    });
    expect(guessFileType(doc())).toBeNull();
  });
});
