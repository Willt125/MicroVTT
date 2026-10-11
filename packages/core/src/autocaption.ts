/**
 * YouTube auto-caption cleanup.
 *
 * YouTube writes speech-recognition captions as "roll-up" captions: each caption line is shown by
 * a growing cue (the previous line, then the new line with a timestamp tag before each word) and
 * then a 10 ms hand-off cue that repeats it. `SPEC-NOTES.md` documents the format. This module
 * turns that into ordinary captions:
 *
 * 1. `extractLines` ("de-roll"): the new line of every growing cue, as timed word groups.
 * 2. `segment`: groups those into readable cues by rules (line length, line count, duration,
 *    reading speed, sentence and clause boundaries, speaker changes), choosing all break points
 *    together so the result is the cheapest under one cost function, not a greedy fill.
 * 3. `cleanupAutoCaptions`: builds the cleaned document, optionally keeping word timings as
 *    timestamp tags.
 *
 * Detection is structural (roll-up repetition, hand-off cues, timestamp spacing), not tied to
 * exact header strings, because YouTube has changed the format before.
 */
import { languageMatches, languageName } from './language.ts';
import { effectiveRules } from './quality/check.ts';
import { displayLength } from './quality/measure.ts';
import type { RuleOverrides, Ruleset } from './quality/types.ts';
import { breakUnits, continuesWord, hasUnspaced, joinsWithoutSpace } from './script.ts';
import type { BodyItem, Cue, Note, VttDocument } from './document.ts';
import { createCue } from './document.ts';
import { applyTextWrap, wrapForStyles, type TextWrap } from './styles.ts';
import { formatTimestamp, parseTimestamp } from './timestamp.ts';

/** A word as it appears in cue text (markup kept, e.g. `A&amp;B`), with the space before it. */
export interface CaptionWord {
  text: string;
  /** Raw separator before the word: spaces, tabs or zero-width spaces ('' for a line's first). */
  gap: string;
  /**
   * Split from a run of text by its word boundaries (an untimed line in a script without
   * spaces): a line may break before it.
   */
  split?: boolean;
}

/** Words sharing one start time: one timestamp tag in the source, or an untimed line's words. */
export interface WordGroup {
  startMs: number;
  endMs: number;
  words: CaptionWord[];
}

/** One caption line from a growing cue. */
export interface CaptionLine {
  startMs: number;
  endMs: number;
  groups: WordGroup[];
  /** Body index of the source cue. */
  source: number;
}

export interface AutoCaptionInfo {
  /** True when the document looks like roll-up auto-captions. */
  detected: boolean;
  cues: number;
  /** Caption lines that cleanup would extract. */
  lines: number;
  /** Lines with per-word timestamp tags. */
  timedLines: number;
  /**
   * True when word timestamps are evenly spaced within lines: YouTube's machine translations
   * interpolate them rather than taking them from the audio.
   */
  approximateTimings: boolean;
  /** From a preserved `Language:` header line, if any. */
  language: string | null;
}

/** Hand-off cues last 10 ms in every sample; allow some slack. */
const HANDOFF_MAX_MS = 50;
const TIMESTAMP_TAG = /<([0-9:.]+)>/g;
const CLASS_TAG = /<\/?c(?:\.[^\s>]*)?>/g;
const WORD = /([ \t\u200b]*)([^ \t\u200b]+)/g;

const cuesOf = (doc: VttDocument): [Cue, number][] =>
  doc.body.flatMap((item, i): [Cue, number][] => (item.type === 'cue' ? [[item, i]] : []));

const nonBlankLines = (text: string): string[] =>
  text.split('\n').filter((line) => line.trim() !== '');

/** The words of a line with markup removed, for comparing lines. */
const lineKey = (raw: string): string =>
  raw
    .replace(/<[^>]*>/g, '')
    .split(/[ \t\u200b]+/)
    .filter(Boolean)
    .join(' ');

const hasTimestamps = (text: string): boolean => /<[0-9]/.test(text);

