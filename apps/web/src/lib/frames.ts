/**
 * Video frames: stepping the playhead one frame at a time, at the media's frame rate (measured
 * from the file by the waveform worker, or chosen by the user). Times are whole milliseconds, so
 * a frame's start is rounded up: seeking there shows that frame, not the one before it.
 */

/** Common frame rates; the NTSC ones are exact (24000/1001 and so on). */
export const FRAME_RATES: readonly { fps: number; label: string }[] = [
  { fps: 24_000 / 1001, label: '23.976' },
  { fps: 24, label: '24' },
  { fps: 25, label: '25' },
  { fps: 30_000 / 1001, label: '29.97' },
  { fps: 30, label: '30' },
  { fps: 48, label: '48' },
  { fps: 50, label: '50' },
  { fps: 60_000 / 1001, label: '59.94' },
  { fps: 60, label: '60' },
];

/**
 * A measured rate as the common rate it is within 0.5% of, or as measured (to three places).
 * Container timing is rarely exact, so 29.969 is reported as 29.97.
 */
export function standardRate(measured: number): number | null {
  if (!Number.isFinite(measured) || measured <= 0) return null;
  const near = FRAME_RATES.find((r) => Math.abs(measured - r.fps) / r.fps < 0.005);
  return near ? near.fps : Math.round(measured * 1000) / 1000;
}

/** "29.97", "25" or "12.5" for a rate. */
export function rateLabel(fps: number): string {
  return FRAME_RATES.find((r) => r.fps === fps)?.label ?? String(Math.round(fps * 1000) / 1000);
}

/** The frame shown at `ms`. */
export const frameAt = (ms: number, fps: number): number => Math.floor((ms * fps) / 1000 + 1e-6);

/** The first whole millisecond of frame `frame`. */
export const frameStartMs = (frame: number, fps: number): number =>
  frame <= 0 ? 0 : Math.ceil((frame * 1000) / fps - 1e-6);

/** The start of the frame `delta` frames from the one at `ms` (never before 0). */
export function stepFrame(ms: number, fps: number, delta: number): number {
  return frameStartMs(Math.max(0, frameAt(ms, fps) + delta), fps);
}
