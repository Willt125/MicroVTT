import { describe, expect, it } from 'vitest';
import { frameAt, frameStartMs, rateLabel, standardRate, stepFrame } from './frames.ts';

const NTSC = 30_000 / 1001;

describe('frames', () => {
  it('recognizes common rates from measurements', () => {
    expect(standardRate(29.969)).toBe(NTSC);
    expect(standardRate(25.02)).toBe(25);
    expect(standardRate(12.5)).toBe(12.5);
    expect(standardRate(0)).toBeNull();
    expect(standardRate(Number.NaN)).toBeNull();
    expect(rateLabel(NTSC)).toBe('29.97');
    expect(rateLabel(12.5)).toBe('12.5');
  });

  it('starts frames on the first whole millisecond inside them', () => {
    expect(frameStartMs(1, NTSC)).toBe(34); // 33.367 ms
    expect(frameAt(34, NTSC)).toBe(1);
    expect(frameAt(33, NTSC)).toBe(0);
    expect(frameStartMs(3, 25)).toBe(120);
    expect(frameAt(120, 25)).toBe(3);
  });

  it('steps forward and back by whole frames, never before 0', () => {
    expect(stepFrame(0, 25, 1)).toBe(40);
    expect(stepFrame(40, 25, 1)).toBe(80);
    expect(stepFrame(55, 25, 1)).toBe(80);
    expect(stepFrame(55, 25, -1)).toBe(0);
    expect(stepFrame(10, 25, -1)).toBe(0);
    // Many steps land on exact frame starts, without drift.
    let ms = 0;
    for (let i = 0; i < 1000; i++) ms = stepFrame(ms, NTSC, 1);
    expect(ms).toBe(frameStartMs(1000, NTSC));
    for (let i = 0; i < 1000; i++) ms = stepFrame(ms, NTSC, -1);
    expect(ms).toBe(0);
  });
});