/** Splits one line of raw cue text into word groups at its timestamp tags. */
function parseLine(raw: string, startMs: number, endMs: number): WordGroup[] {
  // Text before the first timestamp starts at the cue start; each tag starts a new piece.
  const pieces: { at: number | null; raw: string }[] = [{ at: null, raw: '' }];
  let pos = 0;
  for (const m of raw.matchAll(TIMESTAMP_TAG)) {
    const inner = m[1] as string;
    const ts = parseTimestamp(inner);
    if (!ts.ok || ts.end !== inner.length) continue; // Not a timestamp tag: stays as text.
    (pieces.at(-1) as { raw: string }).raw += raw.slice(pos, m.index);
    pieces.push({ at: ts.ms, raw: '' });
    pos = m.index + m[0].length;
  }
  (pieces.at(-1) as { raw: string }).raw += raw.slice(pos);

  const groups: WordGroup[] = [];
  let pending = '';
  for (const piece of pieces) {
    const text = piece.raw.replace(CLASS_TAG, '');
    const words: CaptionWord[] = [];
    let last = 0;
    for (const m of text.matchAll(WORD)) {
      // Lines without word timings come as one run in scripts written without spaces: split it
      // where a line may break.
      const pieces = hasUnspaced(m[2] as string) ? breakUnits(m[2] as string) : [];
      if (pieces.length > 1)
        pieces.forEach((p, k) =>
          words.push(
            k === 0
              ? { text: p.text, gap: pending + (m[1] as string) }
              : { text: p.text, gap: '', split: true },
          ),
        );
      else words.push({ text: m[2] as string, gap: pending + (m[1] as string) });
      pending = '';
      last = m.index + m[0].length;
    }
    pending += text.slice(last);
    if (words.length === 0) continue;
    const prev = groups.at(-1);
    const at = Math.min(Math.max(piece.at ?? startMs, startMs), endMs);
    // Out-of-order or out-of-range timestamps (rare in real files) join the previous group.
    if (prev && (at <= prev.startMs || at >= endMs)) prev.words.push(...words);
    else groups.push({ startMs: at, endMs, words });
  }
  if (groups[0]) (groups[0].words[0] as CaptionWord).gap = LINE_START;
  for (let i = 0; i < groups.length - 1; i++)
    (groups[i] as WordGroup).endMs = (groups[i + 1] as WordGroup).startMs;
  return groups;
}

/**
 * De-roll: the new caption line of every growing cue, skipping hand-off cues (short, untimed,
 * repeating the line just shown). Each line keeps its word timings.
 */
export function extractLines(doc: VttDocument): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let last: string | null = null;
  for (const [cue, source] of cuesOf(doc)) {
    const nonBlank = nonBlankLines(cue.text);
    const newest = nonBlank.at(-1);
    if (newest === undefined) continue;
    const handoff =
      cue.endMs - cue.startMs <= HANDOFF_MAX_MS &&
      !hasTimestamps(cue.text) &&
      last !== null &&
      lineKey(nonBlank[0] as string) === last;
    // Machine translations also hold the last line on for seconds, above an empty new line.
    const holdover =
      nonBlank.length === 1 &&
      cue.text.split('\n').at(-1)?.trim() === '' &&
      !hasTimestamps(cue.text) &&
      lineKey(newest) === last;
    if (handoff || holdover) continue;
    const groups = parseLine(newest, cue.startMs, cue.endMs);
    if (groups.length === 0) continue;
    lines.push({ startMs: cue.startMs, endMs: cue.endMs, groups, source });
    last = lineKey(newest);
  }
  return lines;
}

/** True when every line with three or more timestamps has them evenly spaced. */
function evenlySpaced(lines: CaptionLine[]): boolean {
  let checked = 0;
  let even = 0;
  for (const line of lines) {
    const starts = line.groups.slice(1).map((g) => g.startMs);
    if (starts.length < 3) continue;
    checked++;
    const step = (starts[1] as number) - (starts[0] as number);
    if (starts.every((s, i) => i === 0 || Math.abs(s - (starts[i - 1] as number) - step) <= 1))
      even++;
  }
  return checked >= 2 && even / checked >= 0.8;
}

export function detectAutoCaptions(doc: VttDocument): AutoCaptionInfo {
  return analyze(doc).info;
}

