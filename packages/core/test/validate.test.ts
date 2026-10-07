/**
 * One failing and one passing example for every diagnostic code. The passing example is the
 * failing one with that problem fixed, and must produce no diagnostics at all.
 */
import { describe, expect, it } from 'vitest';
import type { DiagnosticCode, FileType } from '../src/index.ts';
import { DIAGNOSTICS, specUrl, validate } from '../src/index.ts';

const H = 'WEBVTT\n\n';
const CUE = '00:00.000 --> 00:01.000\n';
const REGION = 'REGION\nid:r\n\n';

interface Case {
  bad: string;
  good: string;
  fileType?: FileType;
}

const CASES: Record<
  Exclude<DiagnosticCode, 'cue-id-invalid' | 'region-id-invalid' | 'file-encoding'>,
  Case
> = {
  'signature-invalid': { bad: 'WEBVTT-\n', good: H },
  'signature-line-terminators': { bad: `WEBVTT\n${CUE}x\n`, good: `${H}${CUE}x\n` },
  'header-text': { bad: 'WEBVTT\nKind: captions\n\n', good: `${H}NOTE Kind: captions\n` },
  'missing-final-line-terminator': { bad: `${H}${CUE}x`, good: `${H}${CUE}x\n` },
  'block-missing-blank-line': {
    bad: `${H}${CUE}a\n00:02.000 --> 00:03.000\nb\n`,
    good: `${H}${CUE}a\n\n00:02.000 --> 00:03.000\nb\n`,
  },
  'region-header-legacy': {
    bad: 'WEBVTT\nRegion: id=r width=40% lines=2\n\n00:00.000 --> 00:01.000 region:r\nx\n',
    good: `${H}REGION\nid:r width:40% lines:2\n\n00:00.000 --> 00:01.000 region:r\nx\n`,
  },
  'block-discarded': { bad: `${H}hello\n`, good: `${H}NOTE hello\n` },
  'style-after-cue': {
    bad: `${H}${CUE}x\n\nSTYLE\n::cue { color: red }\n`,
    good: `${H}STYLE\n::cue { color: red }\n\n${CUE}x\n`,
  },
  'region-after-cue': {
    bad: `${H}${CUE}x\n\nREGION\nid:r\n`,
    good: `${H}REGION\nid:r\n\n${CUE}x\n`,
  },
  'block-keyword-whitespace': {
    bad: `${H}STYLE\f\n::cue { color: red }\n`,
    good: `${H}STYLE \n::cue { color: red }\n`,
  },
  'style-empty': { bad: `${H}STYLE\n`, good: H },
  'note-contains-arrow': { bad: `${H}NOTE a --> b\n`, good: `${H}NOTE a -- b\n` },
  'cue-timings-invalid': { bad: `${H}00:00.000 --> soon\nx\n`, good: `${H}${CUE}x\n` },
  'timestamp-syntax': {
    bad: `${H}0:00:00.000 --> 00:01.000\nx\n`,
    good: `${H}00:00:00.000 --> 00:01.000\nx\n`,
  },
  'timestamp-legacy': {
    bad: `${H}00:00:01,000 --> 0:02.5\nx\n`,
    good: `${H}00:00:01.000 --> 00:02.500\nx\n`,
  },
  'timing-whitespace': {
    bad: `${H}00:00.000-->00:01.000\nx\n`,
    good: `${H}00:00.000\t-->  00:01.000\nx\n`,
  },
  'cue-start-order': {
    bad: `${H}00:02.000 --> 00:03.000\na\n\n${CUE}b\n`,
    good: `${H}${CUE}b\n\n00:02.000 --> 00:03.000\na\n`,
  },
  'cue-setting-legacy': {
    bad: `${H}00:00.000 --> 00:01.000 position:10%,middle align:middle\nx\n`,
    good: `${H}00:00.000 --> 00:01.000 position:10%,center align:center\nx\n`,
  },
  'cue-setting-out-of-range': {
    bad: `${H}00:00.000 --> 00:01.000 position:110% size:150%\nx\n`,
    good: `${H}00:00.000 --> 00:01.000 position:100% size:100%\nx\n`,
  },
  'cue-text-legacy-tag': {
    bad: `${H}00:00.000 --> 00:01.000\n<font color="yellow">one</font><br>two\n`,
    good: `${H}00:00.000 --> 00:01.000\n<c.yellow>one</c>\ntwo\n`,
  },
  'cue-id-keyword': { bad: `${H}NOTES\n${CUE}x\n`, good: `${H}notes\n${CUE}x\n` },
  'cue-end-not-after-start': {
    bad: `${H}00:01.000 --> 00:01.000\nx\n`,
    good: `${H}00:01.000 --> 00:01.001\nx\n`,
  },
  'cue-id-duplicate': {
    bad: `${H}a\n${CUE}x\n\na\n${CUE}y\n`,
    good: `${H}a\n${CUE}x\n\nb\n${CUE}y\n`,
  },
  'cue-settings-whitespace': {
    bad: `${H}00:00.000 --> 00:01.000 align:start \nx\n`,
    good: `${H}00:00.000 --> 00:01.000 \nx\n`,
  },
  'cue-setting-malformed': {
    bad: `${H}00:00.000 --> 00:01.000 align:\nx\n`,
    good: `${H}00:00.000 --> 00:01.000 align:end\nx\n`,
  },
  'cue-setting-unknown': {
    bad: `${H}00:00.000 --> 00:01.000 colour:red\nx\n`,
    good: `${H}${CUE}x\n`,
  },
  'cue-setting-duplicate': {
    bad: `${H}00:00.000 --> 00:01.000 align:start align:end\nx\n`,
    good: `${H}00:00.000 --> 00:01.000 align:end\nx\n`,
  },
  'cue-setting-value': {
    bad: `${H}00:00.000 --> 00:01.000 align:middle position:101% vertical:tb\nx\n`,
    good: `${H}00:00.000 --> 00:01.000 align:center position:100%,line-left vertical:rl line:-2,end size:50.5%\nx\n`,
  },
  'cue-line-not-integer': {
    bad: `${H}00:00.000 --> 00:01.000 line:1.5\nx\n`,
    good: `${H}00:00.000 --> 00:01.000 line:1.5%\nx\n`,
  },
  'cue-region-undefined': {
    bad: `${H}00:00.000 --> 00:01.000 region:r\nx\n`,
    good: `${H}${REGION}00:00.000 --> 00:01.000 region:r\nx\n`,
  },
  'cue-region-ignored': {
    bad: `${H}${REGION}00:00.000 --> 00:01.000 region:r line:0\nx\n`,
    good: `${H}${REGION}00:00.000 --> 00:01.000 region:r size:100% align:start\nx\n`,
  },
  'cue-text-character-reference': {
    bad: `${H}${CUE}AT&T &amp\n`,
    good: `${H}${CUE}AT&amp;T &amp; &#x1F600; &nbsp;\n`,
  },
  'cue-text-tag': { bad: `${H}${CUE}a <x>b</x> c <d\n`, good: `${H}${CUE}a &lt;x> b <i>c</i>\n` },
  'cue-text-class': { bad: `${H}${CUE}<c.>x</c>\n`, good: `${H}${CUE}<c.yellow.bg_blue>x</c>\n` },
  'cue-text-annotation': {
    bad: `${H}${CUE}<v>x</v> <b foo>y</b>\n`,
    good: `${H}${CUE}<v.loud Mary>x</v> <b>y</b>\n`,
  },
  'cue-text-nesting': {
    bad: `${H}${CUE}<b><i>x</b></i> <u>y\n`,
    good: `${H}${CUE}<v Bob><b><i>x</i></b> <u>y</u>\n`,
  },
  'cue-text-ruby': {
    bad: `${H}${CUE}<ruby>漢</ruby> <rt>x</rt> <ruby>a<rt>b</rt>c</ruby>\n`,
    good: `${H}${CUE}<ruby>漢<rt>kan</rt>字<rt>ji</ruby> <ruby>a<rt>b</rt> </ruby>\n`,
  },
  'cue-text-timestamp': {
    bad: `${H}${CUE}a<00:00.500>b<00:00.400>c<00:01.000>d<00:00:00.6>\n`,
    good: `${H}${CUE}a<00:00.400>b<00:00:00.500>c\n`,
  },
  'cue-text-language': {
    bad: `${H}${CUE}<lang en_US>x</lang>\n`,
    good: `${H}${CUE}<lang en-US>x <lang zh-Hant-TW>y</lang></lang>\n`,
  },
  'chapter-title-markup': {
    bad: `${H}${CUE}<b>Intro</b>\n`,
    good: `${H}${CUE}Intro &amp; overview\n`,
    fileType: 'chapters',
  },
  'chapters-not-nested': {
    bad: `${H}00:00.000 --> 01:00.000\nA\n\n00:30.000 --> 01:30.000\nB\n`,
    good: `${H}00:00.000 --> 01:30.000\nA\n\n00:30.000 --> 01:30.000\nB\n`,
    fileType: 'chapters',
  },
  'region-id-missing': { bad: `${H}REGION\nwidth:40%\n`, good: `${H}REGION\nid:r width:40%\n` },
  'region-id-duplicate': { bad: `${H}${REGION}${REGION}`, good: `${H}${REGION}REGION\nid:s\n` },
  'region-settings-whitespace': {
    bad: `${H}REGION\nid:r width:40% \n`,
    good: `${H}REGION\nid:r\twidth:40%\nlines:2 scroll:up\n`,
  },
  'region-setting-malformed': {
    bad: `${H}REGION\nid:r width:\n`,
    good: `${H}REGION\nid:r width:0%\n`,
  },
  'region-setting-unknown': { bad: `${H}REGION\nid:r height:40%\n`, good: `${H}${REGION}` },
  'region-setting-duplicate': {
    bad: `${H}REGION\nid:r lines:2 lines:3\n`,
    good: `${H}REGION\nid:r lines:3\n`,
  },
  'region-setting-value': {
    bad: `${H}REGION\nid:r width:200% regionanchor:0%\n`,
    good: `${H}REGION\nid:r width:100% regionanchor:0%,100% viewportanchor:10.5%,90%\n`,
  },
  'style-css-syntax': {
    bad: `${H}STYLE\n::cue { color: red\n`,
    good: `${H}STYLE\n::cue {\n  color: red;\n}\n/* comment */\n::cue(b) { font-weight: bold }\n`,
  },
  'style-selector': {
    bad: `${H}STYLE\nvideo { color: red }\n`,
    good: `${H}STYLE\nvideo::cue { color: red }\n`,
  },
  'style-property-ignored': {
    bad: `${H}STYLE\n::cue { display: none; position: absolute }\n::cue(:past) { font-size: 2em }\n`,
    good: `${H}STYLE\n::cue { --x: 1; background: black; outline: 1px solid; ruby-position: under }\n::cue(v[voice="Bob"]) { transition: color 1s }\n::cue-region { color: blue }\n`,
  },
};

