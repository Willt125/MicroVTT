import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Cue, VttDocument } from '../src/index.ts';
import {
  RULESETS,
  cleanupAutoCaptions,
  cleanupLineDefaults,
  createCue,
  createDocument,
  cuesOutsideC,
  cuesWithUntaggedTiming,
  detectAutoCaptions,
  extractLines,
  findReviewMarkers,
  formatTimestamp,
  importDocument,
  parseTimestamp,
  segment,
  serialize,
  validate,
  visibleLength,
  wrapForStyles,
  wrapWords,
} from '../src/index.ts';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const PRIVATE = new URL('../../../tests/private-fixtures/', import.meta.url);
const load = (url: URL): VttDocument => importDocument(readFileSync(url, 'utf8')).document;
const sample = (): VttDocument => load(new URL('autocaption-sample.vtt', FIXTURES));
const translated = (): VttDocument => load(new URL('autocaption-translated-sample.vtt', FIXTURES));
const docOf = (text: string): VttDocument => importDocument(text).document;
const cuesOf = (doc: VttDocument): Cue[] => doc.body.filter((i): i is Cue => i.type === 'cue');

/** Words of raw cue text, markup removed. */
const words = (raw: string): string[] =>
  raw
    .replace(/<[^>]*>/g, '')
    .split(/[ \t\n\u200b]+/)
    .filter(Boolean);

/**
 * The Phase 4 acceptance checks: the result conforms, no text is lost or reordered, cues are in
 * order without overlaps, every cue's times lie within its own words' times, word timestamps lie
 * inside their cue in increasing order, and lines respect the length limit (a single word that
 * is longer, or punctuation that must stay with its word, may exceed it).
 */