function analyze(doc: VttDocument): { info: AutoCaptionInfo; lines: CaptionLine[] } {
  const cues = cuesOf(doc).map(([cue]) => cue);
  let rolling = 0;
  for (let i = 1; i < cues.length; i++) {
    const first = nonBlankLines((cues[i] as Cue).text)[0];
    const prevLast = nonBlankLines((cues[i - 1] as Cue).text).at(-1);
    if (first !== undefined && prevLast !== undefined && lineKey(first) === lineKey(prevLast))
      rolling++;
  }
  const lines = extractLines(doc);
  const header = doc.head.find(
    (item): item is Note => item.type === 'note' && item.preserved === 'header',
  );
  const language = header ? (/^Language:[ \t]*(\S+)/m.exec(header.text)?.[1] ?? null) : null;
  const info: AutoCaptionInfo = {
    detected: cues.length >= 4 && rolling / (cues.length - 1) >= 0.25,
    cues: cues.length,
    lines: lines.length,
    timedLines: lines.filter((l) => l.groups.length > 1).length,
    approximateTimings: evenlySpaced(lines),
    language,
  };
  return { info, lines };
}

export interface SegmentOptions {
  /** Characters per line (default 42). */
  maxLineLength: number;
  /**
   * What a half-width character (Latin, ASCII digits, punctuation and spaces) counts as in line
   * lengths: 1 (default), or 0.5 as the Japanese and Korean guides count.
   */
  halfWidth: number;
  /** Lines per cue (default 2). */
  maxLines: number;
  /** Shorter cues are discouraged, not forbidden (default 1000). */
  minDurationMs: number;
  /** Longer cues are split unless a single word group is that long (default 7000). */
  maxDurationMs: number;
  /** Faster cues are discouraged (default 20). */
  maxCharsPerSecond: number;
  /** Start a new cue where the speaker changes (YouTube writes ">>"). Default true. */
  breakOnSpeakerChange: boolean;
  /** Start a new cue after a silence this long (default 1500). */
  maxGapMs: number;
  /**
   * How long the last word before a pause stays on screen (default 2000). A word lasts until the
   * next one starts, so without this, a pause (or music) would stretch its cue; sound tags such
   * as `[music]` keep their full duration.
   */
  maxWordHoldMs: number;
  /**
   * 'word' lets cues break between any timed words; 'line' only between YouTube's lines, at
   * sentence ends within them, and inside a line too long for one cue (for approximate timings,
   * where word times are guesses). Default: 'line' when approximate.
   */
  unit: 'word' | 'line';
  /**
   * Collapse runs of spaces between words to one, and remove spaces between Chinese or Japanese
   * characters (default true).
   */
  collapseSpaces: boolean;
  /**
   * Remove the doubled U+200B ZERO WIDTH SPACEs machine translations leave (default true). As
   * U+200B is real word separation in some scripts (Thai, Khmer…), one is kept where nothing
   * else separates the words.
   */
  removeDoubledZeroWidthSpaces: boolean;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  maxLineLength: 42,
  halfWidth: 1,
  maxLines: 2,
  minDurationMs: 1000,
  maxDurationMs: 7000,
  maxCharsPerSecond: 20,
  breakOnSpeakerChange: true,
  maxGapMs: 1500,
  maxWordHoldMs: 2000,
  unit: 'word',
  collapseSpaces: true,
  removeDoubledZeroWidthSpaces: true,
};

type GapOptions = Pick<SegmentOptions, 'collapseSpaces' | 'removeDoubledZeroWidthSpaces'> &
  Partial<Pick<SegmentOptions, 'halfWidth'>>;

/** A sound tag such as `[Music]` (not the censored-word marker `[ __ ]`). */
const isSoundTag = (raw: string): boolean => {
  const text = raw.replace(/<[^>]*>/g, '');
  return /^\[[^\]]*\]$/.test(text) && !text.includes('__');
};

/**
 * The gap before the first word of a caption line. When lines are joined into one cue line, it
 * becomes a space, or nothing between scripts written without spaces (Chinese, Japanese, Thai…).
 */
const LINE_START = '\n';

/** Punctuation that closes what comes before it, at the start of a word. */
const CLOSING_START = /^(?:<[^>]*>)*[.,!?…;:。、！？，；：؟،।॥)\]}」』）】》〉’”»]/u;

/**
 * The separator written before a word: its gap in the source, tidied. `before` and `after` are
 * the words on either side, which decide how lines join.
 */
