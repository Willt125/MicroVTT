/** Editing markup in raw cue text: spans, wrapping, unwrapping, clearing, and word timings. */
import { describe, expect, it } from 'vitest';
import type { MarkupKind } from '../src/index.ts';
import {
  SRT_TEXT,
  WEBVTT_TEXT,
  classProblem,
  clearMarkup,
  cueWords,
  insertTimestamp,
  languageProblem,
  markupSpans,
  removeSpan,
  removeTimestamp,
  setTimestamp,
  spanTags,
  spansAt,
  spreadWordTimes,
  timeWords,
  timestampProblems,
  timestampTags,
  unwrapRange,
  wellFormedRange,
  wrapRange,
} from '../src/index.ts';

/** `text` with `|` marking a selection's edges (one `|` for a caret). */
function sel(marked: string): [string, number, number] {
  const a = marked.indexOf('|');
  const b = marked.indexOf('|', a + 1);
  const text = marked.replace(/\|/g, '');
  return b === -1 ? [text, a, a] : [text, a, b - 1];
}
const show = (e: { text: string; start: number; end: number }): string =>
  e.start === e.end
    ? e.text.slice(0, e.start) + '|' + e.text.slice(e.start)
    : e.text.slice(0, e.start) + '|' + e.text.slice(e.start, e.end) + '|' + e.text.slice(e.end);

/** End tags that close nothing (the parser ignores them): a sign of crossed markup. */
function strayEndTags(text: string, kind: MarkupKind = 'webvtt'): number {
  const closes = new Set(markupSpans(text, kind).map((s) => s.close?.start));
  const re = kind === 'srt' ? /<\/[a-zA-Z]+>/g : /<\/[^>]*>/g;
  return [...text.matchAll(re)].filter((m) => !closes.has(m.index)).length;
}

describe('spans', () => {
  it('finds WebVTT spans as the parser builds them', () => {
    const text = '<v.loud Bob  Smith>Hi <i>there</b></i><ruby>漢<rt>かん</ruby> <lang fr>oui';
    const spans = markupSpans(text);
    expect(spans.map((s) => [s.name, s.classes, s.annotation, s.close !== null])).toEqual([
      ['v', ['loud'], 'Bob Smith', false],
      ['i', [], '', true],
      ['ruby', [], '', true],
      ['rt', [], '', false],
      ['lang', [], 'fr', false],
    ]);
    const i = spans[1];
    expect(i && text.slice(i.inner.start, i.inner.end)).toBe('there</b>'); // </b> closes nothing.
    const rt = spans[3];
    expect(rt && text.slice(rt.inner.start, rt.inner.end)).toBe('かん');
  });

  it('finds SubRip spans, any case, an end tag closing the latest span it names', () => {
    const spans = markupSpans('<I>a <font color="red">b</I> c</font>', 'srt');
    expect(spans.map((s) => [s.name, s.annotation, s.close !== null])).toEqual([
      ['i', '', true],
      ['font', 'color="red"', true],
    ]);
  });

  it('lists the spans at the caret, outermost first', () => {
    const [text, a] = sel('<v Bob>Hello <i>the|re</i></v>');
    expect(spansAt(text, a).map((s) => s.name)).toEqual(['v', 'i']);
    expect(spansAt(text, 0).map((s) => s.name)).toEqual([]);
  });
});

