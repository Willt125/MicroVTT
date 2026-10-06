/**
 * Document model: import, repair, serialization, editing, and the CSS / BCP 47 helpers.
 */
import { describe, expect, it } from 'vitest';
import type { Cue, VttDocument } from '../src/index.ts';
import {
  IndexSizeError,
  checkStylesheet,
  createCue,
  createDocument,
  createRegion,
  cuesOf,
  exportDocument,
  formatDecimal,
  importDocument,
  isValidLanguageTag,
  mapTextTimestamps,
  mergeCues,
  renumberCues,
  repair,
  repairStylesheet,
  scaleCues,
  serialize,
  shiftCues,
  sortDocumentCues,
  splitCue,
  updateCue,
} from '../src/index.ts';

const H = 'WEBVTT\n\n';
const doc = (...cues: Cue[]): VttDocument => ({ ...createDocument(), body: cues });
const codes = (d: VttDocument): string[] => repair(d).report.map((r) => r.code);

describe('importDocument', () => {
  it('keeps the title, comments and their positions', () => {
    const { document } = importDocument(
      `WEBVTT\tMy title\n\nNOTE head\n\nREGION\nid:r\n\n00:00.000 --> 00:01.000\na\n\nNOTE\nbetween\n\n00:01.000 --> 00:02.000\nb\n`,
    );
    expect(document.title).toBe('My title');
    expect(document.head.map((i) => i.type)).toEqual(['note', 'region']);
    expect(document.body.map((i) => i.type)).toEqual(['cue', 'note', 'cue']);
    expect(document.body[1]).toMatchObject({ type: 'note', text: '\nbetween' });
  });

  it('keeps text the parser ignores as comments, marked as preserved', () => {
    const { document } = importDocument(
      'WEBVTT\nKind: captions\n\nstray text\n\n00:00.000 --> 00:01.000\nx\n\nSTYLE\n::cue{}\n',
    );
    const notes = [...document.head, ...document.body].filter((i) => i.type === 'note');
    expect(notes.map((n) => n.type === 'note' && n.preserved)).toEqual([
      'header',
      'discarded',
      'discarded',
    ]);
  });

  it('refers to regions by id, resolving like the parser (last region wins)', () => {
    const { document } = importDocument(
      `${H}REGION\nid:r lines:1\n\nREGION\nid:r lines:2\n\n00:00.000 --> 00:01.000 region:r\nx\n`,
    );
    expect(cuesOf(document)[0]?.region).toBe('r');
  });

  it('returns an empty document for a non-WebVTT file', () => {
    expect(importDocument('1\n00:00:00,000 --> 00:00:01,000\nSRT\n')).toMatchObject({
      ok: false,
      document: createDocument(),
    });
  });
});

