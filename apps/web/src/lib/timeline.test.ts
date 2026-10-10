import { describe, expect, it } from 'vitest';
import { MIN_CUE_MS, nearest, resolveDrag } from './timeline.ts';

const cue = { startMs: 1000, endMs: 2000 };

describe('timeline drags', () => {
  it('finds the nearest target within reach', () => {
    expect(nearest(1000, [900, 1040, 1100], 50)).toBe(1040);
    expect(nearest(1000, [900, 1100], 50)).toBeNull();
    expect(nearest(1000, [], 50)).toBeNull();
  });

  it('snaps a dragged edge, and keeps cues at least the minimum length', () => {
    expect(resolveDrag('start', cue, cue, 120, [1150], 50)).toEqual({
      deltaMs: 150,
      snappedTo: 1150,
    });
    expect(resolveDrag('start', cue, cue, 120, [1300], 50)).toEqual({
      deltaMs: 120,
      snappedTo: null,
    });
    expect(resolveDrag('start', cue, cue, 5000, [], 50).deltaMs).toBe(1000 - MIN_CUE_MS);
    expect(resolveDrag('start', cue, cue, -5000, [], 50).deltaMs).toBe(-1000);
    expect(resolveDrag('end', cue, cue, -5000, [], 50).deltaMs).toBe(-1000 + MIN_CUE_MS);
    expect(resolveDrag('end', cue, cue, 500, [2480], 50)).toEqual({
      deltaMs: 480,
      snappedTo: 2480,
    });
  });

  it('moves whole cues, snapping whichever edge of the block is nearer', () => {
    const span = { startMs: 1000, endMs: 4000 };
    // The block's end lands 10 ms from 4510; its start is 490 ms from 1500.
    expect(resolveDrag('move', cue, span, 500, [1990, 4510], 50)).toEqual({
      deltaMs: 510,
      snappedTo: 4510,
    });
    expect(resolveDrag('move', cue, span, 500, [1520, 4560], 50)).toEqual({
      deltaMs: 520,
      snappedTo: 1520,
    });
    expect(resolveDrag('move', cue, span, -3000, [], 50).deltaMs).toBe(-1000);
  });
});
