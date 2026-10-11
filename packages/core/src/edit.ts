/**
 * Editing operations. All are pure: they return a new document and leave the input unchanged.
 *
 * Operations that move times also move the timestamp tags inside cue text (word timings), so
 * karaoke-style and auto-caption cues stay in sync. Operations that read or change cue text take
 * the format's text dialect (WebVTT by default).
 */
import type {
  AlignSetting,
  DirectionSetting,
  LineAlignSetting,
  PositionAlignSetting,
} from './parser.ts';
import type { BodyItem, Cue, VttDocument } from './document.ts';
import type { TextDialect } from './format/dialect.ts';
import { WEBVTT_TEXT } from './format/webvtt-text.ts';

export { mapTextTimestamps } from './format/webvtt-text.ts';

type CueFilter = (cue: Cue, bodyIndex: number) => boolean;

function mapCues(
  doc: VttDocument,
  fn: (cue: Cue, index: number) => Cue,
  filter?: CueFilter,
): VttDocument {
  const body = doc.body.map((item, i) =>
    item.type === 'cue' && (!filter || filter(item, i)) ? fn(item, i) : item,
  );
  return { ...doc, body };
}

const toTime = (ms: number): number => Math.max(0, Math.round(ms));

/** Applies `map` to the times of cues (all, or those matching `filter`), word timings included. */
function retimeCues(
  doc: VttDocument,
  map: (ms: number) => number,
  filter: CueFilter | undefined,
  dialect: TextDialect,
): VttDocument {
  return mapCues(
    doc,
    (cue) => ({
      ...cue,
      startMs: toTime(map(cue.startMs)),
      endMs: toTime(map(cue.endMs)),
      text: dialect.mapTimestamps(cue.text, map),
    }),
    filter,
  );
}

/** Moves cues (all, or those matching `filter`) by `deltaMs`, clamping at zero. */
export function shiftCues(
  doc: VttDocument,
  deltaMs: number,
  filter?: CueFilter,
  dialect: TextDialect = WEBVTT_TEXT,
): VttDocument {
  return retimeCues(doc, (ms) => ms + deltaMs, filter, dialect);
}

/**
 * Rescales times around `anchorMs`: t' = anchor + (t - anchor) × factor. Two-point resync is
 * `scaleCues` then `shiftCues` (see `resyncCues`).
 */
export function scaleCues(
  doc: VttDocument,
  factor: number,
  anchorMs = 0,
  filter?: CueFilter,
  dialect: TextDialect = WEBVTT_TEXT,
): VttDocument {
  if (!Number.isFinite(factor) || factor <= 0)
    throw new RangeError(`Invalid scale factor: ${factor}`);
  return retimeCues(doc, (ms) => anchorMs + (ms - anchorMs) * factor, filter, dialect);
}

/** A correction for resync: what is at `fromMs` now should be at `toMs`. */
export interface SyncPoint {
  fromMs: number;
  toMs: number;
}

/**
 * The linear map through two sync points (t' = a.to + (t - a.from) × factor), as used by
 * `resyncCues`. Throws a RangeError when the points are at the same time or would run time
 * backwards.
 */
export function syncMap(
  a: SyncPoint,
  b: SyncPoint,
): { factor: number; map: (ms: number) => number } {
  if (a.fromMs === b.fromMs) throw new RangeError('The two sync points must be at different times');
  const factor = (b.toMs - a.toMs) / (b.fromMs - a.fromMs);
  if (!Number.isFinite(factor) || factor <= 0)
    throw new RangeError('The sync points must keep their order (the later one stays later)');
  return { factor, map: (ms) => a.toMs + (ms - a.fromMs) * factor };
}

/**
 * Two-point resync: moves and stretches cues (all, or those matching `filter`) so that time
 * `a.fromMs` lands on `a.toMs` and `b.fromMs` on `b.toMs`, everything else in proportion. Fixes
 * subtitles timed for another cut or frame rate. Word timings move with their cues.
 */
export function resyncCues(
  doc: VttDocument,
  a: SyncPoint,
  b: SyncPoint,
  filter?: CueFilter,
  dialect: TextDialect = WEBVTT_TEXT,
): VttDocument {
  return retimeCues(doc, syncMap(a, b).map, filter, dialect);
}

/**
 * Splits the cue at `bodyIndex` into two at `atMs`, dividing its raw text at `textOffset`.
 * The offset moves out of any tag or character reference it falls in; elements open at the
 * split are closed in the first cue and reopened in the second, so `<i>a|b</i>` becomes
 * `<i>a</i>` and `<i>b</i>`; whitespace at the split is dropped. Word timestamps that would
 * fall outside their new cue are removed.
 * The second cue gets no id.
 */
export function splitCue(
  doc: VttDocument,
  bodyIndex: number,
  atMs: number,
  textOffset: number,
  dialect: TextDialect = WEBVTT_TEXT,
): VttDocument {
  const cue = doc.body[bodyIndex];
  if (cue?.type !== 'cue') throw new RangeError(`No cue at body index ${bodyIndex}`);
  if (!(atMs > cue.startMs && atMs < cue.endMs))
    throw new RangeError('Split time must be inside the cue');
  const [before, after] = dialect.splitText(cue.text, textOffset);
  const first: Cue = {
    ...cue,
    endMs: atMs,
    text: dialect.mapTimestamps(before, (ms) => (ms < atMs ? ms : null)),
  };
  const second: Cue = {
    ...cue,
    id: '',
    startMs: atMs,
    text: dialect.mapTimestamps(after, (ms) => (ms > atMs ? ms : null)),
  };
  delete first.source;
  delete second.source;
  const body = [...doc.body.slice(0, bodyIndex), first, second, ...doc.body.slice(bodyIndex + 1)];
  return { ...doc, body };
}

