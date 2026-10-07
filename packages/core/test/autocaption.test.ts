import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Cue, VttDocument } from '../src/index.ts';
import {
  cleanupAutoCaptions,
  createCue,
  createDocument,
  detectAutoCaptions,
  extractLines,
  findReviewMarkers,
  importDocument,
  parseTimestamp,
  segment,
  serialize,
  validate,
  visibleLength,
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
 * The Phase 4 acceptance checks: the result conforms, no word is lost or reordered, cues are in
 * order without overlaps, every cue starts and ends on its own words' times, word timestamps lie
 * inside their cue in increasing order, and lines respect the length limit (a single word that
 * is longer, or punctuation that must stay with its word, may exceed it).
 */
function checkCleanup(doc: VttDocument): void {
  const lines = extractLines(doc);
  const { document: out } = cleanupAutoCaptions(doc);
  const cues = cuesOf(out);

  const errors = validate(serialize(out)).diagnostics.filter((d) => d.severity === 'error');
  expect(errors).toEqual([]);

  const source = lines.flatMap((l) => l.groups.flatMap((g) => g.words.map((w) => w.text)));
  expect(cues.flatMap((c) => words(c.text))).toEqual(source);

  const starts = new Set(lines.flatMap((l) => l.groups.map((g) => g.startMs)));
  const ends = new Set(lines.flatMap((l) => l.groups.map((g) => g.endMs)));
  cues.forEach((cue, i) => {
    if (i > 0) expect(cue.startMs).toBeGreaterThanOrEqual((cues[i - 1] as Cue).endMs);
    expect(starts.has(cue.startMs)).toBe(true);
    expect(ends.has(cue.endMs)).toBe(true);
    let last = cue.startMs;
    for (const m of cue.text.matchAll(/<([0-9:.]+)>/g)) {
      const ts = parseTimestamp(m[1] as string);
      expect(ts.ok && ts.ms > last && ts.ms < cue.endMs).toBe(true);
      if (ts.ok) last = ts.ms;
    }
    for (const line of cue.text.split('\n')) {
      const ws = words(line);
      if (visibleLength(line) > 42)
        expect(ws.length === 1 || /^[.,!?…;:]+$/.test(ws.at(-1) as string)).toBe(true);
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

  it('changes whitespace only when asked', () => {
    const all = (doc: VttDocument) =>
      cuesOf(doc)
        .map((c) => c.text)
        .join('\n');
    const wide = { maxLineLength: 100 }; // One line per cue, so the separators stay inline.
    const kept = all(cleanupAutoCaptions(translated(), wide).document);
    expect(kept).toContain('pajaan.  Tänään');
    expect(kept).toContain('\u200b\u200b');
    const cleaned = all(
      cleanupAutoCaptions(translated(), {
        ...wide,
        collapseSpaces: true,
        removeDoubledZeroWidthSpaces: true,
      }).document,
    );
    expect(cleaned).toContain('pajaan. Tänään');
    expect(cleaned).not.toContain('\u200b');
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
