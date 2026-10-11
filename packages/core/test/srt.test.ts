/** SubRip: reading, checking, writing, its text dialect, conversion and re-encoding. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Cue, DiagnosticCode, VttDocument } from '../src/index.ts';
import {
  DIAGNOSTICS,
  SRT,
  SRT_TEXT,
  WEBVTT,
  createCue,
  createDocument,
  decodeFile,
  encodeText,
  exportDocument,
  formatOf,
  importDocument,
  parseSrt,
  srtAnchor,
  srtToVtt,
  validateSrt,
  vttToSrt,
  withSrtAnchor,
  writeSrt,
} from '../src/index.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`fixtures/srt/${name}`, import.meta.url)));
const texts = (doc: VttDocument): string[] =>
  doc.body.flatMap((item) => (item.type === 'cue' ? [item.text] : []));
const doc = (...cues: Cue[]): VttDocument => ({ ...createDocument(), body: cues });

describe('reading and writing', () => {
  it('round-trips a clean file byte for byte (CRLF and BOM kept)', () => {
    const bytes = fixture('clean-crlf-bom.srt');
    const { text } = decodeFile(bytes);
    // decodeFile drops the UTF-8 BOM; the importer is told about it from the bytes.
    const imported = parseSrt((bytes[0] === 0xef ? '\uFEFF' : '') + text);
    expect(imported.diagnostics).toEqual([]);
    expect(imported.style).toEqual({ lineEnding: '\r\n', byteOrderMark: true });
    expect(texts(imported.document)).toEqual([
      'Hello there.',
      '<i>Two lines,</i>\nin italics.',
      '{\\an8}At the top.',
    ]);
    const cue = imported.document.body[2] as Cue;
    expect([cue.startMs, cue.endMs]).toEqual([62_003, 3_600_000]);
    const written = writeSrt(imported.document, imported.style);
    expect(written.report).toEqual([]);
    expect(new TextEncoder().encode(written.text)).toEqual(bytes);
  });

  it('reads the quirks players read, and reports them', () => {
    const imported = parseSrt(new TextDecoder().decode(fixture('quirks.srt')));
    expect(texts(imported.document)).toEqual([
      'One with loose times.',
      'Coordinates, and a number out of order.',
      'No number and no blank line before.',
      '<font color="#ffff00">Yellow</font> and {\\i1}italic{\\i0}.',
      '<s>Struck</s> {\\fad(200,200)}faded {laughs}',
    ]);
    const first = imported.document.body[0] as Cue;
    expect([first.startMs, first.endMs]).toEqual([1500, 3250]);
    expect(imported.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['srt-block-unreadable', '1 line that is not part of a cue was left out (line 1).'],
      ['srt-block-unreadable', '1 cue with times that could not be read was left out.'],
      ['srt-timing-format', '1 cue has times not written HH:MM:SS,mmm.'],
      ['srt-coordinates', '1 cue has box coordinates.'],
      ['srt-numbering', '3 cues are not numbered in order from 1 (or have no number).'],
    ]);
    expect(validateSrt(imported.document).map((d) => [d.code, d.index])).toEqual([
      ['srt-unknown-tag', 4],
    ]);
    expect(imported.style).toEqual({ lineEnding: '\n', byteOrderMark: false });
  });

  it('writes what SubRip can hold, and says what it changed', () => {
    const d = doc(createCue(0, 1000, 'a\n\nb'), createCue(1000, 2000, 'x --> y'));
    const { text, report } = writeSrt(d);
    expect(text).toBe(
      '1\n00:00:00,000 --> 00:00:01,000\na\nb\n\n2\n00:00:01,000 --> 00:00:02,000\nx -> y\n\n',
    );
    expect(report.map((r) => r.code)).toEqual(['srt-blank-line', 'srt-arrow']);
    expect(parseSrt(text).document.body).toHaveLength(2);
  });
});

/** A file (or a document) with each SubRip problem, and the same without it. */
const CASES: Record<string, { bad: string | Cue; good: string | Cue }> = {
  'srt-block-unreadable': {
    bad: 'junk\n\n1\n00:00:01,000 --> 00:00:02,000\na\n',
    good: '1\n00:00:01,000 --> 00:00:02,000\na\n',
  },
  'srt-timing-format': {
    bad: '1\n00:00:01.000 --> 00:00:02,000\na\n',
    good: '1\n00:00:01,000 --> 00:00:02,000\na\n',
  },
  'srt-numbering': {
    bad: '2\n00:00:01,000 --> 00:00:02,000\na\n',
    good: '1\n00:00:01,000 --> 00:00:02,000\na\n',
  },
  'srt-coordinates': {
    bad: '1\n00:00:01,000 --> 00:00:02,000 X1:1\na\n',
    good: '1\n00:00:01,000 --> 00:00:02,000\na\n',
  },
  'srt-end-before-start': { bad: createCue(2000, 1000, 'a'), good: createCue(1000, 2000, 'a') },
  'srt-blank-line': { bad: createCue(0, 1, 'a\n\nb'), good: createCue(0, 1, 'a\nb') },
  'srt-arrow': { bad: createCue(0, 1, 'a --> b'), good: createCue(0, 1, 'a -> b') },
  'srt-unknown-tag': {
    bad: createCue(0, 1, '<span>a</span> {\\blur3}b'),
    good: createCue(0, 1, '<i>a</i> {\\an8}{\\i1}b{\\i0} {laughs} a < b'),
  },
};