export function gapText(gap: string, o: GapOptions, before?: string, after?: string): string {
  if (gap === LINE_START) {
    if (after === undefined) return ' ';
    // A line that starts with the previous sentence's punctuation (". next" in translations).
    if (before !== undefined && CLOSING_START.test(after)) return '';
    return joinsWithoutSpace(before, after) ? '' : ' ';
  }
  let g = gap;
  if (o.removeDoubledZeroWidthSpaces)
    g = /[ \t]/.test(g) ? g.replace(/\u200b+/g, '') : g.replace(/\u200b{2,}/g, '\u200b');
  if (o.collapseSpaces) {
    g = g.replace(/[ \t]{2,}/g, ' ');
    // Chinese and Japanese take no spaces; machine translations put them after "。" and "、".
    if (before !== undefined && after !== undefined && /^[ \t]+$/.test(g)) {
      if (joinsWithoutSpace(before, after)) g = '';
    }
  }
  return g;
}

/** A cue to be: consecutive word groups, wrapped into lines. */
export interface Segment {
  startMs: number;
  endMs: number;
  groups: WordGroup[];
  /** Source cue (body index) of the first group. */
  source: number;
}

interface Unit {
  startMs: number;
  endMs: number;
  groups: WordGroup[];
  source: number;
  /** Visible characters, including separators inside the unit. */
  chars: number;
  /** Visible length of the separator before the unit. */
  gapBefore: number;
  speakerChange: boolean;
  /** Starts with punctuation alone (" ." in some translations): never break before it. */
  attached: boolean;
  /** Only a sound tag (a whole "[Music]" line): it gets a cue of its own. */
  soundOnly: boolean;
  /** Visible text of the last word. */
  lastWord: string;
}

/**
 * Visible length of raw cue text: tags and zero-width spaces removed, each character reference
 * one character, half-width characters counting `halfWidth`.
 */
export function visibleLength(raw: string, halfWidth = 1): number {
  return displayLength(
    raw
      .replace(/<[^>]*>|\u200b/g, '')
      .replace(/&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, 'x'),
    halfWidth,
  );
}

const wordsOf = (groups: WordGroup[]): CaptionWord[] => groups.flatMap((g) => g.words);

/**
 * A word group too long for one cue (an untimed line, all one group) as groups of a line's worth
 * of words each, their start times estimated from the characters before them.
 */
function splitLongGroup(
  g: WordGroup,
  o: GapOptions & Pick<SegmentOptions, 'maxLineLength' | 'maxLines'>,
): WordGroup[] {
  if (g.words.length < 2 || wrapWords(g.words, o.maxLineLength, o.maxLines, o, true)) return [g];
  const lines = wrapWords(g.words, o.maxLineLength, Infinity, o) ?? [g.words];
  if (lines.length < 2) return [g];
  const lengths = lines.map((ws) => ws.reduce((n, w) => n + wordLength(w, o.halfWidth), 0));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const out: WordGroup[] = [];
  let before = 0;
  lines.forEach((ws, i) => {
    const startMs = Math.round(g.startMs + ((g.endMs - g.startMs) * before) / total);
    before += lengths[i] as number;
    const prev = out.at(-1);
    // Too little time to tell the pieces apart: keep them together.
    if (prev && startMs <= prev.startMs) prev.words.push(...ws);
    else out.push({ startMs, endMs: g.endMs, words: [...ws] });
  });
  for (let i = 0; i < out.length - 1; i++)
    (out[i] as WordGroup).endMs = (out[i + 1] as WordGroup).startMs;
  return out;
}