describe('repair', () => {
  it('keeps the rendering when a line value cannot be written', () => {
    const cue = { ...createCue(0, 1000, 'x'), line: 'auto' as const, snapToLines: false };
    const fixed = cuesOf(repair(doc(cue)).document)[0];
    // A cue with line auto and snapToLines false renders at 100% (cue computed line).
    expect(fixed).toMatchObject({ line: 100, snapToLines: false });
    expect(serialize(repair(doc(cue)).document)).toContain('line:100%');
  });

  it('fixes times: whole ms, end after start', () => {
    const fixed = cuesOf(repair(doc(createCue(1000.4, 1000.2, 'x'))).document)[0];
    expect(fixed).toMatchObject({ startMs: 1000, endMs: 1001 });
  });

  it('sorts cues, keeping each note with the cue after it', () => {
    const d: VttDocument = {
      ...createDocument(),
      body: [
        createCue(0, 500, 'first'),
        { type: 'note', text: ' about late' },
        createCue(5000, 6000, 'late'),
        createCue(1000, 2000, 'early'),
      ],
    };
    const { document, report } = repair(d);
    expect(document.body.map((i) => (i.type === 'cue' ? i.text : i.text))).toEqual([
      'first',
      'early',
      ' about late',
      'late',
    ]);
    expect(report.map((r) => r.code)).toContain('cue-start-order');
  });

  it('renames duplicate cue ids and keeps only the last region with an id', () => {
    const a = { ...createCue(0, 1, 'x'), id: 'a' };
    const d: VttDocument = {
      title: '',
      head: [createRegion('r'), { ...createRegion('r'), lines: 7 }],
      body: [a, { ...a }, { ...a }],
    };
    const { document } = repair(d);
    expect(cuesOf(document).map((c) => c.id)).toEqual(['a', 'a-2', 'a-3']);
    expect(document.head).toEqual([{ ...createRegion('r'), lines: 7 }]);
  });

  it('drops region references that parsers would ignore', () => {
    const d: VttDocument = {
      title: '',
      head: [createRegion('r')],
      body: [
        { ...createCue(0, 1, 'x'), region: 'r', line: 2 },
        { ...createCue(1, 2, 'y'), region: 'nope' },
      ],
    };
    expect(codes(d)).toEqual(['cue-region-ignored', 'cue-region-undefined']);
    expect(cuesOf(repair(d).document).map((c) => c.region)).toEqual([null, null]);
  });

  it('escapes arrows in cue text and breaks them in comments', () => {
    const d: VttDocument = {
      title: '',
      head: [],
      body: [createCue(0, 1, 'a --> b'), { type: 'note', text: ' x --> y' }],
    };
    expect(serialize(repair(d).document)).toBe(
      `${H}00:00:00.000 --> 00:00:00.001\na --&gt; b\n\nNOTE x -- > y\n`,
    );
  });

  it('rewrites invalid cue text, keeping valid markup', () => {
    const cue = createCue(0, 2000, 'AT&T <b>bold <i>both</b> <00:03.000>late <lang 123>x</lang>');
    const text = cuesOf(repair(doc(cue)).document)[0]?.text;
    // Rebuilt from the tree parsers build: "</b>" cannot close the open <i>, so both stay open
    // to the end; the late timestamp and the invalid language span are removed.
    expect(text).toBe('AT&amp;T <b>bold <i>both late x</i></b>');
  });

  it('turns ignored header lines into a comment', () => {
    const { document } = importDocument(
      'WEBVTT\nKind: captions\nLanguage: en\n\n00:00.000 --> 00:01.000\nx\n',
    );
    expect(exportDocument(document).text).toBe(
      `${H}NOTE\nKind: captions\nLanguage: en\n\n00:00:00.000 --> 00:00:01.000\nx\n`,
    );
  });

  it('trims overlapping chapters so they nest', () => {
    const d = doc(createCue(0, 60_000, 'A'), createCue(30_000, 90_000, 'B'));
    const { document, report } = repair(d, { fileType: 'chapters' });
    expect(cuesOf(document).map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 30_000],
      [30_000, 90_000],
    ]);
    expect(report.map((r) => r.code)).toEqual(['chapters-not-nested']);
  });

  it('reports nothing for a conforming document', () => {
    const { document } = importDocument(
      `${H}STYLE\n::cue { color: lime }\n\nREGION\nid:r width:40%\n\n1\n00:00.000 --> 00:01.000 region:r align:start\n<v Bob>Hi</v>\n`,
    );
    expect(repair(document).report).toEqual([]);
  });

  it('does not modify its input', () => {
    const d = doc(createCue(5, 1, 'a<b'));
    const before = structuredClone(d);
    repair(d);
    expect(d).toEqual(before);
  });
});

describe('serialize', () => {
  const cue: Cue = {
    ...createCue(3_723_004, 3_724_000, 'hello'),
    id: 'c1',
    region: 'r',
    vertical: 'rl',
    line: -1,
    lineAlign: 'end',
    position: 25.5,
    positionAlign: 'line-left',
    size: 50,
    align: 'start',
  };

  it('writes settings in a fixed order, omitting defaults, region last', () => {
    expect(serialize(doc(cue))).toBe(
      `${H}c1\n01:02:03.004 --> 01:02:04.000 vertical:rl line:-1,end position:25.5%,line-left size:50% align:start region:r\nhello\n`,
    );
    expect(serialize(doc(createCue(0, 1, 'x')))).toBe(`${H}00:00:00.000 --> 00:00:00.001\nx\n`);
  });

  it('supports CRLF, a BOM and short timestamps', () => {
    const out = serialize(
      { ...doc(createCue(0, 1500, 'x')), title: 'T' },
      { lineEnding: '\r\n', byteOrderMark: true, omitZeroHours: true },
    );
    expect(out).toBe('﻿WEBVTT T\r\n\r\n00:00.000 --> 00:01.500\r\nx\r\n');
  });

  it('never writes exponents', () => {
    expect(formatDecimal(1e-7)).toBe('0.0000001');
    expect(formatDecimal(1e21)).toBe('1000000000000000000000');
    expect(formatDecimal(-0.5)).toBe('-0.5');
  });

  it('writes an empty document as a conforming file', () => {
    expect(serialize(createDocument())).toBe(H);
  });
});

