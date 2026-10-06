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

/** Elements that can be open across a split point (the cue text parser's element names). */
const ELEMENTS = new Set(['c', 'i', 'b', 'u', 'ruby', 'rt', 'v', 'lang']);

interface OpenTag {
  name: string;
  /** The start tag as written, e.g. `<v.loud Bob>`. */
  tag: string;
  at: number;
}

/**
 * Finds where raw cue text can be divided near `offset`: never inside a tag or a character
 * reference, and never just inside an element's start or end tag. Returns the adjusted offset and
 * the elements open there, outermost first.
 */
function splitPoint(text: string, offset: number): { at: number; open: OpenTag[] } {
  let at = Math.max(0, Math.min(text.length, offset));
  // Not inside a character reference ("&amp;" split as "&am" + "p;").
  const amp = text.lastIndexOf('&', at - 1);
  if (amp !== -1 && /^&[#0-9A-Za-z]*$/.test(text.slice(amp, at))) at = amp;
  const open: OpenTag[] = [];
  let pos = 0;
  while (pos < at) {
    const lt = text.indexOf('<', pos);
    if (lt === -1 || lt >= at) break;
    const gt = text.indexOf('>', lt + 1);
    const end = gt === -1 ? text.length : gt + 1;
    if (at < end) {
      at = lt; // Inside a tag: split before it.
      break;
    }
    const inner = text.slice(lt + 1, gt === -1 ? text.length : gt);
    if (inner.startsWith('/')) {
      const name = inner.slice(1).trim();
      if (open.at(-1)?.name === name) open.pop();
      else if (name === 'ruby' && open.at(-1)?.name === 'rt' && open.at(-2)?.name === 'ruby')
        open.splice(-2);
    } else {
      const name = /^[^\s./>]*/.exec(inner)?.[0] ?? '';
      if (ELEMENTS.has(name)) open.push({ name, tag: text.slice(lt, end), at: lt });
    }
    pos = end;
  }
  for (;;) {
    const top = open.at(-1);
    if (top && top.at + top.tag.length === at) {
      // Right after a start tag: the element belongs wholly to the second cue.
      at = top.at;
      open.pop();
      continue;
    }
    const close = top && new RegExp(`^</${top.name}\\s*>`).exec(text.slice(at));
    if (top && close) {
      // Right before an end tag: the element belongs wholly to the first cue.
      at += close[0].length;
      open.pop();
      continue;
    }
    return { at, open };
  }
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
): VttDocument {
  const cue = doc.body[bodyIndex];
  if (cue?.type !== 'cue') throw new RangeError(`No cue at body index ${bodyIndex}`);
  if (!(atMs > cue.startMs && atMs < cue.endMs))
    throw new RangeError('Split time must be inside the cue');
  const { at, open } = splitPoint(cue.text, textOffset);
  const closers = open
    .map((t) => `</${t.name}>`)
    .reverse()
    .join('');
  const before = cue.text.slice(0, at).replace(/[ \t\n]+$/, '') + closers;
  const after = open.map((t) => t.tag).join('') + cue.text.slice(at).replace(/^[ \t\n]+/, '');
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
