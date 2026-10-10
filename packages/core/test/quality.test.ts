/** Style and accessibility checks: measuring, each rule, rulesets, and fixes. */
import { describe, expect, it } from 'vitest';
import type { Cue, QualityFinding, Ruleset, VttDocument } from '../src/index.ts';
import {
  BBC_SUBTITLES,
  LITE,
  NETFLIX_EN_US_ADULT,
  NETFLIX_EN_US_CHILDREN,
  NETFLIX_FI_ADULT,
  NETFLIX_FI_CHILDREN,
  NETFLIX_FI_SDH,
  NETFLIX_FI_SDH_CHILDREN,
  NETFLIX_TEMPLATE_EN,
  NETFLIX_TEMPLATE_EN_CHILDREN,
  RULES,
  RULESETS,
  WCAG,
  applyQualityFix,
  applyQualityFixes,
  balanceLines,
  checkQuality,
  contrastRatio,
  createCue,
  createDocument,
  graphemeLength,
  inNetflixGlyphList,
  parseColour,
  readableLines,
  wordCount,
  breakUnits,
  joinLines,
} from '../src/index.ts';

const doc = (...cues: Cue[]): VttDocument => ({ ...createDocument(), body: cues });
const withStyle = (css: string): VttDocument => ({
  ...createDocument(),
  head: [{ type: 'style', css }],
  body: [createCue(0, 2000, 'Hello')],
});
/** A ruleset of one rule, for testing rules alone. */
const only = (id: keyof Ruleset['rules'], params?: Record<string, number>): Ruleset => ({
  id: 'test',
  name: 'test',
  description: '',
  sources: [],
  notChecked: [],
  rules: { [id]: { severity: 'warning', ...(params ? { params } : {}) } },
});
const rules = (findings: QualityFinding[]): string[] => findings.map((f) => f.rule);

