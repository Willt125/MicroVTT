/**
 * Shot changes: the times where the picture cuts to a new shot, which subtitle timing follows
 * (Netflix's timing guide, sections 2 and 4). They belong to the video, not to the caption
 * file, so they are kept as a plain list of times in milliseconds, sorted, each the first
 * frame of the new shot.
 *
 * Lists are read from the formats other tools write:
 * - Subtitle Edit's `.shotchanges` files: one time in seconds per line ("12.345");
 * - ffmpeg's scene detection, `-vf "select='gt(scene,0.3)',showinfo"`: the `pts_time:` of each
 *   line of the log (other lines are ignored);
 * - ffprobe's `pts_time=12.345` (default output) or `frame,12.345` (CSV) lines;
 * - timecodes, `01:02:03.456` or `01:02:03,456`, and `01:02:03:12` with frames (`;` before
 *   the frames for drop-frame), which need the frame rate;
 * - plain numbers, as seconds, milliseconds or frames.
 */

/** What plain numbers in a list mean. */
export type ShotChangeUnit = 'seconds' | 'milliseconds' | 'frames';

export interface ShotChangeList {
  /** The times, in ms, sorted and without duplicates. */
  times: number[];
  /** Lines with something on them that held no time (headers, log noise, typos). */
  skipped: number;
  /** Why some lines could not be read, when that needs the user to act (no frame rate). */
  problem?: string;
}

export interface ShotChangeReadOptions {
  /** What plain numbers mean; seconds by default (as Subtitle Edit writes them). */
  unit?: ShotChangeUnit;
  /** The video's frame rate: needed for frames and frame timecodes, and to snap to frames. */
  fps?: number | null;
}

const PTS_TIME = /pts_time[:=]\s*(-?\d+(?:\.\d+)?)/;
const NUMBER = /^(?:[a-z_]+,)?(-?\d+(?:[.,]\d+)?)$/i;
const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/;
const FRAME_CODE = /^(\d+):(\d{1,2}):(\d{1,2})([:;])(\d{1,3})$/;

/** The first whole millisecond of the frame nearest `ms`, at `fps`. */
export function snapToFrame(ms: number, fps: number): number {
  const frame = Math.max(0, Math.round((ms * fps) / 1000));
  return frame === 0 ? 0 : Math.ceil((frame * 1000) / fps - 1e-6);
}

/** Frames counted by a SMPTE timecode, drop-frame (for 29.97 and 59.94) when `drop`. */
function timecodeFrame(
  h: number,
  m: number,
  s: number,
  f: number,
  fps: number,
  drop: boolean,
): number {
  const nominal = Math.round(fps);
  let frame = (h * 3600 + m * 60 + s) * nominal + f;
  if (drop) {
    // Two frame numbers (four at 59.94) are skipped each minute, except every tenth minute.
    const dropped = nominal === 60 ? 4 : 2;
    const minutes = h * 60 + m;
    frame -= dropped * (minutes - Math.floor(minutes / 10));
  }
  return frame;
}

/** Reads a list of shot changes (see the formats above). */
export function parseShotChanges(
  text: string,
  options: ShotChangeReadOptions = {},
): ShotChangeList {
  const unit = options.unit ?? 'seconds';
  const fps = options.fps && options.fps > 0 ? options.fps : null;
  const lines = text
    .replace(/^\ufeff/, '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  const times: number[] = [];
  let skipped = 0;
  let needFps = 0;
  // An ffmpeg log is mostly other lines: only those with a time count, and the rest are not
  // reported as skipped.
  const log = lines.some((l) => PTS_TIME.test(l));
  for (const line of lines) {
    let ms: number | null = null;
    const pts = PTS_TIME.exec(line);
    if (pts) ms = Number(pts[1]) * 1000;
    else if (log) continue;
    let m: RegExpExecArray | null;
    if (ms === null && (m = CLOCK.exec(line))) {
      const [, h = '0', min = '0', s = '0', frac = '0'] = m;
      ms = (Number(h) * 3600 + Number(min) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, '0'));
    } else if (ms === null && (m = FRAME_CODE.exec(line))) {
      if (!fps) {
        needFps++;
        continue;
      }
      const [, h = '0', min = '0', s = '0', sep, f = '0'] = m;
      const frame = timecodeFrame(Number(h), Number(min), Number(s), Number(f), fps, sep === ';');
      ms = (frame * 1000) / fps;
    } else if (ms === null && (m = NUMBER.exec(line))) {
      const value = Number((m[1] as string).replace(',', '.'));
      if (unit === 'frames') {
        if (!fps) {
          needFps++;
          continue;
        }
        ms = (value * 1000) / fps;
      } else {
        ms = unit === 'seconds' ? value * 1000 : value;
      }
    }
    if (ms === null || !Number.isFinite(ms) || ms < 0) {
      skipped++;
      continue;
    }
    times.push(fps ? snapToFrame(ms, fps) : Math.round(ms));
  }
  return {
    times: normalizeShotChanges(times),
    skipped,
    ...(needFps > 0
      ? {
          problem: `${needFps} ${needFps === 1 ? 'time is' : 'times are'} in frames: choose the frame rate first.`,
        }
      : {}),
  };
}

/** Sorted, whole milliseconds, without duplicates. */
export function normalizeShotChanges(times: readonly number[]): number[] {
  const sorted = times.map((t) => Math.round(t)).sort((a, b) => a - b);
  return sorted.filter((t, i) => i === 0 || t !== sorted[i - 1]);
}

/** A list as Subtitle Edit writes it: seconds, one per line. */
export function formatShotChanges(times: readonly number[]): string {
  return times.map((t) => `${(t / 1000).toFixed(3)}\n`).join('');
}

/** The index of the first time at or after `ms` (times sorted). */
export function shotChangeIndex(times: readonly number[], ms: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The shot changes from `fromMs` to `toMs`, inclusive. */
export function shotChangesBetween(
  times: readonly number[],
  fromMs: number,
  toMs: number,
): number[] {
  const out: number[] = [];
  for (let i = shotChangeIndex(times, fromMs); i < times.length; i++) {
    const t = times[i] as number;
    if (t > toMs) break;
    out.push(t);
  }
  return out;
}

/**
 * Adds a shot change at `ms`, or removes the one within `toleranceMs` of it (marking the same
 * cut twice takes it off again).
 */
export function toggleShotChange(
  times: readonly number[],
  ms: number,
  toleranceMs: number,
): number[] {
  const near = shotChangesBetween(times, ms - toleranceMs, ms + toleranceMs);
  if (near.length > 0) return times.filter((t) => !near.includes(t));
  return normalizeShotChanges([...times, ms]);
}