/**
 * Merges consecutive cues (body indices `from`..`to`, inclusive; notes between them are kept
 * after the merged cue). Settings and id come from the first cue. Each later cue's start time is
 * kept as a timestamp tag at the join, so word timing survives the merge.
 */
export function mergeCues(
  doc: VttDocument,
  from: number,
  to: number,
  dialect: TextDialect = WEBVTT_TEXT,
): VttDocument {
  const items = doc.body.slice(from, to + 1);
  const cues = items.filter((i): i is Cue => i.type === 'cue');
  const notes = items.filter((i) => i.type === 'note');
  const [head] = cues;
  if (!head || cues.length < 2) throw new RangeError('Need at least two cues to merge');
  const startMs = Math.min(...cues.map((c) => c.startMs));
  const endMs = Math.max(...cues.map((c) => c.endMs));
  let text = head.text;
  for (const cue of cues.slice(1)) {
    const join =
      cue.startMs > startMs && cue.startMs < endMs ? dialect.timestampMarkup(cue.startMs) : '';
    text += `\n${join}${cue.text}`;
  }
  const merged: Cue = { ...head, startMs, endMs, text };
  delete merged.source;
  const body: BodyItem[] = [
    ...doc.body.slice(0, from),
    merged,
    ...notes,
    ...doc.body.slice(to + 1),
  ];
  return { ...doc, body };
}

/** Sorts cues by start time (stable); each note stays attached to the cue after it. */
export function sortCues(doc: VttDocument): VttDocument {
  return sortCuesMapped(doc).document;
}

/**
 * `sortCues`, also returning where each item went: `moved[i]` is the new body index of the item
 * at body index `i` (for keeping a selection across the sort). The document is returned as it
 * is when it is already in order.
 */
export function sortCuesMapped(doc: VttDocument): { document: VttDocument; moved: number[] } {
  const units: number[][] = [];
  let pending: number[] = [];
  doc.body.forEach((item, i) => {
    pending.push(i);
    if (item.type === 'cue') {
      units.push(pending);
      pending = [];
    }
  });
  const startOf = (unit: number[]): number =>
    (doc.body[unit[unit.length - 1] as number] as Cue).startMs;
  const sorted = [...units].sort((a, b) => startOf(a) - startOf(b));
  const order = [...sorted.flat(), ...pending];
  const moved = new Array<number>(order.length);
  order.forEach((from, to) => (moved[from] = to));
  if (order.every((from, to) => from === to)) return { document: doc, moved };
  return { document: { ...doc, body: order.map((i) => doc.body[i] as BodyItem) }, moved };
}

/** Sets every cue id to `format(n)` for n = 1, 2, … in body order. */
export function renumberCues(
  doc: VttDocument,
  format: (n: number) => string = String,
): VttDocument {
  let n = 0;
  return mapCues(doc, (cue) => ({ ...cue, id: format(++n) }));
}

export interface CueUpdate {
  id?: string;
  startMs?: number;
  endMs?: number;
  text?: string;
  region?: string | null;
  vertical?: DirectionSetting;
  snapToLines?: boolean;
  line?: number | 'auto';
  lineAlign?: LineAlignSetting;
  position?: number | 'auto';
  positionAlign?: PositionAlignSetting;
  size?: number;
  align?: AlignSetting;
}

/** Thrown where VTTCue would throw an IndexSizeError DOMException. */
export class IndexSizeError extends RangeError {
  override name = 'IndexSizeError';
}

const ENUMS: Partial<Record<keyof CueUpdate, readonly string[]>> = {
  vertical: ['', 'rl', 'lr'],
  lineAlign: ['start', 'center', 'end'],
  positionAlign: ['line-left', 'center', 'line-right', 'auto'],
  align: ['start', 'center', 'end', 'left', 'right'],
};

/**
 * Returns `cue` with `update` applied using VTTCue's attribute semantics (§9): enum values that
 * are not in the enumeration are ignored, `position` and `size` outside 0..100 throw
 * IndexSizeError, and `line` must be finite or "auto". Times are whole, non-negative ms.
 */
export function updateCue(cue: Cue, update: CueUpdate): Cue {
  const next: Cue = { ...cue };
  for (const [key, value] of Object.entries(update) as [keyof CueUpdate, unknown][]) {
    if (value === undefined) continue;
    const allowed = ENUMS[key];
    if (allowed) {
      if (allowed.includes(value as string))
        (next as unknown as Record<string, unknown>)[key] = value;
      continue;
    }
    switch (key) {
      case 'startMs':
      case 'endMs':
        if (!Number.isInteger(value) || (value as number) < 0)
          throw new TypeError(`${key} must be a whole number of ms ≥ 0`);
        next[key] = value as number;
        break;
      case 'line':
        if (value !== 'auto' && !Number.isFinite(value))
          throw new TypeError('line must be a finite number or "auto"');
        next.line = value as number | 'auto';
        break;
      case 'position':
        if (value !== 'auto' && !Number.isFinite(value))
          throw new TypeError('position must be a finite number or "auto"');
        if (value !== 'auto' && ((value as number) < 0 || (value as number) > 100))
          throw new IndexSizeError('position must be in 0..100');
        next.position = value as number | 'auto';
        break;
      case 'size':
        if (!Number.isFinite(value)) throw new TypeError('size must be a finite number');
        if ((value as number) < 0 || (value as number) > 100)
          throw new IndexSizeError('size must be in 0..100');
        next.size = value as number;
        break;
      case 'snapToLines':
        next.snapToLines = Boolean(value);
        break;
      case 'id':
      case 'text':
        next[key] = String(value);
        break;
      case 'region':
        next.region = value === null ? null : String(value);
        break;
    }
  }
  return next;
}
