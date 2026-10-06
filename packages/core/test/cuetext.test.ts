/**
 * Cue text parsing cases the WPT .dat files do not cover: numeric character references,
 * annotations, classes, the language stack, and chapter titles.
 */
import { describe, expect, it } from 'vitest';
import type { CueNode, CueSpanNode } from '../src/index.ts';
import { consumeCharacterReference, extractChapterTitle, parseCueText } from '../src/index.ts';

/** Decodes `&...` at the start of `input` the way the data state does. */
const ref = (input: string): string | null => consumeCharacterReference(input, 1)?.value ?? null;

describe('numeric character references', () => {
  it.each([
    ['&#65;', 'A'],
    ['&#x41;', 'A'],
    ['&#X41;', 'A'],
    ['&#65', 'A'], // Missing semicolon: parse error, still a reference.
    ['&#x1F600;', '\u{1F600}'],
    ['&#0;', '�'],
    ['&#x80;', '€'], // Windows-1252 remapping of C1 controls.
    ['&#x9F;', 'Ÿ'],
    ['&#x81;', '\u0081'], // Not in the remapping table: returned as is.
    ['&#xD800;', '�'], // Surrogate.
    ['&#x110000;', '�'], // Beyond Unicode.
    [`&#${'9'.repeat(40)};`, '�'], // Overflow must not wrap around.
  ])('%s → %j', (input, expected) => {
    expect(ref(input)).toBe(expected);
  });

  it.each(['&#;', '&#x;', '&#xg;', '&#a'])('%s is not a reference', (input) => {
    expect(ref(input)).toBeNull();
  });

  it('reports how much was consumed', () => {
    expect(consumeCharacterReference('&#65;x', 1)).toEqual({ value: 'A', end: 5 });
    expect(consumeCharacterReference('&#65x', 1)).toEqual({ value: 'A', end: 4 });
    expect(consumeCharacterReference('&notin;', 1)).toEqual({ value: '∉', end: 7 });
    expect(consumeCharacterReference('&notit;', 1)).toEqual({ value: '¬', end: 4 });
  });

  it('honours the additional allowed character', () => {
    expect(consumeCharacterReference('&>', 1, 0x3e)).toBeNull();
    expect(consumeCharacterReference('&amp;', 1, 0x3e)?.value).toBe('&');
  });
});

const spans = (nodes: CueNode[]): CueSpanNode[] =>
  nodes.filter((n): n is CueSpanNode => n.type !== 'text' && n.type !== 'timestamp');

describe('parseCueText', () => {
  it('collects classes, dropping empty ones', () => {
    const [span] = spans(parseCueText('<c.a..b.>x</c>').children);
    expect(span?.classes).toEqual(['a', 'b']);
  });

  it('normalizes voice annotations and decodes references in them', () => {
    const [voice] = spans(parseCueText('<v.loud \t Roger \n Bingham &amp; co>hi').children);
    expect(voice).toMatchObject({ type: 'v', classes: ['loud'], annotation: 'Roger Bingham & co' });
  });

  it('keeps a ">" that is not a reference terminator out of annotations', () => {
    const [voice, text] = parseCueText('<v a&>b').children;
    expect(voice).toMatchObject({ type: 'v', annotation: 'a&' });
    expect((voice as CueSpanNode).children).toEqual([{ type: 'text', value: 'b' }]);
    expect(text).toBeUndefined();
  });

  it('tracks the language stack', () => {
    const root = parseCueText('<lang en>a<i>b</i><lang fr>c</lang>d</lang>e', 'de');
    const [en, e] = root.children as [CueSpanNode, CueNode];
    expect(root.language).toBe('de');
    expect(en.language).toBe('en');
    const [, italic, fr] = en.children as [CueNode, CueSpanNode, CueSpanNode];
    expect(italic.language).toBe('en');
    expect(fr.language).toBe('fr');
    expect(e).toEqual({ type: 'text', value: 'e' });
  });

  it('ignores unknown tags and mismatched end tags', () => {
    const root = parseCueText('<x>a</b><i>b</x>c</i>d');
    expect(root.children).toEqual([
      { type: 'text', value: 'a' },
      {
        type: 'i',
        classes: [],
        language: undefined,
        annotation: '',
        children: [
          { type: 'text', value: 'b' },
          { type: 'text', value: 'c' },
        ],
      },
      { type: 'text', value: 'd' },
    ]);
  });

  it('only accepts rt directly inside ruby', () => {
    expect(spans(parseCueText('<rt>a</rt>').children)).toEqual([]);
    const [ruby] = spans(parseCueText('<ruby>base<rt>text</ruby>after').children);
    expect(ruby?.children.map((n) => n.type)).toEqual(['text', 'rt']);
  });

  it('parses YouTube-style word timing', () => {
    const root = parseCueText('so<00:00:01.500><c> word</c>');
    expect(root.children).toEqual([
      { type: 'text', value: 'so' },
      { type: 'timestamp', ms: 1500 },
      {
        type: 'c',
        classes: [],
        language: undefined,
        annotation: '',
        children: [{ type: 'text', value: ' word' }],
      },
    ]);
  });

  it('drops timestamp tags with trailing characters', () => {
    expect(parseCueText('<00:01.000x>').children).toEqual([]);
  });

  it('does not normalize Unicode (spec §2.2)', () => {
    const decomposed = 'Å';
    expect(parseCueText(decomposed).children).toEqual([{ type: 'text', value: decomposed }]);
  });
});

describe('extractChapterTitle', () => {
  it('concatenates text, skipping ruby text', () => {
    expect(
      extractChapterTitle('<b>Intro</b> &amp; <ruby>漢<rt>kan</rt></ruby>字<00:01.000>!'),
    ).toBe('Intro & 漢字!');
  });
});