describe('every SubRip diagnostic code', () => {
  const codes = (input: string | Cue): DiagnosticCode[] =>
    typeof input === 'string'
      ? [...parseSrt(input).diagnostics, ...validateSrt(parseSrt(input).document)].map(
          (d) => d.code,
        )
      : validateSrt(doc(input)).map((d) => d.code);
  for (const [code, c] of Object.entries(CASES)) {
    it(`${code}: reported for the bad example, clean for the good one`, () => {
      expect(codes(c.bad)).toContain(code);
      expect(codes(c.good)).toEqual([]);
    });
  }
  it('covers every SubRip code', () => {
    // srt-encoding is about bytes: the importer reports it (see the e2e tests).
    const codes = Object.keys(DIAGNOSTICS).filter(
      (c) => c.startsWith('srt-') && c !== 'srt-encoding',
    );
    expect(codes.sort()).toEqual(Object.keys(CASES).sort());
  });
});

describe('SubRip text', () => {
  it('reads past tags and override blocks; & and stray < are text', () => {
    expect(
      SRT_TEXT.readableLines('{\\an8}<i>a &amp; b</i>\n<font color="red">c</font> < d'),
    ).toEqual(['a &amp; b', 'c < d']);
    expect(SRT_TEXT.hasMarkup('a & b < c')).toBe(false);
    expect(SRT_TEXT.hasItalics('{\\i1}x')).toBe(true);
    expect(SRT_TEXT.removeItalics('<I>a</I> {\\i1}b{\\i0}')).toBe('a b');
  });

  it('splits, closing and reopening spans and keeping the position', () => {
    expect(SRT_TEXT.splitText('<i>one two</i>', 7)).toEqual(['<i>one</i>', '<i>two</i>']);
    expect(SRT_TEXT.splitText('{\\an8}{\\i1}one two', 14)).toEqual([
      '{\\an8}{\\i1}one{\\i0}',
      '{\\an8}{\\i1}two',
    ]);
    // Never inside a tag.
    expect(SRT_TEXT.splitText('a <font color="red">b</font>', 10)).toEqual([
      'a',
      '<font color="red">b</font>',
    ]);
  });

  it('reads and sets the position block', () => {
    expect(srtAnchor('{\\an8}x')).toBe(8);
    expect(srtAnchor('x')).toBeNull();
    expect(withSrtAnchor('{\\an8}x', 7)).toBe('{\\an7}x');
    expect(withSrtAnchor('{\\an8}x', 2)).toBe('x');
    expect(withSrtAnchor('x', null)).toBe('x');
  });
});

