/**
 * The rules. Each is generic and has numeric settings; rulesets (rulesets.ts) pick rules and
 * settings to match a guide. Lengths are counted in graphemes of the text a viewer reads
 * (measure.ts), so markup, character references and ruby annotations do not count.
 */
import type { Cue, VttDocument } from '../document.ts';
import { parseStylesheet } from '../css.ts';
import { composite, contrastRatio, hexOf, parseColour, type Rgba } from './colour.ts';
import { graphemeLength, wordCount } from './measure.ts';
import { NETFLIX_GLYPH_RANGES } from './netflix-glyphs.generated.ts';
import type { ParamSpec, QualityCategory, QualityFix, QualityRuleId } from './types.ts';

/** A cue as the rules see it. */
export interface CueInfo {
  cue: Cue;
  /** Body index. */
  index: number;
  /** The text a viewer reads, by line. */
  lines: string[];
  /** The next cue in the file, or null. */
  next: CueInfo | null;
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

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 2)} s`;
const duration = (c: Cue): number => c.endMs - c.startMs;
const plain = (info: CueInfo): string => info.lines.join('\n');
/** Cue text with no markup or references, where the raw text is what is read. */
const isPlain = (text: string): boolean => !/[<&]/.test(text);

/**
 * Lines for `words` in at most two lines of at most `max` characters; one line if the text
 * fits. Of the two-line splits that fit, a bottom-heavy one (the second line no shorter) is
 * preferred, then one without just one or two words on top, then the most even. Null when it
 * cannot fit.
 */
export function balanceLines(words: string[], max: number): string[] | null {
  const all = words.join(' ');
  if (graphemeLength(all) <= max) return [all];
  let best: string[] | null = null;
  let bestScore = Infinity;
  for (let k = 1; k < words.length; k++) {
    const top = words.slice(0, k).join(' ');
    const bottom = words.slice(k).join(' ');
    const [a, b] = [graphemeLength(top), graphemeLength(bottom)];
    if (a > max || b > max) continue;
    const score = Math.abs(a - b) + (a > b ? 1000 : 0) + (k <= 2 && words.length - k > 2 ? 500 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = [top, bottom];
    }
  }
  return best;
}

const rewrapFix = (info: CueInfo, max: number): QualityFix | undefined => {
  if (!isPlain(info.cue.text)) return undefined;
  const words = info.lines.join(' ').split(/\s+/).filter(Boolean);
  const lines = balanceLines(words, max);
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
    id: 'chars-per-second',
    category: 'reading-speed',
    title: 'Reading speed (characters)',
    description:
      'Characters per second, counting spaces and punctuation but not line breaks, against the cue’s duration.',
    params: [{ key: 'max', label: 'Fastest', unit: 'chars/s', min: 5, max: 60, step: 1 }],
    defaults: { max: 25 },
    cue(info, { max = Infinity }, emit) {
      const d = duration(info.cue);
      const chars = graphemeLength(info.lines.join(''));
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
    description: 'A line with more characters than the limit.',
    params: [{ key: 'max', label: 'Longest line', unit: 'chars', min: 10, max: 120, step: 1 }],
    defaults: { max: 42 },
    cue(info, { max = Infinity }, emit) {
      const long = info.lines
        .map((line, i) => [i + 1, graphemeLength(line)] as const)
        .filter(([, n]) => n > max);
      if (long.length === 0) return;
      const fix = rewrapFix(info, max);
      emit({
        index: info.index,
        message:
          long.map(([i, n]) => `Line ${i} has ${n} characters`).join('; ') +
          `; the limit is ${max}.`,
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
    params: [{ key: 'maxChars', label: 'Longest line', unit: 'chars', min: 10, max: 120, step: 1 }],
    defaults: { maxChars: 42 },
    cue(info, { maxChars = 42 }, emit) {
      if (info.lines.length !== 2) return;
      const [top, bottom] = info.lines as [string, string];
      const shortTop = wordCount(top) <= 2 && wordCount(bottom) > 2;
      if (graphemeLength(top) <= graphemeLength(bottom) && !shortTop) return;
      const fix = rewrapFix(info, maxChars);
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
    params: [{ key: 'maxChars', label: 'Longest line', unit: 'chars', min: 10, max: 120, step: 1 }],
    defaults: { maxChars: 42 },
    cue(info, { maxChars = 42 }, emit) {
      if (info.lines.length < 2 || info.lines.some((l) => /^\s*-/.test(l))) return;
      const joined = info.lines.map((l) => l.trim()).join(' ');
      if (graphemeLength(joined) > maxChars) return;
      emit({
        index: info.index,
        message: `Fits on one line (${graphemeLength(joined)} characters).`,
        ...(isPlain(info.cue.text)
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
    description: 'Three dots where the single ellipsis character (…) is wanted.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (!plain(info).includes('...')) return;
      emit({
        index: info.index,
        message: 'Three dots; use the ellipsis character (…).',
        fix: {
          label: 'Use …',
          change: { kind: 'text', text: info.cue.text.replace(/\.{3}/g, '…') },
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
    description: 'A line starting with a hyphen and a space; dual-speaker hyphens take no space.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      if (!info.lines.some((l) => /^-[ \t]+\S/.test(l))) return;
      emit({
        index: info.index,
        message: 'A speaker hyphen followed by a space.',
        fix: {
          label: 'Remove the space',
          change: {
            kind: 'text',
            text: info.cue.text.replace(/^((?:<[^>\n]*>)*)-[ \t]+/gm, '$1-'),
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
      const text = info.cue.text.replace(/\b(?:OK|Ok)\b/g, (_m, offset: number, all: string) =>
        /(?:^|[.!?]\s+|\n-?|^-)(?:<[^>]*>)*$/.test(all.slice(0, offset)) ? 'Okay' : 'okay',
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
    description: 'Song lyrics not enclosed in music notes (♪) with a space inside each.',
    params: [],
    defaults: {},
    cue(info, _, emit) {
      const text = plain(info).trim();
      if (!text.includes('♪')) return;
      if (text.startsWith('♪ ') && text.endsWith(' ♪')) return;
      emit({
        index: info.index,
        message: 'Lyrics start with “♪ ” and end with “ ♪”.',
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
        ...(mappable.length > 0 && isPlain(info.cue.text)
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
  RULE_LIST.map((r) => [r.id, r]),
) as Record<QualityRuleId, RuleDefinition>;