function checkCleanup(doc: VttDocument): void {
  const lines = extractLines(doc);
  const { document: out } = cleanupAutoCaptions(doc);
  const cues = cuesOf(out);

  const errors = validate(serialize(out)).diagnostics.filter((d) => d.severity === 'error');
  expect(errors).toEqual([]);

  // Every character kept, in order (separators aside: spaces are tidied, and lines of scripts
  // without spaces join without one).
  const flat = (text: string) => text.replace(/<[^>]*>/g, '').replace(/[ \t\n\u200b]+/g, '');
  const source = lines.flatMap((l) => l.groups.flatMap((g) => g.words.map((w) => w.text)));
  expect(flat(cues.map((c) => c.text).join(''))).toBe(flat(source.join('')));

  // A cue starts on a word group's start and ends inside its last group (at its end, or
  // earlier when a word before a pause is held for at most maxWordHoldMs).
  const groups = lines.flatMap((l) => l.groups);
  const byStart = new Map(groups.map((g) => [g.startMs, g]));
  cues.forEach((cue, i) => {
    if (i > 0) expect(cue.startMs).toBeGreaterThanOrEqual((cues[i - 1] as Cue).endMs);
    expect(byStart.has(cue.startMs)).toBe(true);
    const final = groups.filter((g) => g.startMs < cue.endMs).at(-1) as (typeof groups)[number];
    expect(cue.endMs).toBeLessThanOrEqual(final.endMs);
    let last = cue.startMs;
    for (const m of cue.text.matchAll(/<([0-9:.]+)>/g)) {
      const ts = parseTimestamp(m[1] as string);
      expect(ts.ok && ts.ms > last && ts.ms < cue.endMs).toBe(true);
      if (ts.ok) last = ts.ms;
    }
    for (const line of cue.text.split('\n')) {
      // Closing punctuation stays with its word, so may run over.
      const closing = /(?:<[^>]*>)*[.,!?…;:'"”’»。、！？]+$/u;
      if (visibleLength(line.replace(closing, '')) > 42) expect(words(line).length).toBe(1);
    }
  });
}

describe('detection', () => {
  it('recognizes roll-up auto-captions and their timing kind', () => {
    expect(detectAutoCaptions(sample())).toMatchObject({
      detected: true,
      approximateTimings: false,
      language: 'en',
    });
    expect(detectAutoCaptions(translated())).toMatchObject({
      detected: true,
      approximateTimings: true,
      language: 'fi',
    });
  });

  it('leaves ordinary captions alone', () => {
    const plain = docOf(
      'WEBVTT\n\n' +
        ['One', 'Two', 'Three', 'Four', 'Five']
          .map((t, i) => `00:0${i}.000 --> 00:0${i + 1}.000\n${t}\n`)
          .join('\n'),
    );
    expect(detectAutoCaptions(plain).detected).toBe(false);
    expect(detectAutoCaptions(createDocument()).detected).toBe(false);
  });
});

describe('de-roll', () => {
  it('takes the new line of each growing cue and skips hand-off cues', () => {
    const lines = extractLines(sample());
    const text = lines.map((l) => l.groups.flatMap((g) => g.words.map((w) => w.text)).join(' '));
    expect(text.slice(0, 2)).toEqual([
      'Welcome back to the workshop. Today we',
      'are building a bench from A&amp;B lumber.',
    ]);
    // Every completed line YouTube shows in a hand-off cue appears, in order.
    const handoffs = cuesOf(sample())
      .filter((c) => c.endMs - c.startMs <= 50 && c.text.trim() !== '')
      .map((c) => words(c.text.split('\n')[0] as string).join(' '));
    let at = 0;
    for (const h of handoffs) {
      at = text.indexOf(h, at) + 1;
      expect(at).toBeGreaterThan(0);
    }
  });

  it('keeps word timings, giving each word group the time until the next', () => {
    const [line] = extractLines(sample());
    expect(line?.groups.slice(0, 3).map((g) => [g.startMs, g.endMs, g.words[0]?.text])).toEqual([
      [240, 820, 'Welcome'],
      [820, 1100, 'back'],
      [1100, 1260, 'to'],
    ]);
  });

  it('folds out-of-order or out-of-range timestamps into the word before', () => {
    const doc = docOf(
      'WEBVTT\n\n00:00.000 --> 00:02.000\n \na<00:00.500><c> b</c><00:00.400><c> c</c><00:02.010><c> d</c>\n',
    );
    const [line] = extractLines(doc);
    expect(line?.groups.map((g) => [g.startMs, g.words.map((w) => w.text).join(' ')])).toEqual([
      [0, 'a'],
      [500, 'b c d'],
    ]);
  });
});

describe('segmentation', () => {
  const lineOf = (texts: string[], start: number, step: number) => ({
    startMs: start,
    endMs: start + texts.length * step,
    source: 0,
    groups: texts.map((t, i) => ({
      startMs: start + i * step,
      endMs: start + (i + 1) * step,
      words: [{ text: t, gap: i === 0 ? '' : ' ' }],
    })),
  });
  const text = (segs: ReturnType<typeof segment>): string[] =>
    segs.map((s) => s.groups.flatMap((g) => g.words.map((w) => w.text)).join(' '));

  it('prefers sentence ends and starts a cue at each speaker change', () => {
    const line = lineOf(
      'Is that glue rated for forty degrees? &gt;&gt; It is, as long as it cures overnight.'.split(
        ' ',
      ),
      0,
      300,
    );
    expect(text(segment([line]))).toEqual([
      'Is that glue rated for forty degrees?',
      '&gt;&gt; It is, as long as it cures overnight.',
    ]);
  });

  it('keeps cues within the duration and size limits', () => {
    const many = lineOf(
      Array.from({ length: 60 }, (_, i) => `word${i}`),
      0,
      250,
    );
    for (const s of segment([many], { maxDurationMs: 4000 })) {
      expect(s.endMs - s.startMs).toBeLessThanOrEqual(4000);
      expect(
        wrapWords(
          s.groups.flatMap((g) => g.words),
          42,
          2,
        ),
      ).not.toBeNull();
    }
  });

  it('never starts a cue with punctuation alone', () => {
    const line = lineOf(
      'a b c d e f g h i j k l m n o p q r s t u v w x y z . next'.split(' '),
      0,
      400,
    );
    for (const t of text(segment([line], { maxDurationMs: 4000 }))) expect(t).not.toMatch(/^\./);
  });

  it('gives a whole sound-tag line its own cue, but not a tag inside speech', () => {
    const speech = lineOf(['Later', '[music]', 'on.'], 0, 400);
    const music = lineOf(['[Music]'], 1200, 3000);
    const more = lineOf(['And', 'then', 'the', 'next', '[&nbsp;__&nbsp;]', 'thing.'], 4200, 300);
    expect(text(segment([speech, music, more]))).toEqual([
      'Later [music] on.',
      '[Music]',
      'And then the next [&nbsp;__&nbsp;] thing.',
    ]);
  });

  it('holds the last word before a pause for at most maxWordHoldMs', () => {
    const line = lineOf(['Give', 'me', 'that.'], 0, 300);
    line.groups[2]!.endMs = 14_000; // Music follows: YouTube's line runs on.
    line.endMs = 14_000;
    const [cue] = segment([line]);
    expect(cue).toMatchObject({ startMs: 0, endMs: 600 + 2000 });
    expect(text(segment([line]))).toEqual(['Give me that.']);
    const [held] = segment([line], { maxWordHoldMs: 20_000, maxDurationMs: 20_000 });
    expect(held?.endMs).toBe(14_000);
  });

  it('wraps two balanced lines, preferring punctuation', () => {
    const ws = 'Welcome back to the workshop. Today we are building a bench'
      .split(' ')
      .map((t, i) => ({ text: t, gap: i ? ' ' : '' }));
    expect(wrapWords(ws, 42, 2)?.map((l) => l.map((w) => w.text).join(' '))).toEqual([
      'Welcome back to the workshop.',
      'Today we are building a bench',
    ]);
    expect(wrapWords(ws, 20, 2)).toBeNull();
  });

  it('measures visible length', () => {
    expect(visibleLength('A&amp;B <00:00:01.000><c>x</c>\u200b\u200b')).toBe(5); // "A&B x"
  });
});

describe('cleanup', () => {
  it('meets the acceptance checks on the synthetic fixtures', () => {
    checkCleanup(sample());
    checkCleanup(translated());
  });

  it('keeps word timings unless asked not to (or timings are approximate)', () => {
    const [first] = cuesOf(cleanupAutoCaptions(sample()).document);
    expect(first?.text).toContain('<00:00:00.820>back');
    expect(first?.align).toBe('center');
    const plain = cuesOf(cleanupAutoCaptions(sample(), { keepWordTimings: false }).document);
    expect(plain.some((c) => c.text.includes('<'))).toBe(false);
    expect(cuesOf(cleanupAutoCaptions(translated()).document)[0]?.text).not.toContain('<0');
    const kept = cuesOf(cleanupAutoCaptions(sample(), { keepCueSettings: true }).document);
    expect(kept[0]).toMatchObject({ align: 'start', position: 0 });
  });

  it("wraps its output in <c> as the file's style sheets need", () => {
    const withStyle = (css: string): VttDocument => ({
      ...sample(),
      head: [...sample().head, { type: 'style', css }],
    });
    const texts = (doc: VttDocument, options = {}): string[] =>
      cuesOf(cleanupAutoCaptions(doc, options).document).map((c) => c.text);
    // No styles: as before, and YouTube's own <c> spans are not kept.
    expect(wrapForStyles(sample())).toBe('none');
    expect(texts(sample()).some((t) => t.includes('<c>'))).toBe(false);
    // :past/:future rules: the timed words in <c>, untimed cues left alone.
    const karaoke = withStyle('::cue(:future) { color: grey; }');
    expect(wrapForStyles(karaoke)).toBe('timed');
    const timed = texts(karaoke);
    expect(timed[0]).toContain('<00:00:00.820><c>back');
    expect(
      cuesWithUntaggedTiming({ ...karaoke, body: cleanupAutoCaptions(karaoke).document.body }),
    ).toBe(0);
    // A background on <c>: every cue's text in <c>, untimed text included.
    const box = withStyle('::cue { background: transparent; }\n::cue(c) { background: black; }');
    expect(wrapForStyles(box)).toBe('all');
    expect(cuesOutsideC(cleanupAutoCaptions(box).document)).toBe(0);
    expect(cuesOutsideC(cleanupAutoCaptions(box, { keepWordTimings: false }).document)).toBe(0);
    // Asked not to.
    expect(texts(karaoke, { wrapInC: 'none' }).some((t) => t.includes('<c>'))).toBe(false);
    // Wrapped output is still valid WebVTT.
    expect(validate(serialize(cleanupAutoCaptions(box).document)).diagnostics).toEqual([]);
  });

  it('tidies whitespace by default, and keeps it when asked', () => {
    const all = (doc: VttDocument) =>
      cuesOf(doc)
        .map((c) => c.text)
        .join('\n');
    const wide = { maxLineLength: 100 }; // One line per cue, so the separators stay inline.
    const kept = all(
      cleanupAutoCaptions(translated(), {
        ...wide,
        collapseSpaces: false,
        removeDoubledZeroWidthSpaces: false,
      }).document,
    );
    expect(kept).toContain('pajaan.  Tänään');
    expect(kept).toContain('\u200b\u200b');
    const cleaned = all(cleanupAutoCaptions(translated(), wide).document);
    expect(cleaned).toContain('pajaan. Tänään');
    expect(cleaned).not.toContain('\u200b');
  });

  /**
   * YouTube-style roll-up captions from lines of words, each word with its own separator
   * ("word " in spaced scripts, nothing in Chinese or Japanese, U+200B in Thai machine output).
   */
  function rollUp(lines: string[][], stepMs = 500): VttDocument {
    const parts = ['WEBVTT\nKind: captions\n'];
    let t = 0;
    let shown = ' ';
    for (const ws of lines) {
      const end = t + ws.length * stepMs;
      const timed = ws
        .map((w, i) => (i === 0 ? w : `<${formatTimestamp(t + i * stepMs)}><c>${w}</c>`))
        .join('');
      const cue = (from: number, to: number, text: string) =>
        `${formatTimestamp(from)} --> ${formatTimestamp(to)} align:start position:0%\n${text}\n`;
      parts.push(cue(t, end, `${shown}\n${timed}`));
      shown = ws.join('');
      parts.push(cue(end, end + 10, `${shown}\n `));
      t = end + 10;
    }
    return docOf(parts.join('\n'));
  }
  const textOf = (doc: VttDocument, options = {}) =>
    cuesOf(cleanupAutoCaptions(doc, { keepWordTimings: false, ...options }).document)
      .map((c) => c.text)
      .join('\n');

  it('adds no spaces to scripts written without them', () => {
    const ja = rollUp([
      ['今日は', 'いい', '天気', 'ですね。'],
      ['散歩に', '行きましょう。'],
    ]);
    expect(detectAutoCaptions(ja).detected).toBe(true);
    expect(textOf(ja, { maxLineLength: 100 }).replace(/\n/g, '')).toBe(
      '今日はいい天気ですね。散歩に行きましょう。',
    );
    expect(textOf(ja, { maxLineLength: 100 })).not.toMatch(/ /);
    const zh = rollUp([['我们', '今天', '去', '公园，'], ['好吗？']]);
    expect(textOf(zh, { maxLineLength: 100 })).toBe('我们今天去公园，好吗？');
  });

  it('keeps a single zero-width space between Thai words and drops doubled ones', () => {
    const th = rollUp([['สวัสดี\u200b\u200b', 'ครับ\u200b', 'วันนี้']]);
    expect(textOf(th, { maxLineLength: 100 })).toBe('สวัสดี\u200bครับ\u200bวันนี้');
  });

  it('joins lines with a space in spaced scripts, Arabic and Hindi included', () => {
    const ar = rollUp([
      ['مرحبا ', 'بكم'],
      ['في ', 'البرنامج.'],
    ]);
    expect(textOf(ar, { maxLineLength: 100 })).toBe('مرحبا بكم في البرنامج.');
    const hi = rollUp([
      ['नमस्ते ', 'दोस्तों।'],
      ['आज ', 'हम'],
    ]);
    expect(textOf(hi, { maxLineLength: 100 })).toBe('नमस्ते दोस्तों। आज हम');
  });

  it('breaks at non-Latin sentence ends and counts graphemes', () => {
    expect(visibleLength('नमस्ते')).toBeLessThanOrEqual(4); // Grapheme rules vary by Unicode version.
    expect(visibleLength('👩\u200d👩\u200d👧')).toBe(1);
    const ja = rollUp([
      ['これは', '最初の', '文です。'],
      ['これは', '二番目の', '文です。'],
    ]);
    const cues = cuesOf(
      cleanupAutoCaptions(ja, { maxLineLength: 10, keepWordTimings: false }).document,
    );
    expect(cues.map((c) => c.text.replace(/\n/g, ''))).toEqual([
      'これは最初の文です。',
      'これは二番目の文です。',
    ]);
  });

  /** A YouTube machine translation: evenly timed pieces, lines held over above a blank line. */
  const machineTranslated = (lines: string[][], holdOver = true): VttDocument => {
    const parts = ['WEBVTT\n'];
    const cue = (from: number, to: number, text: string) =>
      `${formatTimestamp(from)} --> ${formatTimestamp(to)} align:start position:0%\n${text}\n`;
    let t = 0;
    let shown = ' ';
    for (const ws of lines) {
      const end = t + ws.length * 300;
      const timed = ws
        .map((w, i) => (i === 0 ? w : `<${formatTimestamp(t + i * 300)}><c>${w}</c>`))
        .join('');
      parts.push(cue(t, end, `${shown}\n${timed}`));
      shown = ws.join('');
      // The new line held on for a while, then handed off.
      if (holdOver) parts.push(cue(end, end + 1500, `${shown}\n `));
      parts.push(cue(end + (holdOver ? 1500 : 0), end + (holdOver ? 1510 : 10), `${shown}\n `));
      t = end + (holdOver ? 1510 : 10);
    }
    return docOf(parts.join('\n'));
  };

  it('reads machine translations: held-over lines, stray punctuation and split words', () => {
    const ko = machineTranslated([
      ['이 ', '헤드', '라인', '을 ', '설명', '해 ', '주실 ', '분 ', '계신가', '요'],
      ['?'],
      ['나', '도 ', '전혀 ', '모르겠어', '.'],
    ]);
    // Held-over lines are not new lines, and a line of punctuation joins the line before it.
    expect(textOf(ko, { maxLineLength: 100 }).replace(/\n/g, ' ')).toBe(
      '이 헤드라인을 설명해 주실 분 계신가요? 나도 전혀 모르겠어.',
    );
    // A line is never broken inside a word split over pieces ("헤드" + "라인").
    for (const line of textOf(ko, { maxLineLength: 12 }).split('\n'))
      expect(line).not.toMatch(/헤드$|^라인/);

    const ja = machineTranslated([
      ['これが', '広がった', '。 ', 'わから'],
      ['ない', '。'],
      ['そして', '私は', '決めた', '。'],
    ]);
    const cues = cuesOf(cleanupAutoCaptions(ja, { keepWordTimings: false }).document);
    // No space after "。", and the word split over two lines ("わから" + "ない") stays whole.
    expect(cues.map((c) => c.text).join('')).not.toMatch(/ /);
    for (const limit of [8, 10, 42]) {
      const text = textOf(ja, { maxLineLength: limit });
      expect(text).toContain('わからない');
      expect(text.split('\n').some((l) => l.endsWith('わから'))).toBe(false);
    }
  });

  it('starts from the chosen guide’s line limits, then the language’s, then 42', () => {
    const byId = (id: string) => RULESETS.find((r) => r.id === id);
    expect(cleanupLineDefaults(byId('netflix-ja'), {}, 'ja')).toEqual({
      maxLineLength: 13,
      maxLines: 2,
      halfWidth: 0.5,
      from: 'Netflix Japanese',
    });
    // The user's changes to the ruleset count; a third (SDH) line does not.
    expect(
      cleanupLineDefaults(
        byId('netflix-zh-hans-sdh'),
        { 'line-length': { params: { max: 15 } } },
        'zh',
      ),
    ).toMatchObject({ maxLineLength: 15, maxLines: 2 });
    // A guide for another language, or no guide: the language's usual limits.
    expect(cleanupLineDefaults(byId('netflix-en-us'), {}, 'ko')).toEqual({
      maxLineLength: 16,
      maxLines: 2,
      halfWidth: 0.5,
      from: 'Korean',
    });
    expect(cleanupLineDefaults(byId('lite'), {}, 'zh-TW').maxLineLength).toBe(16);
    expect(cleanupLineDefaults(byId('bbc'), {}, null)).toMatchObject({ maxLineLength: 37 });
    expect(cleanupLineDefaults(byId('lite'), {}, 'fi')).toEqual({
      maxLineLength: 42,
      maxLines: 2,
      halfWidth: 1,
      from: null,
    });
  });

  it('counts half-width characters as half when asked', () => {
    const ko = machineTranslated([
      ['오늘 ', '날씨가 ', '정말 ', '좋네요 ', 'OK ', '공원에 ', '갈까요'],
    ]);
    const lines = (halfWidth: number) =>
      cuesOf(
        cleanupAutoCaptions(ko, { maxLineLength: 16, halfWidth, keepWordTimings: false }).document,
      ).flatMap((c) => c.text.split('\n'));
    // Every line keeps to 16 by the guide's count.
    for (const line of lines(0.5)) expect(visibleLength(line, 0.5)).toBeLessThanOrEqual(16);
    expect(lines(1).every((l) => visibleLength(l) <= 16)).toBe(true);
    const flat = (ls: string[]) => ls.join('').replace(/\s/g, '');
    expect(flat(lines(0.5))).toBe(flat(lines(1)));
    // At half width the whole text (16 Hangul, 6 spaces, "OK": 20) fits one line of 20; at full
    // width (24) it does not.
    const one = (halfWidth: number) =>
      cuesOf(cleanupAutoCaptions(ko, { maxLineLength: 20, maxLines: 1, halfWidth }).document)
        .length;
    expect(one(0.5)).toBe(1);
    expect(one(1)).toBeGreaterThan(1);
  });

  it('keeps notes in place and the head unchanged', () => {
    const doc = sample();
    const note = { type: 'note' as const, text: ' checked' };
    const withNote = { ...doc, body: [...doc.body.slice(0, 4), note, ...doc.body.slice(4)] };
    const out = cleanupAutoCaptions(withNote).document;
    expect(out.head).toBe(withNote.head);
    expect(out.body.filter((i) => i.type === 'note')).toEqual([note]);
  });

  const files = existsSync(PRIVATE)
    ? readdirSync(PRIVATE).filter((name) => name.endsWith('.vtt'))
    : [];
  it.skipIf(files.length === 0).each(files)('meets the acceptance checks on %s', (name) => {
    const doc = load(new URL(name, PRIVATE));
    expect(detectAutoCaptions(doc).detected).toBe(true);
    checkCleanup(doc);
  });
});

describe('review markers', () => {
  it('finds censored words and sound tags', () => {
    const doc: VttDocument = {
      ...createDocument(),
      body: [
        createCue(0, 1000, 'what the [&nbsp;__&nbsp;] [music]'),
        createCue(1000, 2000, '[ __ ] [Applause] [1, 2]'),
      ],
    };
    expect(findReviewMarkers(doc).map((m) => `${m.index}:${m.kind}:${m.text}`)).toEqual([
      '0:censored:[&nbsp;__&nbsp;]',
      '0:sound:[music]',
      '1:censored:[ __ ]',
      '1:sound:[Applause]',
      '1:sound:[1, 2]',
    ]);
  });
});