describe('conversion', () => {
  it('converts SubRip to WebVTT, carrying markup, colours and positions', () => {
    const { document, lost } = srtToVtt(
      doc(
        createCue(0, 1000, '{\\an8}<I>Hi</I> & <font color="#ff0">you</font> <3'),
        createCue(1000, 2000, '{\\an1}{\\i1}left<s>struck</s>'),
        createCue(2000, 3000, '<font color="#123456">custom</font>'),
      ),
    );
    const [a, b, c] = document.body as Cue[];
    expect(a).toMatchObject({ line: 0, align: 'center' });
    expect(a?.text).toBe('<i>Hi</i> &amp; <c.yellow>you</c> &lt;3');
    expect(b).toMatchObject({ line: 'auto', align: 'left' });
    expect(b?.text).toBe('<i>leftstruck</i>');
    expect(c?.text).toBe('<c.color-123456>custom</c>');
    expect(document.head).toEqual([
      { type: 'style', css: '::cue(.color-123456) { color: #123456; }' },
    ]);
    expect(lost).toEqual([{ what: 'Strikethrough (<s>)', count: 1 }]);
    // The result is valid WebVTT.
    const exported = exportDocument(document);
    expect(exported.report).toEqual([]);
    expect(exported.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('converts WebVTT to SubRip, and lists what SubRip cannot hold', () => {
    const vtt = importDocument(
      [
        'WEBVTT',
        '',
        'REGION',
        'id:r',
        '',
        'STYLE',
        '::cue(.hot) { background-color: black; color: #f80 }',
        '',
        'NOTE a comment',
        '',
        'intro',
        '00:00.000 --> 00:01.000 line:0 align:left',
        '<v Bob><b>Hi</b> <c.yellow>there</c> <c.hot>hot</c></v>',
        '',
        '00:01.000 --> 00:02.000 region:r',
        '<ruby>漢<rt>かん</rt></ruby> a<00:01.500>b &amp; c',
        '',
      ].join('\n'),
    ).document;
    const { document, lost } = vttToSrt(vtt);
    expect(texts(document)).toEqual([
      '{\\an7}<b>Hi</b> <font color="yellow">there</font> <font color="#f80">hot</font>',
      '漢 ab & c',
    ]);
    expect(Object.fromEntries(lost.map((l) => [l.what, l.count]))).toEqual({
      'Regions (REGION blocks)': 2,
      'Style sheets (STYLE blocks), apart from text colours': 1,
      'Comments (NOTE blocks)': 1,
      'Cue identifiers': 1,
      'Voice names (<v Name>)': 1,
      'Ruby text (<rt>)': 1,
      'Word timings (<00:00:01.000>)': 1,
    });
    // And back: positions and markup survive the round trip.
    const back = srtToVtt(document).document.body[0] as Cue;
    expect(back).toMatchObject({ line: 0, align: 'left' });
  });
});

describe('formats and encodings', () => {
  it('recognises SubRip by content first, then by extension', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nx\n';
    expect(formatOf('renamed.vtt', srt)).toBe(SRT);
    expect(formatOf('a.srt', 'garbage')).toBe(SRT);
    expect(formatOf('a.srt', 'WEBVTT\n')).toBe(WEBVTT);
    expect(formatOf('a.txt', '\uFEFF00:00:01,000 --> 00:00:02,000\n')).toBe(SRT);
  });

  it('writes text back in a legacy encoding when every character fits', () => {
    const bytes = encodeText('café', 'windows-1252');
    expect([...(bytes ?? [])]).toEqual([0x63, 0x61, 0x66, 0xe9]);
    expect(encodeText('ćwierć', 'windows-1252')).toBeNull();
    const sjis = encodeText('こんにちは、ｶﾀｶﾅ!', 'shift_jis');
    expect(sjis && new TextDecoder('shift_jis').decode(sjis)).toBe('こんにちは、ｶﾀｶﾅ!');
    expect(encodeText('é', 'utf-8')).toEqual(new Uint8Array([0xc3, 0xa9]));
    expect(encodeText('a', 'no-such-encoding')).toBeNull();
  });
});
