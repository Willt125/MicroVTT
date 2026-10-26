/**
 * The rules. Each is generic and has numeric settings; rulesets (rulesets.ts) pick rules and
 * settings to match a guide. Lengths are counted in graphemes of the text a viewer reads
 * (measure.ts), so markup, character references and ruby annotations do not count.
 */
import type { Cue, VttDocument } from '../document.ts';
import type { TextDialect } from '../format/dialect.ts';
import { parseStylesheet } from '../css.ts';
import { composite, contrastRatio, hexOf, parseColour, type Rgba } from './colour.ts';
import { breakUnits, joinLines, type BreakUnit } from '../script.ts';
import { displayLength, formatCount, graphemeLength, wordCount } from './measure.ts';
import { isPlain, markupPattern } from './markup.ts';
import { shotChangesBetween } from '../shotchanges.ts';
import { NETFLIX_GLYPH_RANGES } from './netflix-glyphs.generated.ts';
import { CJK_RULES } from './rules-cjk.ts';
import { FINNISH_RULES } from './rules-fi.ts';
import type { ParamSpec, QualityCategory, QualityFix, QualityRuleId } from './types.ts';

/** A cue as the rules see it. */
export interface CueInfo {
  cue: Cue;
  /** Body index. */
  index: number;
  /** The text a viewer reads, by line. */
  lines: string[];
  /** How the cue's text is written: fixes keep its markup as it is. */
  dialect: TextDialect;
  /** The next cue in the file, or null. */
  next: CueInfo | null;
  /** The previous cue in the file, or null. */
  previous: CueInfo | null;
  /** The video's shot changes (ms, sorted), when known; empty if none are marked. */
  shotChanges: readonly number[];
}

export interface Emitted {
  list?: 'body' | 'head';
  index: number;
  message: string;
  fix?: QualityFix;
}

export interface RuleDefinition {
  id: QualityRuleId;
  category: QualityCategory;
  title: string;
  /** What the rule checks, in one sentence. */
  description: string;
  params: ParamSpec[];
  defaults: Record<string, number>;
  /** Checks one cue. */
  cue?: (info: CueInfo, params: Record<string, number>, emit: (f: Emitted) => void) => void;
  /** Checks the document as a whole (e.g. its style sheets). */
  document?: (doc: VttDocument, params: Record<string, number>, emit: (f: Emitted) => void) => void;
}