function toUnits(
  lines: CaptionLine[],
  unit: 'word' | 'line',
  o: GapOptions & Pick<SegmentOptions, 'maxWordHoldMs' | 'maxLineLength' | 'maxLines'>,
): Unit[] {
  // `soundLine`: the caption line is nothing but sound tags (a whole "[Music]" line).
  const make = (groups: WordGroup[], source: number, soundLine: boolean): Unit => {
    const words = wordsOf(groups);
    const last = words.at(-1) as CaptionWord;
    const lastGroup = groups.at(-1) as WordGroup;
    const sound = soundLine;
    return {
      startMs: (groups[0] as WordGroup).startMs,
      endMs: sound
        ? lastGroup.endMs
        : Math.min(lastGroup.endMs, lastGroup.startMs + o.maxWordHoldMs),
      groups,
      source,
      chars: words.reduce(
        (n, w, i) =>
          n +
          visibleLength(w.text, o.halfWidth) +
          (i > 0 ? visibleLength(gapText(w.gap, o, words[i - 1]?.text, w.text), o.halfWidth) : 0),
        0,
      ),
      gapBefore: visibleLength(
        gapText((words[0] as CaptionWord).gap, o, undefined, (words[0] as CaptionWord).text),
        o.halfWidth,
      ),
      speakerChange: (words[0] as CaptionWord).text.startsWith('&gt;&gt;'),
      attached: isPunctuation((words[0] as CaptionWord).text),
      soundOnly: soundLine,
      lastWord: last.text.replace(/<[^>]*>/g, ''),
    };
  };
  return lines.flatMap((source) => {
    const line = { ...source, groups: source.groups.flatMap((g) => splitLongGroup(g, o)) };
    const soundLine = wordsOf(line.groups).every((w) => isSoundTag(w.text));
    if (unit === 'word') return line.groups.map((g) => make([g], line.source, soundLine));
    // A line in pieces ending at sentence ends ("…広がった。" | "わから").
    const pieces: WordGroup[][] = [[]];
    line.groups.forEach((g, k) => {
      (pieces.at(-1) as WordGroup[]).push(g);
      const lastWord = (g.words.at(-1) as CaptionWord).text.replace(/<[^>]*>/g, '');
      if (k < line.groups.length - 1 && SENTENCE_END.test(lastWord)) pieces.push([]);
    });
    // A piece too long for one cue (short lines, as in Japanese) breaks between its words too.
    return pieces.flatMap((groups) => {
      const whole = make(groups, line.source, soundLine);
      const fits =
        whole.chars <= o.maxLineLength ||
        wrapWords(wordsOf(groups), o.maxLineLength, o.maxLines, o, true) !== null;
      return !fits && groups.length > 1
        ? groups.map((g) => make([g], line.source, soundLine))
        : [whole];
    });
  });
}

// Segmentation measures the same words many times; cache their lengths.
const wordLengths = new WeakMap<CaptionWord, number>();
const wordLength = (w: CaptionWord, halfWidth = 1): number => {
  if (halfWidth !== 1) return visibleLength(w.text, halfWidth); // Cached in displayLength.
  let l = wordLengths.get(w);
  if (l === undefined) wordLengths.set(w, (l = visibleLength(w.text)));
  return l;
};
const gapLength = (gap: string, o: GapOptions, before?: string, after?: string): number =>
  gap === ' ' ? (o.halfWidth ?? 1) : visibleLength(gapText(gap, o, before, after), o.halfWidth);

