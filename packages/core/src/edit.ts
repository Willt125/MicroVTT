/**
 * Editing operations. All are pure: they return a new document and leave the input unchanged.
 *
 * Operations that move times also move the timestamp tags inside cue text (word timings), so
 * karaoke-style and auto-caption cues stay in sync.
 */
import type {
  AlignSetting,
  DirectionSetting,
  LineAlignSetting,
  PositionAlignSetting,
} from './parser.ts';
import type { BodyItem, Cue, VttDocument } from './document.ts';
import { formatTimestamp, parseTimestamp } from './timestamp.ts';

/**
 * Calls `fn` for every timestamp tag in raw cue text and splices in its result (a new time in
 * ms, or null to remove the tag). Tags are found the way the cue text tokenizer finds them, so
 * text inside other tags' annotations is never touched.
 */
export function mapTextTimestamps(text: string, fn: (ms: number) => number | null): string {
  let out = '';
  let pos = 0;
  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) break;
    const gt = text.indexOf('>', lt + 1);
    const tagEnd = gt === -1 ? text.length : gt + 1;
    const inner = text.slice(lt + 1, gt === -1 ? text.length : gt);
    out += text.slice(pos, lt);
    const ts = /^[0-9]/.test(inner) ? parseTimestamp(inner) : null;
    if (ts?.ok && ts.end === inner.length) {
      const mapped = fn(ts.ms);
      if (mapped !== null) out += `<${formatTimestamp(Math.max(0, Math.round(mapped)))}>`;
    } else {
      out += text.slice(lt, tagEnd);
    }
    pos = tagEnd;
  }
  return out + text.slice(pos);
}

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

/** Moves cues (all, or those matching `filter`) by `deltaMs`, clamping at zero. */
export function shiftCues(doc: VttDocument, deltaMs: number, filter?: CueFilter): VttDocument {
  return mapCues(
    doc,
    (cue) => ({
      ...cue,
      startMs: toTime(cue.startMs + deltaMs),
      endMs: toTime(cue.endMs + deltaMs),
      text: mapTextTimestamps(cue.text, (ms) => ms + deltaMs),
    }),
    filter,
  );
}

/**
 * Rescales times around `anchorMs`: t' = anchor + (t - anchor) × factor. Two-point resync is
 * `scaleCues` then `shiftCues`.
 */
export function scaleCues(
  doc: VttDocument,
  factor: number,
  anchorMs = 0,
  filter?: CueFilter,
): VttDocument {
  if (!Number.isFinite(factor) || factor <= 0)
    throw new RangeError(`Invalid scale factor: ${factor}`);
  const map = (ms: number): number => anchorMs + (ms - anchorMs) * factor;
  return mapCues(
    doc,
    (cue) => ({
      ...cue,
      startMs: toTime(map(cue.startMs)),
      endMs: toTime(map(cue.endMs)),
      text: mapTextTimestamps(cue.text, map),
    }),
    filter,
  );
}

/**
 * Splits the cue at `bodyIndex` into two at `atMs`, dividing its raw text at `textOffset`.
 * Word timestamps that would fall outside their new cue are removed. The second cue gets no id.
 */
export function splitCue(
  doc: VttDocument,
  bodyIndex: number,
  atMs: number,
  textOffset: number,
): VttDocument {
  const cue = doc.body[bodyIndex];
  if (cue?.type !== 'cue') throw new RangeError(`No cue at body index ${bodyIndex}`);
  if (!(atMs > cue.startMs && atMs < cue.endMs))
    throw new RangeError('Split time must be inside the cue');
  const before = cue.text.slice(0, textOffset).replace(/\n+$/, '');
  const after = cue.text.slice(textOffset).replace(/^\n+/, '');
  const first: Cue = {
    ...cue,
    endMs: atMs,
    text: mapTextTimestamps(before, (ms) => (ms < atMs ? ms : null)),
  };
  const second: Cue = {
    ...cue,
    id: '',
    startMs: atMs,
    text: mapTextTimestamps(after, (ms) => (ms > atMs ? ms : null)),
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
export function mergeCues(doc: VttDocument, from: number, to: number): VttDocument {
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
      cue.startMs > startMs && cue.startMs < endMs ? `<${formatTimestamp(cue.startMs)}>` : '';
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
  const units: BodyItem[][] = [];
  let pending: BodyItem[] = [];
  for (const item of doc.body) {
    pending.push(item);
    if (item.type === 'cue') {
      units.push(pending);
      pending = [];
    }
  }
  const startOf = (unit: BodyItem[]): number => (unit[unit.length - 1] as Cue).startMs;
  const sorted = [...units].sort((a, b) => startOf(a) - startOf(b));
  return { ...doc, body: [...sorted.flat(), ...pending] };
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
