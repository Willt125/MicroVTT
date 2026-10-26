import { describe, expect, it } from 'vitest';
import { CutDetector, frameScore, hsvPlanes } from './detect.ts';

const W = 16;
const H = 9;
const PIXELS = W * H;

/** A frame of one colour, with a bright square at `x` (for motion). */
function frame(rgb: [number, number, number], x = 0, noise = 0, seed = 1): Uint8Array {
  const out = new Uint8Array(PIXELS * 4);
  let s = seed;
  for (let i = 0; i < PIXELS; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = noise ? (s % (2 * noise + 1)) - noise : 0;
    const px = i % W;
    const inSquare = px >= x && px < x + 4 && Math.floor(i / W) < 4;
    const [r, g, b] = inSquare ? [250, 250, 250] : rgb;
    out[i * 4] = Math.max(0, Math.min(255, r + n));
    out[i * 4 + 1] = Math.max(0, Math.min(255, g + n));
    out[i * 4 + 2] = Math.max(0, Math.min(255, b + n));
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A square moving back and forth, a pixel a frame. */
const bounce = (i: number): number => (i % 24 < 12 ? i % 24 : 23 - (i % 24));

/** Runs frames at 25 fps through a detector; returns the cut times. */
function detect(frames: Uint8Array[], options = {}): number[] {
  const d = new CutDetector(options);
  const cuts: number[] = [];
  frames.forEach((f, i) => cuts.push(...d.push(i * 40, f, PIXELS)));
  cuts.push(...d.finish());
  return cuts;
}

describe('shot detection', () => {
  it('converts to HSV as OpenCV does (hue halved)', () => {
    const hsv = hsvPlanes([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255], 3);
    expect([...hsv]).toEqual([0, 255, 255, 60, 255, 255, 0, 0, 0]);
    expect(frameScore(hsvPlanes([255, 0, 0, 255], 1), hsvPlanes([255, 0, 0, 255], 1))).toBe(0);
  });

  it('finds hard cuts between shots, at the first frame of the new shot', () => {
    const shots: [number, number, number][] = [
      [200, 40, 40],
      [40, 200, 60],
      [30, 40, 180],
    ];
    // Three shots of 30 frames, each with a moving square and a little grain.
    const frames = shots.flatMap((rgb, s) =>
      Array.from({ length: 30 }, (_, i) => frame(rgb, bounce(i), 4, s * 100 + i + 1)),
    );
    expect(detect(frames)).toEqual([1200, 2400]);
  });

  it('does not take motion or a slow fade for cuts', () => {
    const moving = Array.from({ length: 60 }, (_, i) => frame([90, 90, 90], bounce(i), 6, i + 1));
    expect(detect(moving)).toEqual([]);
    const fade = Array.from({ length: 50 }, (_, i) => {
      const v = Math.round(200 - i * 4);
      return frame([v, v / 2, v / 3], 0, 2, i + 1);
    });
    expect(detect(fade)).toEqual([]);
  });

  it('keeps cuts at least the minimum number of frames apart, and has a threshold', () => {
    // A flash: two cuts five frames apart; only the first counts with the default spacing.
    const frames = [
      ...Array.from({ length: 20 }, (_, i) => frame([20, 20, 20], 0, 3, i + 1)),
      ...Array.from({ length: 5 }, (_, i) => frame([240, 240, 240], 0, 3, i + 50)),
      ...Array.from({ length: 20 }, (_, i) => frame([20, 20, 20], 0, 3, i + 80)),
    ];
    expect(detect(frames)).toEqual([800]);
    expect(detect(frames, { minFrames: 3 })).toEqual([800, 1000]);
    // A small change is not a cut at the default minimum score.
    const subtle = [
      ...Array.from({ length: 20 }, (_, i) => frame([100, 100, 100], 0, 0, i + 1)),
      ...Array.from({ length: 20 }, (_, i) => frame([110, 110, 110], 0, 0, i + 1)),
    ];
    expect(detect(subtle)).toEqual([]);
  });

  it('finds a cut in the last frames', () => {
    const frames = [
      ...Array.from({ length: 20 }, (_, i) => frame([200, 40, 40], 0, 3, i + 1)),
      frame([30, 40, 180], 0, 3, 99),
    ];
    expect(detect(frames)).toEqual([800]);
  });
});