/** A word that is only punctuation, which must stay on the line of the word before it. */
const isPunctuation = (text: string): boolean =>
  /^[\p{Pe}\p{Pf}.,!?…;:"'。、！？，；：؟،।॥]+$/u.test(text);

/** Closing quotes and brackets that may follow the end of a sentence or clause. */
const CLOSERS = `["'”’»)\\]」』）】》〉]*`;
const SENTENCE_END = new RegExp(`[.!?…。！？؟।॥]${CLOSERS}$`, 'u');
const CLAUSE_END = new RegExp(`[,;:–—、，；：،]${CLOSERS}$`, 'u');

/**
 * Splits words into at most `maxLines` lines of at most `maxLineLength`, balanced; or null. A line
 * may run over for a single word, or punctuation that stays with its word; with `strict` (when
 * choosing cues), only for a single word.
 */
export function wrapWords(
  words: CaptionWord[],
  maxLineLength: number,
  maxLines: number,
  o: GapOptions = DEFAULT_SEGMENT_OPTIONS,
  strict = false,
): CaptionWord[][] | null {
  const gaps = words.map((w, k) => gapLength(w.gap, o, words[k - 1]?.text, w.text));
  // prefix[k]: visible length of words[0..k) with the separators between them.
  const prefix = [0];
  words.forEach((w, k) =>
    prefix.push(
      (prefix[k] as number) + (k > 0 ? (gaps[k] as number) : 0) + wordLength(w, o.halfWidth),
    ),
  );
  const lineLength = (from: number, to: number): number =>
    (prefix[to] as number) - (prefix[from] as number) - (from > 0 ? (gaps[from] as number) : 0);
  if (lineLength(0, words.length) <= maxLineLength) return [words];
  // Not before punctuation, nor inside a word (a word split over timed pieces, "わから" + "ない").
  const canBreakBefore = (k: number): boolean => {
    const w = words[k] as CaptionWord;
    if (isPunctuation(w.text)) return false;
    if (w.split) return true;
    return !(gaps[k] === 0 && continuesWord((words[k - 1] as CaptionWord).text, w.text));
  };
  if (maxLines < 2) return null;
  // Best single break: both lines fit, as even as possible, preferring punctuation.
  let best = -1;
  let bestScore = Infinity;
  for (let k = 1; k < words.length; k++) {
    if (!canBreakBefore(k)) continue;
    const a = lineLength(0, k);
    const b = lineLength(k, words.length);
    if (a > maxLineLength || b > maxLineLength) continue;
    const prev = (words[k - 1] as CaptionWord).text;
    const bonus = SENTENCE_END.test(prev) ? 12 : CLAUSE_END.test(prev) ? 6 : 0;
    const speaker = (words[k] as CaptionWord).text.startsWith('&gt;&gt;') ? 20 : 0;
    const score = Math.abs(a - b) - bonus - speaker;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (best !== -1) return [words.slice(0, best), words.slice(best)];
  // No two-line fit: greedy fill (a single over-long word gets a line of its own).
  const lines: CaptionWord[][] = [];
  let line: CaptionWord[] = [];
  let length = 0;
  let overflow = false;
  words.forEach((w, k) => {
    const l = wordLength(w, o.halfWidth);
    const gap = gaps[k] as number;
    if (line.length > 0 && length + gap + l > maxLineLength) {
      if (canBreakBefore(k)) {
        lines.push(line);
        line = [];
        length = 0;
      } else overflow = true; // Punctuation, or a word that cannot be split.
    }
    length += (line.length > 0 ? gap : 0) + l;
    line.push(w);
  });
  lines.push(line);
  return lines.length <= maxLines && !(strict && overflow) ? lines : null;
}

/** Groups caption lines into cues; see `SegmentOptions` for the rules. */
export function segment(lines: CaptionLine[], options: Partial<SegmentOptions> = {}): Segment[] {
  const o = { ...DEFAULT_SEGMENT_OPTIONS, ...options };
  const units = toUnits(lines, o.unit, o);
  const n = units.length;
  const capacity = o.maxLineLength * o.maxLines;
  // A unit that continues the previous unit's word (a line that ends mid-word).
  const gluedBefore = (k: number): boolean => {
    const first = wordsOf((units[k] as Unit).groups)[0] as CaptionWord;
    const prev = wordsOf((units[k - 1] as Unit).groups).at(-1) as CaptionWord;
    return (
      gapText(first.gap, o, prev.text, first.text) === '' && continuesWord(prev.text, first.text)
    );
  };
  const glued = units.map((_, k) => k > 0 && gluedBefore(k));
  const forcedBefore = (k: number): boolean => {
    if (k <= 0 || k >= n) return false;
    const u = units[k] as Unit;
    const prev = units[k - 1] as Unit;
    // A pause does not part a word from its ending, or punctuation from what it closes (machine
    // translations keep the source's pauses, wherever they fall in the translated text).
    const pause = u.startMs - prev.endMs > o.maxGapMs && !u.attached && !glued[k];
    return u.soundOnly || prev.soundOnly || (o.breakOnSpeakerChange && u.speakerChange) || pause;
  };
  const breakCost = (j: number): number => {
    if (j === n - 1 || forcedBefore(j + 1)) return 0;
    const word = (units[j] as Unit).lastWord;
    return SENTENCE_END.test(word) ? 0 : CLAUSE_END.test(word) ? 1.5 : 4;
  };

  // best[j]: cheapest segmentation of units[0..j-1]; from[j]: where its last segment starts.
  const best = new Float64Array(n + 1).fill(Infinity);
  const from = new Int32Array(n + 1);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === Infinity) continue;
    let chars = 0;
    let sentenceInside = false;
    const words: CaptionWord[] = [];
    for (let j = i; j < n; j++) {
      const u = units[j] as Unit;
      if (j > i && forcedBefore(j)) break;
      // A cue should not start with an attached unit (heavily penalized rather than forbidden,
      // so that a segmentation always exists).
      const endsBeforeAttached = j + 1 < n && ((units[j + 1] as Unit).attached || glued[j + 1]);
      chars += u.chars + (j > i ? u.gapBefore : 0);
      for (const g of u.groups) words.push(...g.words);
      const duration = u.endMs - (units[i] as Unit).startMs;
      const single = j === i;
      if (!single && (chars > capacity || duration > o.maxDurationMs)) break;
      if (
        !single &&
        chars > o.maxLineLength &&
        !wrapWords(words, o.maxLineLength, o.maxLines, o, true)
      )
        break;
      let cost = 1 + breakCost(j);
      if (sentenceInside && !SENTENCE_END.test(u.lastWord) && breakCost(j) > 0) cost += 1.5;
      if (duration < o.minDurationMs) cost += (3 * (o.minDurationMs - duration)) / o.minDurationMs;
      const cps = chars / Math.max(duration / 1000, 0.001);
      if (cps > o.maxCharsPerSecond)
        cost += (3 * (cps - o.maxCharsPerSecond)) / o.maxCharsPerSecond;
      if (endsBeforeAttached) cost += 20;
      if ((best[i] as number) + cost < (best[j + 1] as number)) {
        best[j + 1] = (best[i] as number) + cost;
        from[j + 1] = i;
      }
      if (SENTENCE_END.test(u.lastWord)) sentenceInside = true;
    }
  }

  const segments: Segment[] = [];
  for (let j = n; j > 0; j = from[j] as number) {
    const i = from[j] as number;
    const slice = units.slice(i, j);
    segments.push({
      startMs: (slice[0] as Unit).startMs,
      endMs: (slice.at(-1) as Unit).endMs,
      groups: slice.flatMap((u) => u.groups),
      source: (slice[0] as Unit).source,
    });
  }
  return segments.reverse();
}