describe('wrapping', () => {
  const wrap = (marked: string, name: 'i' | 'b' = 'b', kind: MarkupKind = 'webvtt'): string => {
    const [text, a, b] = sel(marked);
    return show(wrapRange(text, a, b, `<${name}>`, `</${name}>`, kind));
  };

  it('wraps the selection and keeps it selected', () => {
    expect(wrap('a |bc| d')).toBe('a <b>|bc|</b> d');
    expect(wrap('a | d')).toBe('a <b>|</b> d');
  });

  it('never splits a tag or a character reference', () => {
    expect(wrap('<i|>x</i>|')).toBe('<b>|<i>x</i>|</b>');
    expect(wrap('a &a|mp; b|')).toBe('a <b>|&amp; b|</b>');
  });

  it('grows the selection so spans do not cross', () => {
    expect(wrap('<i>a|b</i>c|')).toBe('<b>|<i>ab</i>c|</b>');
    expect(wrap('|a<i>b|c</i>')).toBe('<b>|a<i>bc</i>|</b>');
    expect(wrap('<i>a|b</i>|')).toBe('<b>|<i>ab</i>|</b>');
    expect(wrap('<i>|ab|</i>')).toBe('<i><b>|ab|</b></i>');
    // An unclosed span runs to the end: wrapping its end stays inside it.
    expect(wrap('<i>a|bc|')).toBe('<i>a<b>|bc|</b>');
  });

  it('wraps SubRip text', () => {
    expect(wrap('<I>a|b</I> c|', 'i', 'srt')).toBe('<i>|<I>ab</I> c|</i>');
  });

  it('builds tags with escaped annotations', () => {
    expect(spanTags({ name: 'c', classes: ['a', 'b'] })).toEqual(['<c.a.b>', '</c>']);
    expect(spanTags({ name: 'v', voice: ' Tom & <Jerry> ' })).toEqual([
      '<v Tom &amp; <Jerry&gt;>',
      '</v>',
    ]);
    expect(spanTags({ name: 'lang', language: 'pt-BR' })).toEqual(['<lang pt-BR>', '</lang>']);
    expect(spanTags({ name: 'ruby', annotation: 'a<b' })).toEqual([
      '<ruby>',
      '<rt>a&lt;b</rt></ruby>',
    ]);
    expect(classProblem('ok-1')).toBeNull();
    expect(classProblem('two words')).not.toBeNull();
    expect(languageProblem('fr')).toBeNull();
    expect(languageProblem('not a tag')).not.toBeNull();
  });
});

describe('unwrapping and clearing', () => {
  const unwrap = (marked: string, name: string, kind: MarkupKind = 'webvtt'): string => {
    const [text, a, b] = sel(marked);
    const span = spansAt(text, a, b, kind)
      .filter((s) => s.name === name)
      .at(-1);
    if (!span) throw new Error(`not in ${name}`);
    return show(unwrapRange(text, span, a, b, kind));
  };

  it('removes the whole span for a caret or a selection covering it', () => {
    expect(unwrap('x <i>a|b</i> y', 'i')).toBe('x a|b y');
    expect(unwrap('<i>|ab|</i>', 'i')).toBe('|ab|');
  });

  it('takes part of a span out, closing and reopening around it', () => {
    expect(unwrap('<i>a|b|c</i>', 'i')).toBe('<i>a</i>|b|<i>c</i>');
    expect(unwrap('<i>|ab|c</i>', 'i')).toBe('|ab|<i>c</i>');
    expect(unwrap('<i>a|bc|</i>', 'i')).toBe('<i>a</i>|bc|');
    // Spans inside it that the selection is in are closed and reopened too.
    expect(unwrap('<i>a<b>b|c|d</b></i>', 'i')).toBe('<i>a<b>b</b></i><b>|c|</b><i><b>d</b></i>');
    expect(unwrap('<I>a|b|c</I>', 'i', 'srt')).toBe('<I>a</I>|b|<I>c</I>');
  });

  it('removes ruby text with its ruby', () => {
    const text = 'x<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>';
    const ruby = markupSpans(text).find((s) => s.name === 'ruby');
    expect(ruby && removeSpan(text, ruby)).toBe('x漢字');
    const rt = markupSpans(text).find((s) => s.name === 'rt');
    expect(rt && removeSpan(text, rt)).toBe('x<ruby>漢字<rt>じ</rt></ruby>');
  });

  it('clears spans wholly in the selection, or in all the text', () => {
    const [text, a, b] = sel('<v Bob>|<i>a</i> <b>b|</b> c</v> <00:01.000>d');
    expect(show(clearMarkup(text, a, b))).toBe('<v Bob>|a b| c</v> <00:01.000>d');
    expect(clearMarkup(text, 0, 0).text).toBe('a b c <00:01.000>d');
  });

  it('keeps the readable text and leaves no stray end tags (random edits)', () => {
    const samples = [
      '<v Bob>Hello <i>there</i></v> &amp; <b>you</b>',
      '<c.a>one <u>two</u> three</c> <ruby>漢<rt>かん</rt></ruby>字',
      '<i>unclosed <b>both',
      'plain words only',
      '<lang fr>oui <i>non</i></lang><00:00:01.000> fin',
    ];
    let seed = 7;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let k = 0; k < 2000; k++) {
      const text = samples[k % samples.length] as string;
      const a = rand(text.length + 1);
      const b = a + rand(text.length + 1 - a);
      const wrapped = wrapRange(text, a, b, '<b>', '</b>');
      expect(WEBVTT_TEXT.readableLines(wrapped.text)).toEqual(WEBVTT_TEXT.readableLines(text));
      expect(strayEndTags(wrapped.text)).toBe(strayEndTags(text));
      const r = wellFormedRange(text, a, b);
      for (const span of spansAt(text, r.start, r.end).filter(
        (s) => s.name !== 'rt' && s.name !== 'ruby',
      )) {
        const out = unwrapRange(text, span, a, b);
        expect(WEBVTT_TEXT.readableLines(out.text)).toEqual(WEBVTT_TEXT.readableLines(text));
        expect(strayEndTags(out.text)).toBe(strayEndTags(text));
      }
      const cleared = clearMarkup(text, a, b);
      expect(strayEndTags(cleared.text)).toBe(0 + strayEndTags(text));
    }
  });

  it('SubRip edits keep the readable text', () => {
    const text = '<i>one <b>two</b> three</i> {\\an8}four';
    for (let a = 0; a <= text.length; a++)
      for (let b = a; b <= text.length; b += 3) {
        const out = wrapRange(text, a, b, '<u>', '</u>', 'srt');
        expect(SRT_TEXT.readableLines(out.text)).toEqual(SRT_TEXT.readableLines(text));
      }
  });
});

