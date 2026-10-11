/**
 * Roll-up captions from ordinary cues: each line of the cues becomes a roll-up line, shown from
 * when it is spoken until newer lines push it out. Two forms:
 *
 * - `region`: the WebVTT way (§6, regions): one-line cues overlapping in a `scroll:up` region
 *   `lines` lines high, which players that support regions slide up as each line arrives.
 * - `repeat`: the portable way (YouTube's auto-captions): cues that do not overlap, each showing
 *   the last `lines` lines. Every player shows it; nothing slides.
 *
 * A pause of `clearAfterMs` or more between cues clears the screen: the roll starts again.
 */
import {
  createRegion,
  type BodyItem,
  type Cue,
  type Region,
  type VttDocument,
} from './document.ts';
import { DEFAULT_CUE_SETTINGS } from './regions.ts';
import { textTimestamps, type TextDialect } from './format/dialect.ts';
import { WEBVTT_TEXT } from './format/webvtt-text.ts';

export type RollUpForm = 'region' | 'repeat';

export interface RollUpOptions {
  form: RollUpForm;
  /** Lines shown at once. */
  lines: number;
  /** A pause between cues at least this long clears the screen. */
  clearAfterMs: number;
}

export const DEFAULT_ROLL_UP: RollUpOptions = { form: 'region', lines: 3, clearAfterMs: 1000 };

/** One roll-up line: its raw text and when it starts. */
export interface RollUpLine {
  text: string;
  startMs: number;
  /** The end of the cue it came from. */
  cueEndMs: number;
  /** The cue it came from (body index). */
  source: number;
}

/** Offsets of the line breaks in raw text that are not inside a tag. */
function lineBreaks(text: string, dialect: TextDialect): number[] {
  const tag = new RegExp(dialect.tag, 'y');
  const out: number[] = [];
  for (let i = 0; i < text.length;) {
    tag.lastIndex = i;
    const m = tag.exec(text);
    if (m && m[0].length > 0) {
      i += m[0].length;
      continue;
    }
    if (text[i] === '\n') out.push(i);
    i++;
  }
  return out;
}

/** The cue's lines, each well formed (spans closed and reopened at the breaks), with start times. */
export function cueLines(
  cue: Cue,
  source: number,
  dialect: TextDialect = WEBVTT_TEXT,
): RollUpLine[] {
  const readable = dialect.readableLines(cue.text);
  const breaks = lineBreaks(cue.text, dialect);
  // Word timings and where they are, to time each line from the timing before its first word.
  const stamps = [...cue.text.matchAll(new RegExp(dialect.tag, 'g'))].flatMap((m) => {
    const [ms] = textTimestamps(dialect, m[0]);
    return ms === undefined ? [] : [{ at: m.index, ms }];
  });
  // Split at each break, left to right.
  const texts: string[] = [];
  const starts: number[] = [0];
  let rest = cue.text;
  let consumed = 0;
  for (const at of breaks) {
    const [first, second] = dialect.splitText(rest, at - consumed);
    texts.push(first);
    consumed += rest.length - second.length;
    rest = second;
    starts.push(at + 1);
  }
  texts.push(rest);

  const total = readable.reduce((n, l) => n + l.trim().length, 0);
  const span = cue.endMs - cue.startMs;
  let chars = 0;
  let previous = cue.startMs;
  const out: RollUpLine[] = [];
  texts.forEach((text, k) => {
    const length = (readable[k] ?? '').trim().length;
    let startMs = cue.startMs;
    if (k > 0) {
      const lineStart = starts[k] as number;
      // The timing before the line's first word (tags and spaces at its start included).
      const lead =
        new RegExp(`^(?:${dialect.tag}|[ \\t])*`).exec(cue.text.slice(lineStart))?.[0].length ?? 0;
      const firstWord = lineStart + lead;
      const before = stamps.filter((s) => s.at < firstWord).at(-1);
      if (before) startMs = before.ms;
      else if (stamps.length === 0 && total > 0)
        startMs = cue.startMs + Math.round((span * chars) / total);
    }
    chars += length;
    if (length === 0) return;
    startMs = Math.min(Math.max(startMs, previous), cue.endMs - 1);
    previous = startMs;
    out.push({ text, startMs, cueEndMs: cue.endMs, source });
  });
  return out;
}

const keepTimings = (dialect: TextDialect, text: string, startMs: number, endMs: number): string =>
  dialect.mapTimestamps(text, (ms) => (ms > startMs && ms < endMs ? ms : null));