export interface CleanupOptions extends SegmentOptions {
  /** Keep word timings as timestamp tags (default: yes, unless timings are approximate). */
  keepWordTimings: boolean;
  /** Keep the source cues' settings (YouTube's `align:start position:0%`). Default false. */
  keepCueSettings: boolean;
  /**
   * Wrap the cue text in `<c>` so `:past` / `:future` and `c` backgrounds reach it (the source's
   * own `<c>` spans are not kept). Default: what the document's style sheets need.
   */
  wrapInC: TextWrap;
}

export interface CleanupReport {
  sourceCues: number;
  lines: number;
  words: number;
  cues: number;
  approximateTimings: boolean;
}

export interface CleanupResult {
  document: VttDocument;
  report: CleanupReport;
}

/** Builds raw cue text: lines wrapped, word timings as timestamp tags if wanted. */
function cueText(seg: Segment, o: CleanupOptions): string {
  const starts = new Map<CaptionWord, number>();
  for (const g of seg.groups) starts.set(g.words[0] as CaptionWord, g.startMs);
  const words = wordsOf(seg.groups);
  // A single word group too long for the line limit still gets wrapped, onto more lines.
  const wrapped = wrapWords(words, o.maxLineLength, o.maxLines, o) ??
    wrapWords(words, o.maxLineLength, Infinity, o) ?? [words];
  let last = seg.startMs;
  return wrapped
    .map((line) =>
      line
        .map((w, k) => {
          const at = starts.get(w);
          let tag = '';
          if (o.keepWordTimings && at !== undefined && at > last && at < seg.endMs) {
            tag = `<${formatTimestamp(at)}>`;
            last = at;
          }
          return (k === 0 ? '' : gapText(w.gap, o, line[k - 1]?.text, w.text)) + tag + w.text;
        })
        .join(''),
    )
    .join('\n');
}

/**
 * Cleans up roll-up auto-captions: de-roll, re-segment, and rebuild the cues. Notes in the body
 * stay before the cue that follows them in the source; the head is unchanged.
 */