describe('word timings', () => {
  const text = 'One <00:00:01.500>two <i>three</i><00:00:02.000>';

  it('lists, sets, removes and inserts timestamps', () => {
    expect(timestampTags(text).map((t) => t.ms)).toEqual([1500, 2000]);
    expect(setTimestamp(text, 1, 2500)).toBe('One <00:00:01.500>two <i>three</i><00:00:02.500>');
    expect(removeTimestamp(text, 0)).toBe('One two <i>three</i><00:00:02.000>');
    expect(() => setTimestamp(text, 2, 0)).toThrow(RangeError);
    expect(insertTimestamp('a <i>b</i>', 4, 61_000)).toEqual({
      text: 'a <00:01:01.000><i>b</i>',
      caret: 16,
    });
  });

  it('checks timings are inside the cue and in order', () => {
    expect(timestampProblems(text, 1000, 3000)).toEqual([]);
    expect(timestampProblems(text, 1000, 1800).map((p) => p.index)).toEqual([1]);
    // One outside the cue does not make the next one out of order too.
    expect(timestampProblems('a<00:05.000>b<00:02.000>c', 1000, 3000).map((p) => p.index)).toEqual([
      0,
    ]);
    expect(timestampProblems('<00:02.000>a<00:01.500>b', 1000, 3000).map((p) => p.index)).toEqual([
      1,
    ]);
  });

  it('finds words, skipping markup, timestamps and ruby text', () => {
    const words = cueWords('<v Bob>Hi <ruby>漢<rt>かん</rt></ruby> &amp; <i>you</i>!');
    expect(words.map((w) => w.word)).toEqual(['Hi', '漢', 'you']);
    expect(cueWords('a<00:01.000>b c').map((w) => w.word)).toEqual(['ab', 'c']);
    expect(cueWords('x', 'not a tag!').map((w) => w.word)).toEqual(['x']);
  });

  it('times words: one timing before each word after the first', () => {
    expect(timeWords('One two <i>three</i>', [1500, 2000])).toBe(
      'One <00:00:01.500>two <i><00:00:02.000>three</i>',
    );
    // Replaces the timings it had; extra times are ignored.
    expect(timeWords(text, [1200, 1300, 9999])).toBe(
      'One <00:00:01.200>two <i><00:00:01.300>three</i>',
    );
  });

  it('spreads the cue across its words by their length', () => {
    expect(spreadWordTimes('aa b aaaaa', 0, 8000)).toEqual([2000, 3000]);
    expect(spreadWordTimes('single', 0, 1000)).toEqual([]);
  });
});