describe('measuring', () => {
  it('reads cue text as a viewer does', () => {
    expect(readableLines('<v Bob>Hi <i>there</i></v>\n&amp; <ruby>漢<rt>kan</rt></ruby>')).toEqual([
      'Hi there',
      '& 漢',
    ]);
    expect(readableLines('so<00:00:01.000><c> it</c>')).toEqual(['so it']);
  });

  it('counts graphemes, not UTF-16 units', () => {
    // Devanagari: 6 code units, 3 or 4 graphemes depending on the Unicode version (15.1 keeps
    // the conjunct स्ते together).
    expect(graphemeLength('नमस्ते')).toBeLessThanOrEqual(4);
    expect(graphemeLength('👍🏽ok')).toBe(3);
    expect(graphemeLength('é')).toBe(1); // e + combining acute
    expect(wordCount('Well -- I mean, it’s 3 a.m.!')).toBe(6);
    expect(wordCount('我们今天去公园。')).toBeGreaterThan(2);
  });

  it('balances lines bottom-heavy', () => {
    expect(balanceLines('one two three'.split(' '), 42)).toEqual(['one two three']);
    expect(balanceLines('I always knew that you would agree with me'.split(' '), 25)).toEqual([
      'I always knew that',
      'you would agree with me',
    ]);
    expect(balanceLines(['supercalifragilistic'], 5)).toBeNull();
  });

  it('breaks and joins lines by script', () => {
    const shown = (text: string) => breakUnits(text).map((u) => u.gap + u.text);
    expect(shown('Hello there,\nfriend.')).toEqual(['Hello', ' there,', ' friend.']);
    // Punctuation stays with its word; Japanese endings in hiragana stay with the word before.
    expect(shown('「こんにちは」と言った。')).toEqual(['「こんにちは」と', '言った。']);
    expect(shown('我们今天去公园，好吗？').join('')).toBe('我们今天去公园，好吗？');
    expect(shown('我们今天去公园，好吗？').length).toBeGreaterThan(2);
    expect(joinLines(['東京に', '行きます。'])).toBe('東京に行きます。');
    expect(joinLines(['สวัสดีครับ', 'วันนี้'])).toBe('สวัสดีครับ วันนี้');
    expect(joinLines(['Hello', 'there '])).toBe('Hello there');
    const lines = balanceLines(breakUnits('我们今天去公园，你也一起来吗？'), 10);
    expect(lines?.join('')).toBe('我们今天去公园，你也一起来吗？');
    expect(lines?.every((l) => !l.includes(' ') && l.length <= 10)).toBe(true);
  });

  it('reads CSS colours and computes WCAG contrast', () => {
    expect(parseColour('#ff0')).toEqual({ r: 255, g: 255, b: 0, a: 1 });
    expect(parseColour('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColour('lime')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseColour('var(--x)')).toBeNull();
    const white = parseColour('white')!;
    const black = parseColour('black')!;
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
  });
});

describe('rules', () => {
  it('timing: duration limits, gaps and overlaps, with fixes where clear', () => {
    const d = doc(
      createCue(0, 300, 'Quick'),
      createCue(1000, 9000, 'Long'),
      createCue(9040, 9500, 'x'),
    );
    const short = checkQuality(d, only('min-duration', { minMs: 500 }));
    expect(short.map((f) => f.index)).toEqual([0, 2]);
    expect(short[0]?.fix?.change).toEqual({ kind: 'times', startMs: 0, endMs: 500 });
    expect(short[1]?.fix).toBeDefined(); // Nothing after it.
    const blocked = checkQuality(
      doc(createCue(0, 300, 'a'), createCue(400, 900, 'b')),
      only('min-duration', { minMs: 500 }),
    );
    expect(blocked[0]?.fix).toBeUndefined(); // Lengthening would run into the next cue.
    expect(checkQuality(d, only('max-duration', { maxMs: 7000 })).map((f) => f.index)).toEqual([1]);
    const gap = checkQuality(d, only('min-gap', { minMs: 80 }));
    expect(gap.map((f) => f.index)).toEqual([1]);
    expect(gap[0]?.fix?.change).toEqual({ kind: 'times', startMs: 1000, endMs: 9040 });
    const overlap = checkQuality(
      doc(createCue(0, 2000, 'a'), createCue(1500, 3000, 'b')),
      only('overlap'),
    );
    expect(overlap[0]?.fix?.change).toEqual({ kind: 'times', startMs: 0, endMs: 1500 });
  });

  it('frame gaps: exactly two frames, or at least half a second', () => {
    const pair = (gap: number) => doc(createCue(0, 2000, 'a'), createCue(2000 + gap, 4000, 'b'));
    const gaps = (gap: number, fps?: number) =>
      checkQuality(pair(gap), only('frame-gaps'), {}, fps ? { fps } : {});
    // Two frames at 24 fps is 83.3 ms; times are whole ms.
    expect(gaps(83)).toEqual([]);
    expect(gaps(84)).toEqual([]);
    expect(gaps(500)).toEqual([]);
    expect(gaps(0)[0]?.message).toMatch(/Only 0 frames/);
    const close = gaps(200)[0];
    expect(close?.message).toMatch(/close it to 2 frames/);
    expect(close?.fix?.change).toEqual({ kind: 'times', startMs: 0, endMs: 2117 });
    // At 25 fps two frames are 80 ms; the video's rate is used unless the user set one.
    expect(gaps(80, 25)).toEqual([]);
    expect(gaps(83, 25)).toHaveLength(1);
    expect(
      checkQuality(
        pair(80),
        only('frame-gaps'),
        { 'frame-gaps': { params: { fps: 24 } } },
        { fps: 25 },
      ),
    ).toHaveLength(1);
  });

  it('reading speed in characters and words', () => {
    // 21 characters in 1 s.
    const fast = doc(createCue(0, 1000, 'abcdefghij klmnopqrst'));
    expect(rules(checkQuality(fast, only('chars-per-second', { max: 20 })))).toEqual([
      'chars-per-second',
    ]);
    expect(checkQuality(fast, only('chars-per-second', { max: 21 }))).toEqual([]);
    // 4 words in 1 s is 240 words per minute.
    const words = doc(createCue(0, 1000, 'one two three four'));
    expect(checkQuality(words, only('words-per-minute', { max: 180 }))[0]?.message).toMatch(
      /240 words/,
    );
  });

  it('layout: lines, length, shape, breaks and centring', () => {
    const long = createCue(0, 5000, 'I always knew that you would eventually agree with me');
    const [f] = checkQuality(doc(long), only('line-length', { max: 42 }));
    expect(f?.message).toMatch(/Line 1 has 53 characters/);
    expect(f?.fix?.change).toEqual({
      kind: 'text',
      text: 'I always knew that you\nwould eventually agree with me',
    });
    // No rewrap offered when the text has markup.
    expect(
      checkQuality(
        doc(createCue(0, 5000, `<i>${long.text}</i>`)),
        only('line-length', { max: 42 }),
      )[0]?.fix,
    ).toBeUndefined();
    expect(
      rules(checkQuality(doc(createCue(0, 1000, 'a\nb\nc')), only('max-lines', { max: 2 }))),
    ).toEqual(['max-lines']);
    const topHeavy = doc(createCue(0, 3000, 'This line is the longer one\nshort'));
    expect(checkQuality(topHeavy, only('line-shape'))[0]?.message).toMatch(/top line is longer/);
    expect(
      checkQuality(doc(createCue(0, 3000, 'So\nthis is how it goes')), only('line-shape'))[0]
        ?.message,
    ).toMatch(/one or two words/);
    expect(
      checkQuality(doc(createCue(0, 3000, 'He put it on the\ntable')), only('line-break-words'))[0]
        ?.message,
    ).toMatch(/“the”/);
    expect(
      checkQuality(
        doc(createCue(0, 3000, 'He put it on the table,\nthen left')),
        only('line-break-words'),
      ),
    ).toEqual([]);
    const left = { ...createCue(0, 1000, 'x'), align: 'start' as const };
    expect(checkQuality(doc(left), only('centred'))[0]?.fix?.change).toEqual({ kind: 'centre' });
  });

  it('the Netflix glyph list', () => {
    for (const ch of 'aZé…♪’–ñ漢한ありがとうЖ')
      expect(inNetflixGlyphList(ch.codePointAt(0)!), ch).toBe(true);
    for (const ch of ['😀', '\u200d', '\u200e'])
      expect(inNetflixGlyphList(ch.codePointAt(0)!)).toBe(false);
    expect(checkQuality(doc(createCue(0, 2000, 'Café… ♪ 漢字')), only('glyph-list'))).toEqual([]);
    expect(
      checkQuality(doc(createCue(0, 2000, 'So happy 😀\u200e')), only('glyph-list'))[0]?.message,
    ).toBe('Not in the Netflix glyph list: 😀 (U+1F600), (U+200E).');
  });

  it('one line when the text fits', () => {
    const [f] = checkQuality(
      doc(createCue(0, 2000, 'I might become\nthe first lady.')),
      only('single-line'),
    );
    expect(f?.fix?.change).toEqual({ kind: 'text', text: 'I might become the first lady.' });
    expect(
      checkQuality(doc(createCue(0, 2000, '-Are you coming?\n-In a minute.')), only('single-line')),
    ).toEqual([]);
    expect(
      checkQuality(
        doc(
          createCue(0, 2000, 'I might become the first lady\nof this church, or so they tell me.'),
        ),
        only('single-line'),
      ),
    ).toEqual([]);
  });

  it('joins and rewraps Chinese and Japanese without spaces', () => {
    const [joined] = checkQuality(
      doc(createCue(0, 2000, '東京に\n行きます。')),
      only('single-line'),
    );
    expect(joined?.fix?.change).toEqual({ kind: 'text', text: '東京に行きます。' });
    const [wrapped] = checkQuality(
      doc(createCue(0, 3000, '今日はいい天気ですね。散歩に行きましょう。')),
      only('line-length', { max: 13 }),
    );
    expect(wrapped?.fix?.change).toEqual({
      kind: 'text',
      text: '今日はいい天気ですね。\n散歩に行きましょう。',
    });
  });

  it('text: characters and conventions, with fixes', () => {
    const fixOf = (text: string, id: keyof Ruleset['rules']): string | undefined => {
      const change = checkQuality(doc(createCue(0, 3000, text)), only(id))[0]?.fix?.change;
      return change?.kind === 'text' ? change.text : undefined;
    };
    expect(fixOf('Had I known...', 'ellipsis-character')).toBe('Had I known…');
    expect(fixOf('Two  spaces', 'double-space')).toBe('Two spaces');
    expect(fixOf('- Are you coming?\n- In a minute.', 'speaker-hyphen')).toBe(
      '-Are you coming?\n-In a minute.',
    );
    expect(fixOf('<i>- Yes</i>', 'speaker-hyphen')).toBe('<i>-Yes</i>');
    expect(fixOf('OK, fine. OK? It is Ok.', 'okay-spelling')).toBe('Okay, fine. Okay? It is okay.');
    expect(fixOf('Empty  ', 'double-space')).toBe('Empty ');
    expect(
      rules(checkQuality(doc(createCue(0, 1000, 'Wait – what?')), only('dash-characters'))),
    ).toEqual(['dash-characters']);
    expect(
      rules(checkQuality(doc(createCue(0, 1000, '[DOOR SLAMS]')), only('lowercase-labels'))),
    ).toEqual(['lowercase-labels']);
    expect(checkQuality(doc(createCue(0, 1000, '[Kimmy] Hi')), only('lowercase-labels'))).toEqual(
      [],
    );
    expect(checkQuality(doc(createCue(0, 1000, '♪ La la la ♪')), only('lyrics-notes'))).toEqual([]);
    expect(rules(checkQuality(doc(createCue(0, 1000, '♪La la la')), only('lyrics-notes')))).toEqual(
      ['lyrics-notes'],
    );
    expect(fixOf('It’s “fine”…', 'bbc-characters')).toBe('It\'s "fine"...');
    expect(
      checkQuality(doc(createCue(0, 1000, 'Café')), only('bbc-characters'))[0]?.message,
    ).toMatch(/é/);
    expect(
      checkQuality(doc(createCue(0, 1000, "It's £5 & 50% off! (Really?)")), only('bbc-characters')),
    ).toEqual([]);
    const empty = checkQuality(doc(createCue(0, 1000, ' <i></i> ')), only('empty-cue'));
    expect(empty[0]?.fix?.change).toEqual({ kind: 'delete' });
  });

  it('accessibility: contrast of style sheet colours, and BBC colours', () => {
    expect(checkQuality(withStyle('::cue { color: yellow }'), WCAG)).toEqual([]);
    const grey = checkQuality(withStyle('::cue(.quiet) { color: #777 }'), WCAG);
    expect(grey[0]).toMatchObject({ list: 'head', index: 0, rule: 'contrast' });
    expect(grey[0]?.message).toMatch(/::cue\(\.quiet\)/);
    // A see-through background is judged over a white picture too.
    expect(rules(checkQuality(withStyle('::cue { background: rgba(0,0,0,0.2) }'), WCAG))).toEqual([
      'contrast',
    ]);
    expect(checkQuality(withStyle('::cue { background: black }'), WCAG)).toEqual([]);
    const bbc = checkQuality(
      withStyle(
        '::cue(.a) { color: #f0f } ::cue(.b) { color: cyan } ::cue(.c) { background-color: blue }',
      ),
      BBC_SUBTITLES,
    );
    expect(bbc.filter((f) => f.rule === 'bbc-colours').map((f) => f.message)).toEqual([
      expect.stringMatching(/#f0f is not a BBC speaker colour/),
      expect.stringMatching(/coloured backgrounds/),
    ]);
  });
});

describe('Finnish rules', () => {
  const fix = (text: string, id: keyof Ruleset['rules'], next = false): string | undefined => {
    const cues = [createCue(0, 3000, text), ...(next ? [createCue(3100, 5000, 'jatkuu')] : [])];
    const change = checkQuality(doc(...cues), only(id))[0]?.fix?.change;
    return change?.kind === 'text' ? change.text : undefined;
  };
  const flags = (text: string, id: keyof Ruleset['rules']): number =>
    checkQuality(doc(createCue(0, 3000, text)), only(id)).length;

  it('dual speakers: a hyphen on the second line only', () => {
    expect(fix('-Se ei ole valmis.\n-Mikä?', 'dual-speaker-second-line')).toBe(
      'Se ei ole valmis.\n-Mikä?',
    );
    expect(flags('Se ei ole valmis.\n-Mikä?', 'dual-speaker-second-line')).toBe(0);
  });

  it('a sentence continuing in the next cue ends with a hyphen', () => {
    expect(fix('Hän opetti minulle', 'continuation-hyphen', true)).toBe('Hän opetti minulle -');
    expect(fix('<i>Hän opetti minulle</i>', 'continuation-hyphen', true)).toBe(
      '<i>Hän opetti minulle -</i>',
    );
    expect(fix('Odotin innolla,', 'continuation-hyphen', true)).toBeUndefined();
    expect(fix('Hän opetti minulle -', 'continuation-hyphen', true)).toBeUndefined();
    expect(fix('♪ Laulun sanat', 'continuation-hyphen', true)).toBeUndefined();
    expect(fix('Viimeinen', 'continuation-hyphen')).toBeUndefined(); // No cue follows.
  });

  it('no space before punctuation (as in machine translations)', () => {
    expect(fix('En tiedä .', 'space-before-punctuation')).toBe('En tiedä.');
    expect(fix('Mitä ? Oikeasti !', 'space-before-punctuation')).toBe('Mitä? Oikeasti!');
    expect(flags('Hän opetti minulle -', 'space-before-punctuation')).toBe(0);
    expect(flags('…säilyttäminen on tärkeää.', 'space-before-punctuation')).toBe(0);
    expect(flags('Onko hän… elossa?', 'space-before-punctuation')).toBe(0);
  });

  it('Finnish number formats', () => {
    expect(fix('Se maksoi 10,000 euroa.', 'finnish-numbers')).toBe('Se maksoi 10 000 euroa.');
    expect(fix('Tule kello 7:45.', 'finnish-numbers')).toBe('Tule kello 7.45.');
    expect(fix('Se on 1.5 metriä.', 'finnish-numbers')).toBe('Se on 1,5 metriä.');
    expect(flags('Tule kello 7.45.', 'finnish-numbers')).toBe(0); // A time, correctly written.
    expect(flags('Se on 1,5 metriä ja 10 000 euroa.', 'finnish-numbers')).toBe(0);
  });

  it('acronyms without full stops, but initials left alone', () => {
    expect(fix('Hän muutti U.S.A.:han.', 'acronym-periods')).toBe('Hän muutti USA:han.');
    expect(flags('J.R.R. Tolkien kirjoitti sen.', 'acronym-periods')).toBe(0);
    expect(flags('A. I. Virtanen', 'acronym-periods')).toBe(0);
  });

  it('Kotus abbreviations and state body names', () => {
    expect(fix('Esim tämä, jne', 'finnish-abbreviations')).toBe('Esim. tämä, jne.');
    expect(fix('Tule klo. 18.', 'finnish-abbreviations')).toBe('Tule klo 18.');
    expect(flags('Esim. tämä, jne. ja vrt. tuo.', 'finnish-abbreviations')).toBe(0);
    expect(flags('Pituus on 5 mm', 'finnish-abbreviations')).toBe(0); // A unit.
    expect(fix('Soitin KELAan ja SYKEen.', 'agency-names')).toBe('Soitin Kelaan ja Sykeen.');
    expect(fix('KELA:n päätös tuli.', 'agency-names')).toBe('Kelan päätös tuli.');
    expect(flags('KELA', 'agency-names')).toBe(0); // An all-capital forced narrative.
    expect(flags('Soitin Kelaan.', 'agency-names')).toBe(0);
  });
});

describe('rulesets', () => {
  it('reference only known rules, with valid settings and cited sources', () => {
    for (const set of RULESETS) {
      const sourceIds = new Set(set.sources.map((s) => s.id));
      for (const [id, entry] of Object.entries(set.rules)) {
        const rule = RULES[id as keyof typeof RULES];
        expect(rule, `${set.id}: ${id}`).toBeDefined();
        for (const [key, value] of Object.entries(entry?.params ?? {})) {
          const spec = rule.params.find((p) => p.key === key);
          expect(spec, `${set.id}: ${id}.${key}`).toBeDefined();
          expect(value).toBeGreaterThanOrEqual(spec!.min);
          expect(value).toBeLessThanOrEqual(spec!.max);
        }
        if (entry?.source) expect(sourceIds.has(entry.source), `${set.id}: ${id}`).toBe(true);
      }
      for (const source of set.sources) expect(source.edition).not.toBe('');
    }
    expect(new Set(RULESETS.map((r) => r.id)).size).toBe(RULESETS.length);
  });

  it('match the guides’ numbers', () => {
    const params = (set: Ruleset, id: keyof Ruleset['rules']) => set.rules[id]?.params;
    expect(params(NETFLIX_EN_US_ADULT, 'chars-per-second')).toEqual({ max: 20 });
    expect(params(NETFLIX_EN_US_CHILDREN, 'chars-per-second')).toEqual({ max: 17 });
    expect(params(NETFLIX_EN_US_ADULT, 'line-length')).toEqual({ max: 42 });
    expect(params(NETFLIX_EN_US_ADULT, 'min-duration')?.['minMs']).toBeCloseTo(833.33, 1);
    expect(params(NETFLIX_EN_US_ADULT, 'max-duration')).toEqual({ maxMs: 7000 });
    expect(NETFLIX_EN_US_ADULT.rules['glyph-list']).toBeDefined();
    expect(NETFLIX_TEMPLATE_EN.rules['glyph-list']).toBeDefined();
    expect(params(NETFLIX_EN_US_ADULT, 'frame-gaps')).toEqual({ frames: 2, closeBelowMs: 500 });
    expect(params(NETFLIX_TEMPLATE_EN, 'chars-per-second')).toEqual({ max: 17 });
    expect(params(NETFLIX_TEMPLATE_EN_CHILDREN, 'chars-per-second')).toEqual({ max: 15 });
    expect(params(NETFLIX_TEMPLATE_EN, 'single-line')).toEqual({ maxChars: 42 });
    expect(params(NETFLIX_TEMPLATE_EN, 'min-duration')?.['minMs']).toBeCloseTo(833.33, 1);
    expect(params(NETFLIX_FI_ADULT, 'chars-per-second')).toEqual({ max: 17 });
    expect(params(NETFLIX_FI_CHILDREN, 'chars-per-second')).toEqual({ max: 13 });
    expect(params(NETFLIX_FI_SDH, 'chars-per-second')).toEqual({ max: 20 });
    expect(params(NETFLIX_FI_SDH_CHILDREN, 'chars-per-second')).toEqual({ max: 17 });
    expect(params(NETFLIX_FI_ADULT, 'line-length')).toEqual({ max: 42 });
    expect(NETFLIX_FI_ADULT.rules['single-line']).toBeUndefined(); // Two lines are allowed.
    expect(NETFLIX_FI_ADULT.rules['lowercase-labels']).toBeUndefined();
    expect(NETFLIX_FI_SDH.rules['lowercase-labels']).toBeDefined();
    expect(params(BBC_SUBTITLES, 'line-length')).toEqual({ max: 37 });
    expect(params(BBC_SUBTITLES, 'words-per-minute')).toEqual({ max: 180 });
    expect(params(BBC_SUBTITLES, 'min-gap')).toEqual({ minMs: 1000 });
    expect(params(WCAG, 'contrast')).toEqual({ min: 4.5 });
  });

  it('let the user switch rules off and change settings', () => {
    const d = doc(createCue(0, 1000, 'This is a perfectly ordinary caption line'));
    expect(rules(checkQuality(d, NETFLIX_EN_US_ADULT))).toEqual(['chars-per-second']);
    expect(
      checkQuality(d, NETFLIX_EN_US_ADULT, { 'chars-per-second': { enabled: false } }),
    ).toEqual([]);
    expect(
      checkQuality(d, NETFLIX_EN_US_ADULT, { 'chars-per-second': { params: { max: 45 } } }),
    ).toEqual([]);
  });

  it('the basic checks pass ordinary captions', () => {
    const d = doc(
      createCue(0, 2500, 'Welcome back to the channel.'),
      createCue(2500, 5000, 'Today we are making bread\nfrom scratch.'),
      createCue(5200, 8000, 'You only need four ingredients.'),
    );
    expect(checkQuality(d, LITE)).toEqual([]);
  });
});

describe('fixes', () => {
  it('apply one or many', () => {
    const d = doc(
      createCue(0, 1000, 'a  b'),
      createCue(1000, 2000, ''),
      createCue(2000, 3000, 'c  d'),
    );
    const set: Ruleset = {
      ...only('double-space'),
      rules: { 'double-space': { severity: 'info' }, 'empty-cue': { severity: 'warning' } },
    };
    const findings = checkQuality(d, set);
    expect(findings.map((f) => [f.rule, f.index])).toEqual([
      ['double-space', 0],
      ['empty-cue', 1],
      ['double-space', 2],
    ]);
    const one = applyQualityFix(d, findings[0]!);
    expect((one.body[0] as Cue).text).toBe('a b');
    const all = applyQualityFixes(d, findings);
    expect(all.body.map((c) => (c as Cue).text)).toEqual(['a b', 'c d']);
  });
});
