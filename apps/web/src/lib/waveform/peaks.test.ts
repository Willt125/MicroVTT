import { describe, expect, it } from 'vitest';
import {
  BINS_PER_SECOND,
  MemoryPeakStore,
  OVERVIEW_FACTOR,
  PeakReducer,
  peaksForView,
} from './peaks.ts';

const RATE = 8000;

/** A tone whose amplitude is `level(t)` (in seconds), as one channel. */
function tone(seconds: number, level: (t: number) => number, from = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) {
    const t = from + i / RATE;
    out[i] = level(t) * Math.sin(2 * Math.PI * 440 * t);
  }
  return out;
}

function reduce(chunks: { start: number; channels: Float32Array[] }[]) {
  const store = new MemoryPeakStore();
  const reducer = new PeakReducer(store);
  for (const c of chunks) reducer.push(c.channels, RATE, c.start);
  reducer.finish();
  return { store, reducer };
}

describe('PeakReducer', () => {
  it('gives each 10 ms bin the min and max of its samples', () => {
    const { store, reducer } = reduce([{ start: 0, channels: [tone(1, () => 0.5)] }]);
    expect(reducer.completed).toBe(BINS_PER_SECOND);
    const pairs = store.read(0, reducer.completed);
    for (let b = 0; b < reducer.completed; b++) {
      expect(pairs[b * 2]).toBeLessThanOrEqual(-60);
      expect(pairs[b * 2 + 1]).toBeGreaterThanOrEqual(60);
      expect(pairs[b * 2 + 1]).toBeLessThanOrEqual(64);
    }
  });

  it('does not depend on how the audio is chunked', () => {
    const whole = tone(2, (t) => t / 2);
    const one = reduce([{ start: 0, channels: [whole] }]);
    const pieces = [];
    for (let i = 0; i < whole.length; i += 333) {
      pieces.push({ start: i / RATE, channels: [whole.slice(i, i + 333)] });
    }
    const many = reduce(pieces);
    expect(many.reducer.completed).toBe(one.reducer.completed);
    expect(many.store.read(0, 200)).toEqual(one.store.read(0, 200));
  });

  it('takes the loudest channel and leaves gaps silent', () => {
    const quiet = tone(0.5, () => 0.1);
    const loud = tone(0.5, () => 0.9);
    const { store, reducer } = reduce([
      { start: 0, channels: [quiet, loud] },
      { start: 1.5, channels: [loud, quiet] },
    ]);
    expect(reducer.completed).toBe(200);
    const pairs = store.read(0, 200);
    expect(pairs[2 * 10 + 1]).toBeGreaterThan(100); // in the first chunk
    expect([pairs[2 * 100], pairs[2 * 100 + 1]]).toEqual([0, 0]); // the gap
    expect(pairs[2 * 160 + 1]).toBeGreaterThan(100); // in the second chunk
  });

  it('keeps a per-second overview of the fine bins', () => {
    const { store, reducer } = reduce([
      { start: 0, channels: [tone(3, (t) => (t < 1 ? 0.2 : 0.8))] },
    ]);
    const overview = reducer.overviewPairs();
    expect(overview.length).toBe(6);
    const fine = store.read(0, OVERVIEW_FACTOR);
    expect(overview[1]).toBe(Math.max(...fine.filter((_, i) => i % 2 === 1)));
    expect(overview[3]).toBeGreaterThan(overview[1] as number);
  });
});

describe('peaksForView', () => {
  const { store, reducer } = reduce([{ start: 0, channels: [tone(10, (t) => t / 10)] }]);
  const overview = reducer.overviewPairs();

  it('reads fine bins for close views and the overview for wide ones', () => {
    const close = peaksForView(store, overview, reducer.completed, 5000, 5100, 10);
    expect(close.length).toBe(20);
    expect(close[1]).toBeGreaterThan(55); // about 0.5 × 127
    expect(close[1]).toBeLessThan(70);
    const wide = peaksForView(store, overview, reducer.completed, 0, 10_000, 5);
    expect(wide[1]).toBeLessThan(wide[9] as number); // louder towards the end
  });

  it('reads past the decoded part as silence', () => {
    const view = peaksForView(store, overview, reducer.completed, 9000, 20_000, 11);
    expect(view[1]).toBeGreaterThan(0);
    expect([...view.subarray(4)].every((v) => v === 0)).toBe(true);
  });
});
