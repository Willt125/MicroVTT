/**
 * Phase 4d: reading what older drafts and other tools wrote, as it was meant. `parse` stays the
 * spec's algorithm; `importDocument` (and `parse(…, { legacyValues: true })`) recovers. Every
 * recovery is reported by the validator and exported in conforming form.
 */
import { describe, expect, it } from 'vitest';
import type { Cue } from '../src/index.ts';
import {
  FILE_ENCODINGS,
  applyQuickFix,
  decodeFile,
  exportDocument,
  findQuickFixes,
  hasHeaderLines,
  importDocument,
  legacySetting,
  modernizeCueText,
  parse,
  parseLegacyTimestamp,
  validate,
} from '../src/index.ts';

const cuesOf = (text: string): Cue[] =>
  importDocument(text).document.body.filter((b): b is Cue => b.type === 'cue');
const codes = (text: string): string[] => [
  ...new Set(validate(text).diagnostics.map((d) => d.code)),
];
const exportErrors = (text: string): string[] =>
  exportDocument(importDocument(text).document)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.code);

describe('legacy timestamps', () => {
  it.each([
    ['00:00:01,000', 1000],
    ['01:02:03,456', 3_723_456],
    ['0:01.5', 1500],
    ['00:01.50', 1500],
    ['1:2.25', 62_250],
    ['00:00:01.2345', 1235],
    ['00:00:01.9996', 2000],
    ['00:01', 1000],
    ['123:00:00,000', 442_800_000],
  ])('%s is %i ms', (input, ms) => {
    expect(parseLegacyTimestamp(input)).toEqual({ ok: true, ms, end: input.length });
  });

  it.each(['00:60,000', '00:00:60.000', 'x', '00:00:00:01,000'])('rejects %s', (input) => {
    expect(parseLegacyTimestamp(input).ok).toBe(false);
  });

  const SRT =
    'WEBVTT\n\n1\n00:00:01,000 --> 00:00:02,500\nhello\n\n2\n00:00:03,000 --> 00:00:04,000\nworld\n';

  it('keeps SRT-style cues that the spec drops', () => {
    expect(parse(SRT).cues).toEqual([]);
    expect(cuesOf(SRT).map((c) => [c.id, c.startMs, c.endMs, c.text])).toEqual([
      ['1', 1000, 2500, 'hello'],
      ['2', 3000, 4000, 'world'],
    ]);
    expect(codes(SRT)).toEqual(['timestamp-legacy']);
    expect(exportErrors(SRT)).toEqual([]);
    expect(exportDocument(importDocument(SRT).document).text).toContain(
      '00:00:01.000 --> 00:00:02.500\nhello',
    );
  });

  it('still drops timings that mean nothing', () => {
    const text = 'WEBVTT\n\n00:00.000 --> soon\nx\n';
    expect(cuesOf(text)).toEqual([]);
    expect(codes(text)).toEqual(['cue-timings-invalid']);
  });
});

describe('legacy cue settings', () => {
  it.each([
    ['A:middle', { name: 'align', value: 'center', reason: 'name' }],
    ['A:start', { name: 'align', value: 'start', reason: 'name' }],
    ['T:10%', { name: 'position', value: '10%', reason: 'name' }],
    ['L:-1', { name: 'line', value: '-1', reason: 'name' }],
    ['S:50%', { name: 'size', value: '50%', reason: 'name' }],
    ['D:vertical', { name: 'vertical', value: 'rl', reason: 'name' }],
    ['D:vertical-lr', { name: 'vertical', value: 'lr', reason: 'name' }],
    ['position:110%', { name: 'position', value: '100%', reason: 'range' }],
    ['position:-5%,line-left', { name: 'position', value: '0%,line-left', reason: 'range' }],
    ['line:150%,end', { name: 'line', value: '100%,end', reason: 'range' }],
    ['T:120%', { name: 'position', value: '100%', reason: 'name' }],
  ])('%s', (setting, expected) => {
    const [name, value] = setting.split(/:(.*)/) as [string, string];
    expect(legacySetting(name, value)).toEqual(expected);
  });

  it('leaves current and meaningless settings alone', () => {
    expect(legacySetting('align', 'start')).toBeNull();
    expect(legacySetting('size', '-5%')).toBeNull(); // a 0% box shows nothing: no guess
    expect(legacySetting('position', '50%')).toBeNull();
    expect(legacySetting('line', '-3')).toBeNull(); // a line number, not a percentage
    expect(legacySetting('X', 'y')).toBeNull();
  });

  const OLD = 'WEBVTT\n\n00:00.000 --> 00:01.000 A:end T:90% S:30% L:0 position:-1%\nx\n';

  it('reads them on import, reports them and exports the current form', () => {
    expect(parse(OLD).cues[0]).toMatchObject({ align: 'center', position: 'auto', size: 100 });
    expect(cuesOf(OLD)[0]).toMatchObject({ align: 'end', position: 0, size: 30, line: 0 });
    expect(codes(OLD).sort()).toEqual([
      'cue-setting-duplicate',
      'cue-setting-legacy',
      'cue-setting-out-of-range',
    ]);
    expect(exportErrors(OLD)).toEqual([]);
  });
});