/** The setting for guides that count half-width characters (Latin, ASCII) as half. */
const HALF_WIDTH_PARAM: ParamSpec = {
  key: 'halfWidth',
  label: 'Half-width characters count as',
  unit: 'chars',
  min: 0.5,
  max: 1,
  step: 0.5,
};

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 2)} s`;
const duration = (c: Cue): number => c.endMs - c.startMs;
const plain = (info: CueInfo): string => info.lines.join('\n');

/**
 * Lines for `words` in at most two lines of at most `max` characters; one line if the text
 * fits. Of the two-line splits that fit, a bottom-heavy one (the second line no shorter) is
 * preferred, then one without just one or two words on top, then the most even. Null when it
 * cannot fit.
 */
export function balanceLines(
  words: readonly (string | BreakUnit)[],
  max: number,
  measure: (text: string) => number = graphemeLength,
): string[] | null {
  const units = words.map((w) => (typeof w === 'string' ? { text: w, gap: ' ' } : w));
  const join = (from: number, to: number): string =>
    units
      .slice(from, to)
      .map((u, i) => (i === 0 ? '' : u.gap) + u.text)
      .join('');
  const all = join(0, units.length);
  if (measure(all) <= max) return [all];
  let best: string[] | null = null;
  let bestScore = Infinity;
  for (let k = 1; k < words.length; k++) {
    const top = join(0, k);
    const bottom = join(k, units.length);
    const [a, b] = [measure(top), measure(bottom)];
    if (a > max || b > max) continue;
    const score = Math.abs(a - b) + (a > b ? 1000 : 0) + (k <= 2 && words.length - k > 2 ? 500 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = [top, bottom];
    }
  }
  return best;
}

const rewrapFix = (info: CueInfo, max: number, halfWidth = 1): QualityFix | undefined => {
  if (!isPlain(info)) return undefined;
  const lines = balanceLines(breakUnits(info.lines.join('\n')), max, (t) =>
    displayLength(t, halfWidth),
  );
  if (!lines) return undefined;
  const text = lines.join('\n');
  return text === info.cue.text ? undefined : { label: 'Rewrap', change: { kind: 'text', text } };
};

/** Last words that should not end a line: they belong with what follows (English). */
const BINDING_WORDS = new Set(
  (
    'a an the of in on at to for with from by about into onto over under after before between ' +
    'through during without within upon against among around behind below beneath beside ' +
    'beyond near off toward towards'
  ).split(' '),
);

/** Characters the BBC lists for subtitles (§9.3), with the online-only additions. */
const BBC_CHARACTERS = /[A-Za-z0-9!(),.?:\-><&@#%+*=/£$¢¥©®¼½¾™'" \n€♫←→]/u;
const BBC_REPLACEMENTS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
};
/** The BBC's speaker colours (§8.3). */
const BBC_COLOURS = new Set(['#ffffff', '#ffff00', '#00ffff', '#00ff00']);

/** `::cue` rules of the document's style sheets, with their head index. */
function cueRules(
  doc: VttDocument,
): { index: number; selector: string; decls: Map<string, string> }[] {
  const out: { index: number; selector: string; decls: Map<string, string> }[] = [];
  doc.head.forEach((item, index) => {
    if (item.type !== 'style') return;
    for (const rule of parseStylesheet(item.css).validRules) {
      if (rule.atRule || !rule.prelude.includes('::cue')) continue;
      const decls = new Map(rule.declarations.map((d) => [d.name.toLowerCase(), d.value]));
      out.push({ index, selector: rule.prelude.trim(), decls });
    }
  });
  return out;
}

const backgroundOf = (decls: Map<string, string>): Rgba | null => {
  const value = decls.get('background-color') ?? decls.get('background');
  return value === undefined ? null : parseColour(value);
};

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
/** The cue background WebVTT renderers draw by default (§7.4: rgba(0,0,0,0.8)). */
const DEFAULT_BACKGROUND: Rgba = { r: 0, g: 0, b: 0, a: 0.8 };

/** The Netflix Glyph List as sorted range starts and ends, built on first use. */
let glyphRanges: { starts: Uint32Array; ends: Uint32Array } | null = null;

/** Whether a code point is in the Netflix Glyph List (version 2). */
export function inNetflixGlyphList(codePoint: number): boolean {
  if (!glyphRanges) {
    const parts = NETFLIX_GLYPH_RANGES.split(',');
    const starts = new Uint32Array(parts.length);
    const ends = new Uint32Array(parts.length);
    parts.forEach((part, i) => {
      const [a, b = a] = part.split('-') as [string, string?];
      starts[i] = parseInt(a, 36);
      ends[i] = parseInt(b, 36);
    });
    glyphRanges = { starts, ends };
  }
  const { starts, ends } = glyphRanges;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (codePoint < (starts[mid] as number)) hi = mid - 1;
    else if (codePoint > (ends[mid] as number)) lo = mid + 1;
    else return true;
  }
  return false;
}

const RULE_LIST: RuleDefinition[] = [
  {
    id: 'empty-cue',
    category: 'text',
    title: 'Empty cue',
    description: 'A cue with no text to read.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (plain(info).trim() === '')
        emit({
          index: info.index,
          message: 'This cue has no text.',
          fix: { label: 'Delete', change: { kind: 'delete' } },
        });
    },
  },
  {
    id: 'min-duration',
    category: 'timing',
    title: 'Minimum duration',
    description: 'A cue shown too briefly to be read.',
    params: [{ key: 'minMs', label: 'Shortest', unit: 'ms', min: 0, max: 5000, step: 10 }],
    defaults: { minMs: 500 },
    cue({ cue, index, next }, { minMs = 0 }, emit) {
      const d = duration(cue);
      if (d >= minMs) return;
      const end = cue.startMs + Math.ceil(minMs);
      const fits = !next || end <= next.cue.startMs;
      emit({
        index,
        message: `Shown for ${seconds(d)}; the shortest is ${seconds(minMs)}.`,
        ...(fits
          ? {
              fix: {
                label: `Lengthen to ${seconds(end - cue.startMs)}`,
                change: { kind: 'times', startMs: cue.startMs, endMs: end },
              },
            }
          : {}),
      });
    },
  },
  {
    id: 'max-duration',
    category: 'timing',
    title: 'Maximum duration',
    description: 'A cue left on screen longer than the limit.',
    params: [{ key: 'maxMs', label: 'Longest', unit: 'ms', min: 1000, max: 60000, step: 100 }],
    defaults: { maxMs: 10000 },
    cue({ cue, index }, { maxMs = Infinity }, emit) {
      const d = duration(cue);
      if (d > maxMs)
        emit({ index, message: `Shown for ${seconds(d)}; the longest is ${seconds(maxMs)}.` });
    },
  },
  {
    id: 'min-gap',
    category: 'timing',
    title: 'Gap between cues',
    description:
      'A gap between cues so short that captions flicker; cues may also follow on directly.',
    params: [{ key: 'minMs', label: 'Shortest gap', unit: 'ms', min: 0, max: 5000, step: 10 }],
    defaults: { minMs: 80 },
    cue({ cue, index, next }, { minMs = 0 }, emit) {
      if (!next) return;
      const gap = next.cue.startMs - cue.endMs;
      if (gap <= 0 || gap >= minMs) return;
      emit({
        index,
        message: `A ${gap} ms gap before the next cue; leave none, or at least ${seconds(minMs)}.`,
        fix: {
          label: 'Close the gap',
          change: { kind: 'times', startMs: cue.startMs, endMs: next.cue.startMs },
        },
      });
    },
  },
  {
    id: 'frame-gaps',
    category: 'timing',
    title: 'Frame gaps',
    description:
      'Gaps between cues of exactly the minimum number of frames, or at least the given time: shorter gaps are closed to the minimum.',
    params: [
      { key: 'frames', label: 'Gap', unit: 'frames', min: 0, max: 24, step: 1 },
      { key: 'closeBelowMs', label: 'Close gaps under', unit: 'ms', min: 0, max: 5000, step: 10 },
      { key: 'fps', label: 'Frame rate', unit: 'fps', min: 1, max: 120, step: 0.001 },
    ],
    defaults: { frames: 2, closeBelowMs: 500, fps: 24 },
    cue({ cue, index, next }, { frames = 2, closeBelowMs = 500, fps = 24 }, emit) {
      if (!next) return;
      const gap = next.cue.startMs - cue.endMs;
      const minGap = (frames * 1000) / fps;
      // Times are whole ms: a gap within a millisecond of the frames counts as that many frames.
      if (Math.abs(gap - minGap) <= 1 || gap >= closeBelowMs) return;
      const end = next.cue.startMs - Math.round(minGap);
      const framesOf = (ms: number): string => `${Math.round((ms * fps) / 1000)} frames`;
      emit({
        index,
        message:
          gap < minGap
            ? `${gap < 0 ? 'Overlaps the next cue' : `Only ${framesOf(gap)} before the next cue`}; leave ${frames} frames.`
            : `A gap of ${framesOf(gap)} (${gap} ms) before the next cue; close it to ${frames} frames, or leave at least ${seconds(closeBelowMs)}.`,
        ...(end > cue.startMs
          ? {
              fix: {
                label: `Leave ${frames} frames`,
                change: { kind: 'times', startMs: cue.startMs, endMs: end },
              },
            }
          : {}),
      });
    },
  },
  {
    id: 'overlap',
    category: 'timing',
    title: 'Overlapping cues',
    description: 'A cue still showing when the next one starts.',
    params: [],
    defaults: {},
    cue({ cue, index, next }, _, emit) {
      if (!next || next.cue.startMs >= cue.endMs) return;
      emit({
        index,
        message: `Overlaps the next cue by ${seconds(cue.endMs - next.cue.startMs)}.`,
        ...(next.cue.startMs > cue.startMs
          ? {
              fix: {
                label: 'End where the next starts',
                change: { kind: 'times', startMs: cue.startMs, endMs: next.cue.startMs },
              },
            }
          : {}),
      });
    },
  },
  {
    id: 'shot-changes',
    category: 'timing',
    title: 'Shot changes',
    description:
      'Cues timed to the shot changes marked for the video: starting on the cut, or at least half a second before it; ending two frames before it, or at least half a second after it.',
    params: [
      { key: 'halfMs', label: 'Keep clear of a cut by', unit: 'ms', min: 0, max: 2000, step: 10 },
      { key: 'frames', label: 'Gap before a cut', unit: 'frames', min: 0, max: 24, step: 1 },
      { key: 'fps', label: 'Frame rate', unit: 'fps', min: 1, max: 120, step: 0.001 },
    ],
    defaults: { halfMs: 500, frames: 2, fps: 24 },
    cue(info, { halfMs = 500, frames = 2, fps = 24 }, emit) {
      const { cue, index, previous, next, shotChanges } = info;
      if (shotChanges.length === 0) return;
      // Worked in frames, as the guide is: times are whole ms, so frames are rounded.
      const frameOf = (ms: number): number => Math.round((ms * fps) / 1000);
      const msOf = (frame: number): number =>
        frame <= 0 ? 0 : Math.ceil((frame * 1000) / fps - 1e-6);
      const half = (halfMs * fps) / 1000;
      const halfUp = Math.ceil(half - 1e-6);
      const count = (n: number): string => `${n} ${n === 1 ? 'frame' : 'frames'}`;
      const halfText = `half a second (${count(halfUp)})`;
      const s = frameOf(cue.startMs);
      const e = frameOf(cue.endMs);
      const prevEnd = previous ? frameOf(previous.cue.endMs) : -Infinity;
      const nextStart = next ? frameOf(next.cue.startMs) : Infinity;
      const near = shotChangesBetween(
        shotChanges,
        cue.startMs - halfMs - 100,
        cue.endMs + halfMs + 100,
      ).map(frameOf);
      const messages: string[] = [];
      let start = s;
      let end = e;
      let fixable = true;

      // The in-time: on the cut, or at least half a second before it (sections 2 and 4).
      const cutAtStart = near.find((k) => s - k > -half && s - k < half && s !== k);
      if (cutAtStart !== undefined) {
        const k = cutAtStart;
        const d = s - k;
        const options: number[] = [];
        if (d > 0) {
          messages.push(`Starts ${count(d)} after a shot change; start on the cut.`);
          options.push(k);
        } else {
          messages.push(
            `Starts ${count(-d)} before a shot change; start on the cut, or at least ${halfText} before it.`,
          );
          // Nearer half a second before: brought forward; nearer the cut: moved to it.
          const forward = k - halfUp;
          options.push(...(-d > half / 2 ? [forward, k] : [k, forward]));
        }
        const choice = options.find((t) => t >= 0 && t - prevEnd >= frames && t < e);
        if (choice === undefined) fixable = false;
        else start = choice;
      }

      // The out-time: two frames before the cut, or at least half a second after it.
      const cutAtEnd = near.find(
        (k) => k > start && e - k > -frames - half && e - k < half && e - k !== -frames,
      );
      if (cutAtEnd !== undefined) {
        const k = cutAtEnd;
        const g = e - k;
        const before = k - frames;
        const after = k + halfUp;
        const canEndBefore = before > start;
        const canEndAfter = nextStart - after >= frames;
        if (g < -frames) {
          messages.push(
            `Ends ${count(-g)} before a shot change; end ${count(frames)} before the cut.`,
          );
          if (nextStart - before >= frames) end = before;
          else fixable = false;
        } else {
          messages.push(
            `${g === 0 ? 'Ends on a shot change' : g < 0 ? `Ends ${count(-g)} before a shot change` : `Ends ${count(g)} after a shot change`}; end ${count(frames)} before the cut, or at least ${halfText} after it.`,
          );
          // Not crossing the cut is preferred, unless that leaves the cue under half a second.
          if (canEndBefore && (before - start >= half || !canEndAfter)) end = before;
          else if (canEndAfter) end = after;
          else fixable = false;
        }
      }

      if (messages.length === 0) return;
      const startMs = start === s ? cue.startMs : msOf(start);
      const endMs = end === e ? cue.endMs : msOf(end);
      emit({
        index,
        message: messages.join(' '),
        ...(fixable && endMs > startMs && (startMs !== cue.startMs || endMs !== cue.endMs)
          ? {
              fix: {
                label: 'Time to the shot changes',
                change: { kind: 'times', startMs, endMs },
              },
            }
          : {}),
      });
    },
  },
  {
    id: 'chars-per-second',
    category: 'reading-speed',
    title: 'Reading speed (characters)',
    description:
      'Characters per second, counting spaces and punctuation but not line breaks, against the cue’s duration.',
    params: [
      { key: 'max', label: 'Fastest', unit: 'chars/s', min: 1, max: 60, step: 1 },
      HALF_WIDTH_PARAM,
    ],
    defaults: { max: 25, halfWidth: 1 },
    cue(info, { max = Infinity, halfWidth = 1 }, emit) {
      const d = duration(info.cue);
      const chars = displayLength(info.lines.join(''), halfWidth);
      if (d <= 0 || chars === 0) return;
      const cps = chars / (d / 1000);
      if (cps > max)
        emit({
          index: info.index,
          message: `${cps.toFixed(1)} characters per second; the limit is ${max}.`,
        });
    },
  },
  {
    id: 'words-per-minute',
    category: 'reading-speed',
    title: 'Reading speed (words)',
    description: 'Words per minute against the cue’s duration.',
    params: [{ key: 'max', label: 'Fastest', unit: 'words/min', min: 60, max: 400, step: 5 }],
    defaults: { max: 180 },
    cue(info, { max = Infinity }, emit) {
      const d = duration(info.cue);
      const words = wordCount(plain(info));
      if (d <= 0 || words === 0) return;
      const wpm = words / (d / 60000);
      if (wpm > max)
        emit({
          index: info.index,
          message: `${Math.round(wpm)} words per minute; the limit is ${max}.`,
        });
    },
  },
  {
    id: 'max-lines',
    category: 'layout',
    title: 'Number of lines',
    description: 'More lines than the limit.',
    params: [{ key: 'max', label: 'Most lines', unit: 'lines', min: 1, max: 10, step: 1 }],
    defaults: { max: 2 },
    cue(info, { max = Infinity }, emit) {
      const lines = info.lines.length;
      if (lines > max) emit({ index: info.index, message: `${lines} lines; the limit is ${max}.` });
    },
  },
  {
    id: 'line-length',
    category: 'layout',
    title: 'Line length',
    description:
      'A line with more characters than the limit (in vertical cues, the vertical limit if one is set).',
    params: [
      { key: 'max', label: 'Longest line', unit: 'chars', min: 5, max: 120, step: 1 },
      {
        key: 'maxVertical',
        label: 'Longest vertical line (0: the same)',
        unit: 'chars',
        min: 0,
        max: 120,
        step: 1,
      },
      HALF_WIDTH_PARAM,
    ],
    defaults: { max: 42, maxVertical: 0, halfWidth: 1 },
    cue(info, { max: horizontal = Infinity, maxVertical = 0, halfWidth = 1 }, emit) {
      const max = info.cue.vertical && maxVertical > 0 ? maxVertical : horizontal;
      const long = info.lines
        .map((line, i) => [i + 1, displayLength(line, halfWidth)] as const)
        .filter(([, n]) => n > max);
      if (long.length === 0) return;
      const fix = rewrapFix(info, max, halfWidth);
      emit({
        index: info.index,
        message:
          long.map(([i, n]) => `Line ${i} has ${formatCount(n)} characters`).join('; ') +
          `; the limit is ${max}${max === horizontal ? '' : ' (vertical)'}.`,
        ...(fix ? { fix } : {}),
      });
    },
  },
  {
    id: 'line-shape',
    category: 'layout',
    title: 'Line shape',
    description:
      'Two lines where the top one is longer (a bottom-heavy shape is preferred), or holds only one or two words.',
    params: [
      { key: 'maxChars', label: 'Longest line', unit: 'chars', min: 5, max: 120, step: 1 },
      HALF_WIDTH_PARAM,
    ],
    defaults: { maxChars: 42, halfWidth: 1 },
    cue(info, { maxChars = 42, halfWidth = 1 }, emit) {
      if (info.lines.length !== 2) return;
      const [top, bottom] = info.lines as [string, string];
      const shortTop = wordCount(top) <= 2 && wordCount(bottom) > 2;
      if (displayLength(top, halfWidth) <= displayLength(bottom, halfWidth) && !shortTop) return;
      const fix = rewrapFix(info, maxChars, halfWidth);
      emit({
        index: info.index,
        message: shortTop
          ? 'Only one or two words on the top line.'
          : 'The top line is longer than the bottom one; prefer a bottom-heavy shape.',
        ...(fix ? { fix } : {}),
      });
    },
  },
  {
    id: 'single-line',
    category: 'layout',
    title: 'One line when it fits',
    description:
      'Text broken over two lines that would fit on one (dual-speaker cues, one speaker per line, are left alone).',
    params: [
      { key: 'maxChars', label: 'Longest line', unit: 'chars', min: 5, max: 120, step: 1 },
      HALF_WIDTH_PARAM,
    ],
    defaults: { maxChars: 42, halfWidth: 1 },
    cue(info, { maxChars = 42, halfWidth = 1 }, emit) {
      if (info.lines.length < 2 || info.lines.some((l) => /^\s*-/.test(l))) return;
      const joined = joinLines(info.lines);
      const length = displayLength(joined, halfWidth);
      if (length > maxChars) return;
      emit({
        index: info.index,
        message: `Fits on one line (${formatCount(length)} characters).`,
        ...(isPlain(info)
          ? { fix: { label: 'Join', change: { kind: 'text', text: joined } } }
          : {}),
      });
    },
  },
  {
    id: 'line-break-words',
    category: 'layout',
    title: 'Line breaks (English)',
    description:
      'A line ending in an article or preposition, which belongs with the words after it.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      info.lines.slice(0, -1).forEach((line, i) => {
        const last = /([\p{L}']+)\s*$/u.exec(line)?.[1]?.toLowerCase();
        if (last && BINDING_WORDS.has(last))
          emit({
            index: info.index,
            message: `Line ${i + 1} ends with “${last}”, which belongs with the next line.`,
          });
      });
    },
  },
  {
    id: 'centred',
    category: 'layout',
    title: 'Centred',
    description: 'A cue that is not centred horizontally.',
    params: [],
    defaults: {},
    cue({ cue, index }, _, emit) {
      if (cue.align === 'center' && cue.position === 'auto') return;
      emit({
        index,
        message: 'Not centred (align or position is set).',
        fix: { label: 'Centre', change: { kind: 'centre' } },
      });
    },
  },
  {
    id: 'ellipsis-character',
    category: 'text',
    title: 'Ellipsis character',
    description:
      'Three dots, or the midline ellipsis (⋯, U+22EF), where the ellipsis character (…, U+2026) is wanted.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const dots = text.includes('...');
      const midline = text.includes('⋯');
      if (!dots && !midline) return;
      emit({
        index: info.index,
        message: `${dots ? 'Three dots' : 'A midline ellipsis (⋯)'}; use the ellipsis character (…).`,
        fix: {
          label: 'Use …',
          change: { kind: 'text', text: info.cue.text.replace(/\.{3}|⋯/g, '…') },
        },
      });
    },
  },
  {
    id: 'double-space',
    category: 'text',
    title: 'Double spaces',
    description: 'Two or more spaces in a row.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (!/ {2}/.test(plain(info))) return;
      emit({
        index: info.index,
        message: 'Contains a double space.',
        fix: {
          label: 'Single spaces',
          change: { kind: 'text', text: info.cue.text.replace(/ {2,}/g, ' ') },
        },
      });
    },
  },
  {
    id: 'dash-characters',
    category: 'text',
    title: 'En and em dashes',
    description: 'An en dash (–) or em dash (—).',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (/[–—]/.test(plain(info)))
        emit({ index: info.index, message: 'Contains an en or em dash, which is not permitted.' });
    },
  },
  {
    id: 'speaker-hyphen',
    category: 'text',
    title: 'Speaker hyphens',
    description:
      'Dual-speaker hyphens followed by a space where the guide wants none, or with none where it wants one.',
    params: [
      { key: 'space', label: 'Spaces after the hyphen', unit: 'spaces', min: 0, max: 1, step: 1 },
    ],
    defaults: { space: 0 },
    cue(info, { space = 0 }, emit) {
      if (space > 0) {
        if (info.cue.text.split('\n').length < 2 || !info.lines.some((l) => /^-[^\s-]/.test(l)))
          return;
        emit({
          index: info.index,
          message: 'A speaker hyphen with no space after it.',
          fix: {
            label: 'Add a space',
            change: {
              kind: 'text',
              text: info.cue.text.replace(
                markupPattern(info.dialect, (T) => `^((?:${T})*)-(?=[^\\s-])`, 'gm'),
                '$1- ',
              ),
            },
          },
        });
        return;
      }
      if (!info.lines.some((l) => /^-[ \t]+\S/.test(l))) return;
      emit({
        index: info.index,
        message: 'A speaker hyphen followed by a space.',
        fix: {
          label: 'Remove the space',
          change: {
            kind: 'text',
            text: info.cue.text.replace(
              markupPattern(info.dialect, (T) => `^((?:${T})*)-[ \\t]+`, 'gm'),
              '$1-',
            ),
          },
        },
      });
    },
  },
  {
    id: 'okay-spelling',
    category: 'text',
    title: '“Okay”',
    description: '“OK” or “Ok” where the guide spells “okay”.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (!/\b(?:OK|Ok)\b/.test(plain(info))) return;
      const sentenceStart = markupPattern(
        info.dialect,
        (T) => `(?:^|[.!?]\\s+|\\n-?|^-)(?:${T})*$`,
      );
      const text = info.cue.text.replace(/\b(?:OK|Ok)\b/g, (_m, offset: number, all: string) =>
        sentenceStart.test(all.slice(0, offset)) ? 'Okay' : 'okay',
      );
      emit({
        index: info.index,
        message: '“OK” is spelled “okay”.',
        fix: { label: 'Use okay', change: { kind: 'text', text } },
      });
    },
  },
  {
    id: 'lowercase-labels',
    category: 'text',
    title: 'Lowercase labels',
    description: 'A speaker or sound label in brackets written in capitals.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      for (const m of plain(info).matchAll(/\[([^\]]+)\]/g)) {
        const label = m[1] as string;
        if ((label.match(/\p{L}/gu)?.length ?? 0) >= 2 && !/\p{Ll}/u.test(label)) {
          emit({
            index: info.index,
            message: `[${label}]: labels are lowercase, apart from proper nouns.`,
          });
          return;
        }
      }
    },
  },
  {
    id: 'lyrics-notes',
    category: 'text',
    title: 'Lyrics notes',
    description:
      'Song lyrics not enclosed in music notes (♪), with a space inside each (or none, as some guides want).',
    params: [
      { key: 'space', label: 'Spaces inside the notes', unit: 'spaces', min: 0, max: 1, step: 1 },
    ],
    defaults: { space: 1 },
    cue(info, { space = 1 }, emit) {
      const text = plain(info).trim();
      if (!text.includes('♪')) return;
      const gap = space > 0 ? ' ' : '';
      const open = new RegExp(`^♪${space > 0 ? ' ' : '(?! )'}`);
      const close = new RegExp(`${space > 0 ? ' ' : '(?<! )'}♪$`);
      if (open.test(text) && close.test(text)) return;
      emit({
        index: info.index,
        message: `Lyrics start with “♪${gap}” and end with “${gap}♪”.`,
      });
    },
  },
  {
    id: 'glyph-list',
    category: 'text',
    title: 'Netflix glyph list',
    description: 'Characters that are not in the Netflix Glyph List (version 2), such as emoji.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      if (/^[\n\x20-\x7e]*$/.test(text)) return; // Printable ASCII is all in the list.
      const bad: string[] = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0) as number;
        if (!inNetflixGlyphList(cp) && !bad.includes(ch)) bad.push(ch);
      }
      if (bad.length === 0) return;
      const shown = bad
        .slice(0, 6)
        .map(
          (c) =>
            `${/\p{C}|\p{Z}/u.test(c) ? '' : `${c} `}(U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')})`,
        )
        .join(', ');
      emit({
        index: info.index,
        message: `Not in the Netflix glyph list: ${shown}${bad.length > 6 ? ', …' : ''}.`,
      });
    },
  },
  {
    id: 'bbc-characters',
    category: 'text',
    title: 'Permitted characters (BBC)',
    description:
      'Characters outside the BBC’s list for subtitles (no accents, no curly quotes); online adds € ♫ ← →.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info);
      const bad = [...new Set([...text].filter((c) => !BBC_CHARACTERS.test(c)))];
      if (bad.length === 0) return;
      const mappable = bad.filter((c) => c in BBC_REPLACEMENTS);
      const shown = bad.slice(0, 6).join(' ');
      emit({
        index: info.index,
        message: `Not in the BBC’s character list: ${shown}${bad.length > 6 ? ' …' : ''}`,
        ...(mappable.length > 0 && isPlain(info)
          ? {
              fix: {
                label: 'Replace quotes and ellipses',
                change: {
                  kind: 'text',
                  text: [...info.cue.text].map((c) => BBC_REPLACEMENTS[c] ?? c).join(''),
                },
              },
            }
          : {}),
      });
    },
  },
  {
    id: 'bbc-colours',
    category: 'accessibility',
    title: 'Speaker colours (BBC)',
    description:
      'Text colours other than white, yellow, cyan and green, or a background that is not black.',
    params: [],
    defaults: {},
    document(doc, _, emit) {
      for (const { index, selector, decls } of cueRules(doc)) {
        const colourValue = decls.get('color');
        const colour = colourValue === undefined ? null : parseColour(colourValue);
        if (colour && !BBC_COLOURS.has(hexOf(colour)))
          emit({
            list: 'head',
            index,
            message: `${selector}: ${colourValue} is not a BBC speaker colour (white, yellow, cyan, green).`,
          });
        const background = backgroundOf(decls);
        if (background && background.a > 0 && hexOf(background) !== '#000000')
          emit({
            list: 'head',
            index,
            message: `${selector}: coloured backgrounds are no longer used; subtitles are on black.`,
          });
      }
    },
  },
  {
    id: 'contrast',
    category: 'accessibility',
    title: 'Contrast',
    description:
      'Text against its background below the contrast ratio, at worst over a black or white picture.',
    params: [{ key: 'min', label: 'Lowest ratio', unit: ':1', min: 1, max: 21, step: 0.5 }],
    defaults: { min: 4.5 },
    document(doc, { min = 4.5 }, emit) {
      const rules = cueRules(doc);
      const global = rules.filter((r) => /^(?:video)?::cue$/.test(r.selector));
      const globalValue = (pick: (d: Map<string, string>) => Rgba | null): Rgba | null => {
        let value: Rgba | null = null;
        for (const r of global) value = pick(r.decls) ?? value;
        return value;
      };
      const colourOf = (d: Map<string, string>): Rgba | null => {
        const v = d.get('color');
        return v === undefined ? null : parseColour(v);
      };
      const baseText = globalValue(colourOf) ?? WHITE;
      const baseBackground = globalValue(backgroundOf) ?? DEFAULT_BACKGROUND;
      for (const { index, selector, decls } of rules) {
        const text = colourOf(decls);
        const background = backgroundOf(decls);
        if (!text && !background) continue;
        const t = text ?? baseText;
        const b = background ?? baseBackground;
        let worst = Infinity;
        for (const picture of [BLACK, WHITE]) {
          const behind = composite(b, picture);
          worst = Math.min(worst, contrastRatio(composite(t, behind), behind));
        }
        if (worst < min)
          emit({
            list: 'head',
            index,
            message: `${selector}: text ${hexOf(t)} on ${hexOf(b)} has a contrast of ${worst.toFixed(1)}:1 at worst; at least ${min}:1 is needed.`,
          });
      }
    },
  },
];

export const RULES: Readonly<Record<QualityRuleId, RuleDefinition>> = Object.fromEntries(
  [...RULE_LIST, ...FINNISH_RULES, ...CJK_RULES].map((r) => [r.id, r]),
) as Record<QualityRuleId, RuleDefinition>;