describe('editing', () => {
  const words = createCue(1000, 3000, 'so<00:00:01.500><c> it</c><00:00:02.000><c> goes</c>');

  it('maps timestamp tags, but not text inside annotations', () => {
    expect(mapTextTimestamps('<v a<00:01.000>>x<00:02.000>', (ms) => ms + 1)).toBe(
      '<v a<00:01.000>>x<00:00:02.001>',
    );
  });

  it('shifts cues and their word timings, clamping at zero', () => {
    const [moved] = cuesOf(shiftCues(doc(words), -1200));
    expect(moved).toMatchObject({ startMs: 0, endMs: 1800 });
    expect(moved?.text).toBe('so<00:00:00.300><c> it</c><00:00:00.800><c> goes</c>');
  });

  it('scales around an anchor', () => {
    const [scaled] = cuesOf(scaleCues(doc(words), 2, 1000));
    expect(scaled).toMatchObject({ startMs: 1000, endMs: 5000 });
    expect(scaled?.text).toContain('<00:00:02.000>');
    expect(() => scaleCues(doc(words), 0)).toThrow(RangeError);
  });

  it('splits a cue, dropping word timings that leave their cue', () => {
    const offset = words.text.indexOf('<00:00:02.000>');
    const [a, b] = cuesOf(splitCue(doc(words), 0, 2000, offset));
    expect(a).toMatchObject({ startMs: 1000, endMs: 2000, text: 'so<00:00:01.500><c> it</c>' });
    expect(b).toMatchObject({ startMs: 2000, endMs: 3000, text: '<c> goes</c>' });
  });

  it('splits outside tags and references, closing and reopening open elements', () => {
    const split = (text: string, offset: number): string[] =>
      cuesOf(splitCue(doc(createCue(0, 2000, text)), 0, 1000, offset)).map((c) => c.text);
    expect(split('<i>ab</i>', 4)).toEqual(['<i>a</i>', '<i>b</i>']);
    expect(split('<v.loud Bob>one <b>two</b> three', 20)).toEqual([
      '<v.loud Bob>one <b>t</b></v>',
      '<v.loud Bob><b>wo</b> three',
    ]);
    expect(split('a<i>b</i>', 2)).toEqual(['a', '<i>b</i>']); // Inside "<i>": before it.
    expect(split('a<i>b</i>', 4)).toEqual(['a', '<i>b</i>']); // Just after "<i>".
    expect(split('<i>a</i>b', 4)).toEqual(['<i>a</i>', 'b']); // Just before "</i>".
    expect(split('x&amp;y', 3)).toEqual(['x', '&amp;y']);
    expect(split('<ruby>a<rt>b</rt></ruby>c', 12)).toEqual(['<ruby>a<rt>b</rt></ruby>', 'c']);
    expect(split('one\ntwo', 4)).toEqual(['one', 'two']);
    expect(split('one two', 3)).toEqual(['one', 'two']); // Whitespace at the split goes.
  });

  it('merges cues, keeping the join as a word timing', () => {
    const merged = mergeCues(doc(createCue(0, 1000, 'a'), createCue(1000, 2000, 'b')), 0, 1);
    expect(cuesOf(merged)).toEqual([{ ...createCue(0, 2000, 'a\n<00:00:01.000>b') }]);
  });

  it('sorts and renumbers', () => {
    const sorted = sortDocumentCues(doc(createCue(5, 6, 'b'), createCue(1, 2, 'a')));
    expect(cuesOf(renumberCues(sorted)).map((c) => `${c.id}:${c.text}`)).toEqual(['1:a', '2:b']);
  });

  it('updates with VTTCue attribute semantics', () => {
    const cue = createCue(0, 1, 'x');
    expect(updateCue(cue, { align: 'bogus' as 'start', lineAlign: 'end' })).toMatchObject({
      align: 'center',
      lineAlign: 'end',
    });
    expect(() => updateCue(cue, { position: 101 })).toThrow(IndexSizeError);
    expect(() => updateCue(cue, { size: -1 })).toThrow(IndexSizeError);
    expect(() => updateCue(cue, { line: Number.NaN })).toThrow(TypeError);
    expect(updateCue(cue, { line: -5, snapToLines: false }).line).toBe(-5); // Allowed, as in the API.
  });
});

describe('CSS', () => {
  it('reports syntax errors and keeps well-formed rules on repair', () => {
    const css = '::cue { color: red; nonsense }\n::cue(b) { font-weight: bold\n';
    expect(checkStylesheet(css, 0).map((d) => d.code)).toEqual([
      'style-css-syntax',
      'style-css-syntax',
    ]);
    const fixed = repairStylesheet(css);
    expect(checkStylesheet(fixed, 0)).toEqual([]);
    expect(fixed).toContain('color: red;');
    expect(fixed).toContain('font-weight: bold;');
  });

  it('accepts strings, comments, escapes and at-rules', () => {
    const css =
      '@import url("x.css");\n/* c */ ::cue(v[voice="a}b"]) { color: red; background: url(a\\)b) }\n@media (min-width: 1px) { ::cue { color: blue } }';
    expect(checkStylesheet(css, 0)).toEqual([]);
  });
});

describe('BCP 47', () => {
  it.each([
    'en',
    'en-US',
    'zh-Hant-TW',
    'sr-Latn-RS',
    'de-CH-1901',
    'x-private',
    'en-a-bbb-x-a-ccc',
    'i-klingon',
    'ja-JP-u-ca-japanese',
  ])('accepts %s', (tag) => expect(isValidLanguageTag(tag)).toBe(true));
  it.each(['', 'en_US', '123', 'en-', 'e', 'de-1901-1901', 'en-a-bb-a-cc', 'toolongtag'])(
    'rejects %j',
    (tag) => expect(isValidLanguageTag(tag)).toBe(false),
  );
});