describe('old-draft Region: header lines', () => {
  const OLD =
    'WEBVTT\nKind: captions\nRegion: id=fred width=40% lines=3 regionanchor=0%,100% viewportanchor=10%,90% scroll=up\n\n' +
    '00:00.000 --> 00:01.000 region:fred\nx\n';

  it('become regions that cues can use, with the other header lines kept as a comment', () => {
    expect(parse(OLD).cues[0]?.region).toBeNull();
    const { document } = importDocument(OLD);
    expect(document.head.map((h) => h.type)).toEqual(['region', 'note']);
    expect(document.head[0]).toMatchObject({
      id: 'fred',
      width: 40,
      lines: 3,
      regionAnchorY: 100,
      viewportAnchorX: 10,
      viewportAnchorY: 90,
      scroll: 'up',
    });
    expect(document.head[1]).toMatchObject({ text: '\nKind: captions' });
    expect(cuesOf(OLD)[0]?.region).toBe('fred');
    expect(codes(OLD).sort()).toEqual(['header-text', 'region-header-legacy']);
    const text = exportDocument(document).text;
    expect(text).toContain(
      'REGION\nid:fred width:40% viewportanchor:10%,90% scroll:up\n', // defaults omitted
    );
    expect(text).toContain('00:00:00.000 --> 00:00:01.000 region:fred\n');
    expect(exportErrors(OLD)).toEqual([]);
  });
});

describe('<br> and <font color>', () => {
  it.each([
    ['one<br>two', 'one\ntwo'],
    ['one<BR/>two<br />three', 'one\ntwo\nthree'],
    ['<font color="yellow">hi</font>', '<c.yellow>hi</c>'],
    ["<font color='#FF0'>hi</font>", '<c.yellow>hi</c>'],
    ['<font color=#00ff00>hi</font>', '<c.lime>hi</c>'],
    ['<font color="#ff8800">hi</font>', '<c.color-ff8800>hi</c>'],
    ['<font color="orange">hi</font>', '<c.color-orange>hi</c>'],
    ['<font face="Arial">hi</font> there', 'hi there'],
    ['<font color="rgb(1,2,3)">hi</font>', 'hi'],
    ['<i><font color="red">a</font> b</i>', '<i><c.red>a</c> b</i>'],
    ['<font color="red">unclosed', '<c.red>unclosed'],
  ])('%s', (input, output) => {
    expect(modernizeCueText(input)?.text).toBe(output);
  });

  it('leaves WebVTT markup alone', () => {
    expect(modernizeCueText('<i>a</i> <c.x>b</c>')).toBeNull();
  });

  const SRT_STYLE =
    'WEBVTT\n\n00:00.000 --> 00:01.000\n<font color="#ff8800">orange</font> and <font color="yellow">yellow</font><br><br>next\n';

  it('imports as class spans, with a style sheet for colours the spec has no class for', () => {
    const { document } = importDocument(SRT_STYLE);
    expect(cuesOf(SRT_STYLE)[0]?.text).toBe(
      '<c.color-ff8800>orange</c> and <c.yellow>yellow</c>\n\nnext',
    );
    expect(document.head).toEqual([
      { type: 'style', css: '::cue(.color-ff8800) { color: #ff8800; }' },
    ]);
    expect(codes(SRT_STYLE)).toEqual(['cue-text-legacy-tag']);
    expect(exportErrors(SRT_STYLE)).toEqual([]);
    const text = exportDocument(document).text;
    expect(text).toContain('STYLE\n::cue(.color-ff8800) { color: #ff8800; }\n');
    expect(text).toContain('<c.color-ff8800>orange</c> and <c.yellow>yellow</c>\nnext\n');
  });
});