export function cleanupAutoCaptions(
  doc: VttDocument,
  options: Partial<CleanupOptions> = {},
): CleanupResult {
  const { info, lines } = analyze(doc);
  const o: CleanupOptions = {
    ...DEFAULT_SEGMENT_OPTIONS,
    unit: info.approximateTimings ? 'line' : 'word',
    keepWordTimings: !info.approximateTimings,
    keepCueSettings: false,
    wrapInC: wrapForStyles(doc),
    ...options,
  };
  const segments = segment(lines, o);

  const body: BodyItem[] = [];
  const notes = doc.body
    .map((item, i) => [item, i] as const)
    .filter((entry): entry is readonly [Note, number] => entry[0].type === 'note');
  let nextNote = 0;
  for (const seg of segments) {
    while (nextNote < notes.length && (notes[nextNote] as readonly [Note, number])[1] < seg.source)
      body.push((notes[nextNote++] as readonly [Note, number])[0]);
    const source = doc.body[seg.source] as Cue;
    const fresh = createCue(seg.startMs, seg.endMs, applyTextWrap(cueText(seg, o), o.wrapInC));
    const cue: Cue = o.keepCueSettings
      ? { ...source, id: '', startMs: seg.startMs, endMs: seg.endMs, text: fresh.text }
      : fresh;
    delete cue.source;
    body.push(cue);
  }
  while (nextNote < notes.length) body.push((notes[nextNote++] as readonly [Note, number])[0]);

  return {
    document: { ...doc, body },
    report: {
      sourceCues: info.cues,
      lines: lines.length,
      words: lines.reduce((n, l) => n + wordsOf(l.groups).length, 0),
      cues: segments.length,
      approximateTimings: info.approximateTimings,
    },
  };
}

export type ReviewKind = 'censored' | 'sound';

export interface ReviewMarker {
  /** Body index of the cue. */
  index: number;
  kind: ReviewKind;
  /** The marker as written, e.g. `[&nbsp;__&nbsp;]` or `[music]`. */
  text: string;
  /** Offset in the cue's raw text. */
  offset: number;
}

const SPACE = String.raw`(?:&nbsp;|\u00a0| )`;
const CENSORED = new RegExp(String.raw`\[${SPACE}__${SPACE}\]`, 'g');
const SOUND = new RegExp(String.raw`\[(?!${SPACE}__${SPACE}\])[^\]\n<]{1,40}\]`, 'g');

/**
 * Things in cue text worth a human look: YouTube's censored-word marker (`[ __ ]`), which
 * usually hides a word the user wants back, and sound tags such as `[music]`.
 */
export function findReviewMarkers(doc: VttDocument): ReviewMarker[] {
  const out: ReviewMarker[] = [];
  doc.body.forEach((item, index) => {
    if (item.type !== 'cue') return;
    for (const [kind, re] of [
      ['censored', CENSORED],
      ['sound', SOUND],
    ] as const)
      for (const m of item.text.matchAll(re))
        out.push({ index, kind, text: m[0], offset: m.index });
  });
  return out.sort((a, b) => a.index - b.index || a.offset - b.offset);
}

/** Where the cleanup's line limits came from, for the dialog to say. */
export interface LineDefaults {
  maxLineLength: number;
  maxLines: number;
  halfWidth: number;
  /** The ruleset's name or the language's, or null for the general default. */
  from: string | null;
}

/** Line limits by language, for text with no style guide chosen (Netflix's figures). */
const LINE_DEFAULTS_BY_LANGUAGE: Record<string, { maxLineLength: number; halfWidth: number }> = {
  ja: { maxLineLength: 13, halfWidth: 0.5 },
  ko: { maxLineLength: 16, halfWidth: 0.5 },
  zh: { maxLineLength: 16, halfWidth: 1 },
};

/**
 * The line limits a cleanup starts with: those of the chosen ruleset when it follows a guide for
 * the text's language (with the user's changes to it); otherwise the usual limits for the
 * language; otherwise 42 characters. At most two lines: guides that allow a third keep it for
 * sound descriptions.
 */
export function cleanupLineDefaults(
  ruleset: Ruleset | undefined,
  overrides: RuleOverrides,
  language: string | null,
): LineDefaults {
  const fits =
    ruleset?.language !== undefined &&
    (language === null || languageMatches(ruleset.language, language));
  if (ruleset && fits) {
    const rules = effectiveRules(ruleset, overrides);
    const length = rules.find((r) => r.id === 'line-length')?.params;
    if (length?.['max'] !== undefined) {
      const lines = rules.find((r) => r.id === 'max-lines')?.params['max'] ?? 2;
      return {
        maxLineLength: length['max'],
        maxLines: Math.min(lines, 2),
        halfWidth: length['halfWidth'] ?? 1,
        from: ruleset.name,
      };
    }
  }
  const primary = language?.split('-')[0]?.toLowerCase();
  const byLanguage = primary ? LINE_DEFAULTS_BY_LANGUAGE[primary] : undefined;
  if (byLanguage && language) {
    return { ...byLanguage, maxLines: 2, from: languageName(primary as string) ?? language };
  }
  return { maxLineLength: 42, maxLines: 2, halfWidth: 1, from: null };
}