/** An id for the roll-up region: "rollup", "rollup2", … */
function rollUpRegionId(doc: VttDocument): string {
  const ids = new Set(doc.head.flatMap((h) => (h.type === 'region' ? [h.id] : [])));
  let n = 1;
  while (ids.has(n === 1 ? 'rollup' : `rollup${n}`)) n++;
  return n === 1 ? 'rollup' : `rollup${n}`;
}

export interface RollUpResult {
  document: VttDocument;
  /** Roll-up lines made from the cues. */
  lines: number;
  /** Cues written. */
  cues: number;
  /** The region added for the `region` form. */
  region: string | null;
}

/**
 * Rewrites the cues at body indices `indices` (a run of cues with no other cue between them)
 * as roll-up captions, in their place; notes among them stay after the new cues.
 */
export function makeRollUp(
  doc: VttDocument,
  indices: readonly number[],
  options: Partial<RollUpOptions> = {},
  dialect: TextDialect = WEBVTT_TEXT,
): RollUpResult {
  const o = { ...DEFAULT_ROLL_UP, ...options };
  if (!Number.isInteger(o.lines) || o.lines < 1) throw new RangeError('Lines must be 1 or more.');
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) throw new RangeError('No cues to roll up.');
  for (let i = first; i <= last; i++) {
    const item = doc.body[i];
    if (item?.type === 'cue' && !sorted.includes(i))
      throw new RangeError('Select cues that follow each other, with no other cue between them.');
  }
  const cues = sorted.map((i) => doc.body[i]);
  if (cues.some((c) => c?.type !== 'cue')) throw new RangeError('Only cues can be rolled up.');

  const lines = sorted.flatMap((i) => cueLines(doc.body[i] as Cue, i, dialect));
  // Runs: a pause of clearAfterMs or more between cues clears the screen.
  const runs: RollUpLine[][] = [];
  for (const line of lines) {
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (
      run &&
      prev &&
      (prev.source === line.source || line.startMs - prev.cueEndMs < o.clearAfterMs)
    )
      run.push(line);
    else runs.push([line]);
  }

  const regionId = o.form === 'region' ? rollUpRegionId(doc) : null;
  const made: Cue[] = [];
  for (const run of runs) {
    const runEnd = Math.max(...run.map((l) => l.cueEndMs));
    run.forEach((line, i) => {
      const base = doc.body[line.source] as Cue;
      if (o.form === 'region') {
        const pushedOut = run[i + o.lines]?.startMs;
        const endMs = Math.max(pushedOut ?? runEnd, line.startMs + 1);
        const cue: Cue = {
          ...base,
          ...DEFAULT_CUE_SETTINGS,
          id: '',
          region: regionId,
          startMs: line.startMs,
          endMs,
          text: keepTimings(dialect, line.text, line.startMs, endMs),
        };
        delete cue.source;
        made.push(cue);
      } else {
        const next = run[i + 1]?.startMs;
        const endMs = next ?? runEnd;
        if (endMs <= line.startMs) return; // Shown with the next line, which starts with it.
        const shown = run.slice(Math.max(0, i - o.lines + 1), i + 1);
        const cue: Cue = {
          ...base,
          id: '',
          startMs: line.startMs,
          endMs,
          text: keepTimings(dialect, shown.map((l) => l.text).join('\n'), line.startMs, endMs),
        };
        delete cue.source;
        made.push(cue);
      }
    });
  }

  const notes =
    sorted.length > 0 ? doc.body.slice(first, last + 1).filter((i) => i.type !== 'cue') : [];
  const body: BodyItem[] = [
    ...doc.body.slice(0, first),
    ...made,
    ...notes,
    ...doc.body.slice(last + 1),
  ];
  let head = doc.head;
  if (regionId) {
    const region: Region = {
      ...createRegion(regionId),
      width: 80,
      lines: o.lines,
      regionAnchorX: 0,
      regionAnchorY: 100,
      viewportAnchorX: 10,
      viewportAnchorY: 90,
      scroll: 'up',
    };
    const lastRegion = head.reduce((at, h, i) => (h.type === 'region' ? i : at), -1);
    head = [...head];
    head.splice(lastRegion + 1, 0, region);
  }
  return {
    document: { ...doc, head, body },
    lines: lines.length,
    cues: made.length,
    region: regionId,
  };
}
