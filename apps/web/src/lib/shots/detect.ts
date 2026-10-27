/**
 * Finding cuts in a video from its frames, after PySceneDetect's adaptive detector: each frame
 * is scored by how much its hue, saturation and brightness differ from the previous frame's,
 * and a frame is a cut when its score is high on its own and well above the scores of the
 * frames around it. Comparing with the neighbours keeps fast motion and camera moves, which
 * change every frame a lot, from counting as cuts. Fades and dissolves are not found: they are
 * not cuts in the sense subtitle timing means.
 *
 * Frames are small RGBA images (a frame shrunk to about 128 pixels wide is plenty).
 */

export interface DetectorOptions {
  /** How far above its neighbours' average a frame's score must be. Lower finds more cuts. */
  threshold?: number;
  /** The least score a cut can have, on the 0–255 scale of the differences. */
  minScore?: number;
  /** Frames on each side a score is compared with. */
  window?: number;
  /** The fewest frames between two cuts. */
  minFrames?: number;
}

export const DEFAULT_DETECTOR: Required<DetectorOptions> = {
  threshold: 3,
  minScore: 15,
  window: 2,
  minFrames: 15,
};

/** Hue (0–180, as OpenCV has it), saturation and value (0–255) of each pixel. */
export function hsvPlanes(rgba: ArrayLike<number>, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const r = rgba[i * 4] as number;
    const g = rgba[i * 4 + 1] as number;
    const b = rgba[i * 4 + 2] as number;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta > 0) {
      if (max === r) h = (60 * (g - b)) / delta;
      else if (max === g) h = 120 + (60 * (b - r)) / delta;
      else h = 240 + (60 * (r - g)) / delta;
      if (h < 0) h += 360;
    }
    out[i * 3] = Math.round(h / 2) % 180;
    out[i * 3 + 1] = max === 0 ? 0 : Math.round((255 * delta) / max);
    out[i * 3 + 2] = max;
  }
  return out;
}

/** The mean difference of two frames' hue, saturation and value, averaged (0–255). */
export function frameScore(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
  return sum / a.length;
}

/**
 * Takes frames in order and reports cuts. A cut is known only once `window` more frames have
 * arrived, so `push` returns the cuts confirmed by each frame, and `finish` the last ones.
 */
export class CutDetector {
  private readonly options: Required<DetectorOptions>;
  private previous: Uint8Array | null = null;
  /** Recent frames' times and scores: up to `window` decided ones, then those to decide. */
  private readonly recent: { ms: number; score: number }[] = [];
  /** The index in `recent` of the next frame to decide. */
  private next = 0;
  /** The frame number of `recent[0]` (frame 0 has no score, so it is never in `recent`). */
  private first = 1;
  private lastCut = -Infinity;

  constructor(options: DetectorOptions = {}) {
    this.options = { ...DEFAULT_DETECTOR, ...options };
  }

  /** Adds a frame shown from `ms`; returns the times of cuts this confirms. */
  push(ms: number, rgba: ArrayLike<number>, pixels: number): number[] {
    const hsv = hsvPlanes(rgba, pixels);
    if (this.previous) this.recent.push({ ms, score: frameScore(this.previous, hsv) });
    this.previous = hsv;
    return this.decide(false);
  }

  /** The cuts among the last frames, once there are no more. */
  finish(): number[] {
    return this.decide(true);
  }

  private decide(final: boolean): number[] {
    const { threshold, minScore, window, minFrames } = this.options;
    const cuts: number[] = [];
    // A frame is decided once `window` frames follow it (at the end, with those there are).
    while (
      this.next < this.recent.length &&
      (final || this.recent.length - 1 - this.next >= window)
    ) {
      const c = this.next;
      const current = this.recent[c] as { ms: number; score: number };
      let total = 0;
      let count = 0;
      for (
        let j = Math.max(0, c - window);
        j <= Math.min(this.recent.length - 1, c + window);
        j++
      ) {
        if (j === c) continue;
        total += (this.recent[j] as { score: number }).score;
        count++;
      }
      const average = count > 0 ? total / count : 0;
      const ratio =
        average > 1e-5 ? current.score / average : current.score >= minScore ? Infinity : 0;
      const frame = this.first + c;
      if (ratio >= threshold && current.score >= minScore && frame - this.lastCut >= minFrames) {
        cuts.push(current.ms);
        this.lastCut = frame;
      }
      this.next++;
      const drop = Math.max(0, this.next - window);
      this.recent.splice(0, drop);
      this.next -= drop;
      this.first += drop;
    }
    return cuts;
  }
}
