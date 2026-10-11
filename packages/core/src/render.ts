/**
 * The arithmetic of WebVTT rendering (spec §7.2, "Processing cue settings", and the region steps
 * of §7.1): where a cue's box goes and how big it is, as percentages of the video's rendering
 * area, before any line boxes are laid out. Laying out text, snapping to lines and moving boxes
 * apart need a CSS engine and are done in the editor (apps/web/src/lib/render).
 */
import type { AlignSetting, PositionAlignSetting } from './parser.ts';
import type { Cue, Region } from './document.ts';

export type WritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
export type ComputedPositionAlign = Exclude<PositionAlignSetting, 'auto'>;
export type BaseDirection = 'ltr' | 'rtl';

/** Letters of scripts written right to left (Unicode bidi classes R and AL). */
const RTL_LETTER =
  /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Imperial_Aramaic}\p{Script=Phoenician}\p{Script=Mende_Kikakui}]/u;
const RLM = String.fromCharCode(0x200f);
const ALM = String.fromCharCode(0x061c);
const LRM = String.fromCharCode(0x200e);
/** Isolate initiators (LRI, RLI, FSI) and their terminator (PDI), skipped by rule P2. */
const ISOLATE_START = /[\u2066-\u2068]/;
const ISOLATE_END = String.fromCharCode(0x2069);

/**
 * The base direction of some text: its first strong directional character (Unicode Bidirectional
 * Algorithm rules P2 and P3, skipping isolated runs), left to right if there is none.
 */
export function baseDirection(text: string): BaseDirection {
  let depth = 0;
  for (const ch of text) {
    if (ISOLATE_START.test(ch)) depth++;
    else if (ch === ISOLATE_END) depth = Math.max(0, depth - 1);
    else if (depth > 0) continue;
    else if (ch === RLM || ch === ALM || RTL_LETTER.test(ch)) return 'rtl';
    else if (ch === LRM || /\p{L}/u.test(ch)) return 'ltr';
  }
  return 'ltr';
}

/** The text a cue shows, roughly: markup removed (for its base direction). */
const cueTextOf = (raw: string): string =>
  raw
    .replace(/<[^>]*>/g, '')
    .replace(/&lrm;/g, LRM)
    .replace(/&rlm;/g, RLM);

/**
 * The cue's computed line (§3.1). `trackIndex` counts the showing tracks before the cue's track,
 * for automatic lines: the first track's cues go on the last line, the second's above them.
 */
export function computedLine(cue: Pick<Cue, 'line' | 'snapToLines'>, trackIndex = 0): number {
  if (typeof cue.line === 'number') {
    if (!cue.snapToLines && (cue.line < 0 || cue.line > 100)) return 100;
    return cue.line;
  }
  if (!cue.snapToLines) return 100;
  return -(trackIndex + 1);
}

/** The cue's computed position (§3.1). */
export function computedPosition(cue: Pick<Cue, 'position' | 'align'>): number {
  if (typeof cue.position === 'number' && cue.position >= 0 && cue.position <= 100)
    return cue.position;
  if (cue.align === 'left') return 0;
  if (cue.align === 'right') return 100;
  return 50;
}

/** The cue's computed position alignment (§3.1). */
export function computedPositionAlign(
  cue: Pick<Cue, 'positionAlign' | 'align' | 'text'>,
): ComputedPositionAlign {
  if (cue.positionAlign !== 'auto') return cue.positionAlign;
  const ltr = (): boolean => baseDirection(cueTextOf(cue.text)) === 'ltr';
  switch (cue.align) {
    case 'left':
      return 'line-left';
    case 'right':
      return 'line-right';
    case 'start':
      return ltr() ? 'line-left' : 'line-right';
    case 'end':
      return ltr() ? 'line-right' : 'line-left';
    default:
      return 'center';
  }
}

export const TEXT_ALIGN: Record<AlignSetting, string> = {
  start: 'start',
  center: 'center',
  end: 'end',
  left: 'left',
  right: 'right',
};

/** A cue box before layout: percentages of the rendering area's width (x) and height (y). */
export interface CueBoxSettings {
  writingMode: WritingMode;
  /** The box's extent along the writing direction, in percent (of the width if horizontal). */
  size: number;
  /** Left edge, percent of the width. */
  x: number;
  /** Top edge, percent of the height. */
  y: number;
  /** The computed line, for snapping to lines (§7.2 "Adjust the positions of boxes"). */
  line: number;
  textAlign: string;
}

/** §7.2 "Processing cue settings", up to obtaining the CSS boxes. */
export function cueBoxSettings(cue: Cue, trackIndex = 0): CueBoxSettings {
  const writingMode: WritingMode =
    cue.vertical === 'rl' ? 'vertical-rl' : cue.vertical === 'lr' ? 'vertical-lr' : 'horizontal-tb';
  const position = computedPosition(cue);
  const align = computedPositionAlign(cue);
  const maximum =
    align === 'line-left'
      ? 100 - position
      : align === 'line-right'
        ? position
        : position <= 50
          ? position * 2
          : (100 - position) * 2;
  const size = cue.size < maximum ? cue.size : maximum;
  const start =
    align === 'line-left' ? position : align === 'center' ? position - size / 2 : position - size;
  const line = computedLine(cue, trackIndex);
  // Snapped cues start at 0 and are moved line by line afterwards.
  const across = cue.snapToLines ? 0 : line;
  const horizontal = writingMode === 'horizontal-tb';
  return {
    writingMode,
    size,
    x: horizontal ? start : across,
    y: horizontal ? across : start,
    line,
    textAlign: TEXT_ALIGN[cue.align],
  };
}

/** A region's box (§7.1): percentages of the rendering area's width (x) and height (y). */
export interface RegionBoxSettings {
  /** Width, percent of the rendering area's width. */
  width: number;
  /** Height for its lines (6% of the area's height per line). */
  height: number;
  left: number;
  top: number;
}

/** The height of one region line, percent of the rendering area's height. */
export const REGION_LINE_HEIGHT = 6;

export function regionBoxSettings(region: Region): RegionBoxSettings {
  const height = REGION_LINE_HEIGHT * region.lines;
  return {
    width: region.width,
    height,
    left: region.viewportAnchorX - (region.regionAnchorX * region.width) / 100,
    top: region.viewportAnchorY - (region.regionAnchorY * height) / 100,
  };
}

/**
 * The left offset of a cue inside its region (§7.1): its computed position as a percentage of
 * the region's width, moved by the position alignment. The spec then applies it as a percentage
 * (of the region box).
 */
export function cueInRegionLeft(cue: Cue, region: Region): number {
  let offset = (computedPosition(cue) * region.width) / 100;
  const align = computedPositionAlign(cue);
  if (align === 'center') offset -= region.width / 2;
  else if (align === 'line-right') offset -= region.width;
  return offset;
}

/**
 * Active cues in text track cue order: by start time, then the later end first, then file
 * order.
 */
export function activeCues(cues: readonly Cue[], timeMs: number): Cue[] {
  return cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => cue.startMs <= timeMs && timeMs < cue.endMs)
    .sort((a, b) => a.cue.startMs - b.cue.startMs || b.cue.endMs - a.cue.endMs || a.index - b.index)
    .map(({ cue }) => cue);
}