describe('file encodings', () => {
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\ncafé\n';
  const latin1 = Uint8Array.from([...vtt].map((c) => c.charCodeAt(0)));

  it('reads valid UTF-8 as UTF-8 (BOM stripped)', () => {
    const bytes = new TextEncoder().encode(`\ufeff${vtt}`);
    expect(decodeFile(bytes)).toEqual({ text: vtt, encoding: 'utf-8', guessed: false });
  });

  it('reads bytes that are not UTF-8 as Windows-1252 instead of losing letters', () => {
    expect(new TextDecoder().decode(latin1)).toContain('caf�');
    expect(decodeFile(latin1)).toEqual({ text: vtt, encoding: 'windows-1252', guessed: true });
  });

  it('honours a UTF-16 byte order mark', () => {
    const le = new Uint8Array(2 + vtt.length * 2);
    le.set([0xff, 0xfe]);
    [...vtt].forEach((c, i) => le.set([c.charCodeAt(0), 0], 2 + i * 2));
    expect(decodeFile(le)).toEqual({ text: vtt, encoding: 'utf-16le', guessed: true });
  });

  it('uses the encoding asked for', () => {
    expect(decodeFile(latin1, 'iso-8859-15').text).toBe(vtt);
    expect(decodeFile(latin1, 'iso-8859-15').guessed).toBe(false);
  });

  it('offers only encodings the platform can decode', () => {
    for (const { label } of FILE_ENCODINGS) expect(() => new TextDecoder(label)).not.toThrow();
  });
});

describe('header lines (X-TIMESTAMP-MAP, Kind:, Language:)', () => {
  const HLS =
    'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:01.000 --> 00:00:02.000\nhi\n';

  it('are kept as a comment by default, so the export conforms', () => {
    const out = exportDocument(importDocument(HLS).document);
    expect(out.text).toBe(
      'WEBVTT\n\nNOTE\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:01.000 --> 00:00:02.000\nhi\n',
    );
    expect(out.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('go back under the WEBVTT line with headerLines (not conforming, as HLS needs)', () => {
    const { document } = importDocument(HLS);
    expect(hasHeaderLines(document)).toBe(true);
    const out = exportDocument(document, { headerLines: true, lineEnding: '\r\n' });
    expect(out.text).toBe(HLS.replace(/\n/g, '\r\n'));
    expect(out.diagnostics.map((d) => d.code)).toEqual(['header-text']);
  });

  it('are absent from documents without them', () => {
    expect(hasHeaderLines(importDocument('WEBVTT\n\nNOTE x\n').document)).toBe(false);
  });
});

describe('fixes the user applies', () => {
  it('join text after a blank line inside a caption to that caption', () => {
    const text = 'WEBVTT\n\n00:00.000 --> 00:01.000\nline one\n\nline two\n';
    const doc = importDocument(text).document;
    expect(findQuickFixes(doc)).toEqual([
      { index: 1, kind: 'join-text', label: 'Join this text to the cue above' },
    ]);
    const fixed = applyQuickFix(doc, 1);
    expect(fixed.body).toHaveLength(1);
    expect((fixed.body[0] as Cue).text).toBe('line one\nline two');
    expect(findQuickFixes(fixed)).toEqual([]);
  });

  it('move a late STYLE block to the header', () => {
    const text =
      'WEBVTT\n\n00:00.000 --> 00:01.000\n<c.x>hi</c>\n\nSTYLE\n::cue(.x) { color: lime }\n';
    const doc = importDocument(text).document;
    expect(findQuickFixes(doc).map((f) => f.kind)).toEqual(['move-to-header']);
    const fixed = applyQuickFix(doc, 1);
    expect(fixed.head).toMatchObject([{ type: 'style', css: '::cue(.x) { color: lime }' }]);
    expect(fixed.body).toHaveLength(1);
    expect(exportDocument(fixed).text).toBe(
      'WEBVTT\n\nSTYLE\n::cue(.x) { color: lime }\n\n00:00:00.000 --> 00:00:01.000\n<c.x>hi</c>\n',
    );
  });

  it('move a late REGION block to the header and reconnect the cues that named it', () => {
    const text =
      'WEBVTT\n\n00:00.000 --> 00:01.000 region:r\na\n\nREGION\nid:r width:50%\n\n' +
      '00:02.000 --> 00:03.000 region:r line:1\nb\n';
    const doc = importDocument(text).document;
    expect((doc.body[0] as Cue).unresolvedRegion).toBe('r');
    const fixed = applyQuickFix(doc, 1);
    expect(fixed.head).toMatchObject([{ type: 'region', id: 'r', width: 50 }]);
    // The first cue joins the region; the second has a line setting, which takes it out.
    expect(fixed.body.map((c) => (c as Cue).region)).toEqual(['r', null]);
    expect(exportDocument(fixed).text).toContain('00:00:00.000 --> 00:00:01.000 region:r\na\n');
    expect('unresolvedRegion' in (exportDocument(doc).document.body[0] as Cue)).toBe(false);
  });

  it('are not offered for comments, header text or blocks that were bad cues', () => {
    const text =
      'WEBVTT\nKind: captions\n\nNOTE a comment\n\n00:00.000 --> 00:01.000\nx\n\n' +
      '00:02.000 --> nope\ny\n\nNOTE another\n';
    expect(findQuickFixes(importDocument(text).document)).toEqual([]);
  });
});