const codesOf = (text: string, fileType?: FileType): DiagnosticCode[] =>
  validate(text, fileType ? { fileType } : {}).diagnostics.map((d) => d.code);

describe('every diagnostic code', () => {
  for (const [code, c] of Object.entries(CASES) as [DiagnosticCode, Case][]) {
    it(`${code}: reported for the bad example`, () => {
      expect(codesOf(c.bad, c.fileType)).toContain(code);
    });
    it(`${code}: clean for the good example`, () => {
      expect(validate(c.good, c.fileType ? { fileType: c.fileType } : {}).diagnostics).toEqual([]);
    });
  }

  it('covers every code except the model-only ones', () => {
    const covered = new Set([
      ...Object.keys(CASES),
      'cue-id-invalid',
      'region-id-invalid',
      'file-encoding', // About bytes, reported on import (see legacy.test.ts).
    ]);
    expect(Object.keys(DIAGNOSTICS).filter((c) => !covered.has(c))).toEqual([]);
  });

  it('links every code to a spec anchor', () => {
    for (const code of Object.keys(DIAGNOSTICS) as DiagnosticCode[]) {
      expect(specUrl(code)).toMatch(/^https:\/\/w3c\.github\.io\/webvtt\/#[a-z0-9-]+$/);
    }
  });
});

describe('diagnostic details', () => {
  it('points at the offending text in the normalized input', () => {
    const text = `${H}${CUE}AT&T\n`;
    const result = validate(text);
    const [d] = result.diagnostics;
    expect(result.normalized.slice(d!.range.start, d!.range.end)).toBe('&T');
  });

  it('accepts the optional voice end tag only when the voice span is the whole cue', () => {
    expect(codesOf(`${H}${CUE}<v Bob>hello\n`)).toEqual([]);
    expect(codesOf(`${H}${CUE}hi <v Bob>hello\n`)).toContain('cue-text-nesting');
  });

  it('treats any payload as valid metadata, and checks only structure', () => {
    expect(codesOf(`${H}${CUE}{"x": "<&>"}\n`, 'metadata')).toEqual([]);
    expect(codesOf(`${H}${CUE}{"x": "<&>"}\n`)).not.toEqual([]);
  });

  it('accepts real auto-caption structure apart from the header lines', () => {
    const text =
      'WEBVTT\nKind: captions\nLanguage: en\n\n00:00:00.240 --> 00:00:04.070 align:start position:0%\n \n69<00:00:00.960><c> bajillion</c><00:00:01.680><c> tokens,</c>\n\n00:00:04.070 --> 00:00:04.080 align:start position:0%\n69 bajillion tokens,\n \n';
    expect(codesOf(text)).toEqual(['header-text']);
  });
});

describe('docs/DIAGNOSTICS.md', () => {
  it('is up to date with the registry (run: node scripts/diagnostics-doc.mjs)', async () => {
    const { readFileSync } = await import('node:fs');
    // @ts-expect-error -- plain JS module outside the package
    const { render } = (await import('../../../scripts/diagnostics-doc.mjs')) as {
      render: () => string;
    };
    const committed = readFileSync(
      new URL('../../../docs/DIAGNOSTICS.md', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(render());
  });
});
