/**
 * Waveform peaks: audio reduced to the minimum and maximum sample of each 10 ms bin, across
 * channels, quantized to signed bytes. Peaks are computed as the decoded audio streams past, so
 * no decoded audio is kept; 12 hours are 4.3M bins (8.6 MB), which live in a `PeakStore` (OPFS
 * where available) while only a 1-per-second overview stays in memory.
 */

/** Fine bins per second. */
export const BINS_PER_SECOND = 100;
/** Fine bins per overview bin (one per second). */
export const OVERVIEW_FACTOR = 100;

const quantize = (v: number): number => Math.max(-128, Math.min(127, Math.round(v * 127)));

/** Where fine peaks are kept: pairs of (min, max) signed bytes, one pair per bin. */
export interface PeakStore {
  /** Writes `pairs` (2 bytes per bin) starting at bin `from`. */
  write(from: number, pairs: Int8Array): void;
  /** Reads bins [from, to) (missing bins read as silence). */
  read(from: number, to: number): Int8Array;
  close(): void;
}

/** A store in memory, for tests and where OPFS is not available. */
export class MemoryPeakStore implements PeakStore {
  private data = new Int8Array(0);

  write(from: number, pairs: Int8Array): void {
    const end = from * 2 + pairs.length;
    if (end > this.data.length) {
      const grown = new Int8Array(Math.max(end, this.data.length * 2));
      grown.set(this.data);
      this.data = grown;
    }
    this.data.set(pairs, from * 2);
  }

  read(from: number, to: number): Int8Array {
    const out = new Int8Array(Math.max(0, to - from) * 2);
    const avail = this.data.subarray(from * 2, Math.min(to * 2, this.data.length));
    out.set(avail);
    return out;
  }

  close(): void {
    this.data = new Int8Array(0);
  }
}

/**
 * Reduces streamed audio to peaks. Samples arrive in chunks with their start time; bins are
 * placed by time, so gaps (or a chunk that starts late) leave silent bins. Completed bins go to
 * the store in batches, and to an in-memory overview.
 */
export class PeakReducer {
  private readonly store: PeakStore;
  /** Bin currently being filled, and its running min/max. */
  private bin = 0;
  private min = Infinity;
  private max = -Infinity;
  private batch: number[] = [];
  private batchStart = 0;
  /** Overview pairs, grown as bins complete. */
  private overview = new Int8Array(0);
  /** Number of completed fine bins. */
  completed = 0;

  constructor(store: PeakStore) {
    this.store = store;
  }

  /**
   * Adds a chunk: per-channel samples (all the same length) at `sampleRate`, the first at
   * `startSeconds`.
   */
  push(channels: readonly Float32Array[], sampleRate: number, startSeconds: number): void {
    const frames = channels[0]?.length ?? 0;
    const binOf = (frame: number): number =>
      Math.floor((startSeconds + frame / sampleRate) * BINS_PER_SECOND);
    let frame = 0;
    while (frame < frames) {
      const b = Math.max(binOf(frame), this.bin);
      if (b > this.bin) this.advanceTo(b);
      // Frames up to the end of this bin.
      const binEndSeconds = (this.bin + 1) / BINS_PER_SECOND;
      const end = Math.min(frames, Math.ceil((binEndSeconds - startSeconds) * sampleRate));
      const last = Math.max(end, frame + 1);
      for (const ch of channels) {
        for (let i = frame; i < last; i++) {
          const v = ch[i] as number;
          if (v < this.min) this.min = v;
          if (v > this.max) this.max = v;
        }
      }
      frame = last;
    }
  }

  /** Closes the bin in progress (at the end of the audio) and writes everything out. */
  finish(): void {
    this.advanceTo(this.bin + 1);
    this.flush();
  }

  /** Overview pairs for completed seconds. */
  overviewPairs(): Int8Array {
    return this.overview.subarray(0, Math.ceil(this.completed / OVERVIEW_FACTOR) * 2);
  }

  private advanceTo(bin: number): void {
    // Close the current bin (silence if nothing landed in it), then silent bins up to `bin`.
    for (let b = this.bin; b < bin; b++) {
      const empty = b !== this.bin || this.min === Infinity;
      this.emit(empty ? 0 : quantize(this.min), empty ? 0 : quantize(this.max));
    }
    this.bin = bin;
    this.min = Infinity;
    this.max = -Infinity;
  }

  private emit(min: number, max: number): void {
    if (this.batch.length === 0) this.batchStart = this.completed;
    this.batch.push(min, max);
    const o = Math.floor(this.completed / OVERVIEW_FACTOR) * 2;
    if (o + 2 > this.overview.length) {
      const grown = new Int8Array(Math.max(o + 2, this.overview.length * 2, 64));
      grown.set(this.overview);
      this.overview = grown;
    }
    if (this.completed % OVERVIEW_FACTOR === 0) {
      this.overview[o] = min;
      this.overview[o + 1] = max;
    } else {
      this.overview[o] = Math.min(this.overview[o] as number, min);
      this.overview[o + 1] = Math.max(this.overview[o + 1] as number, max);
    }
    this.completed++;
    if (this.batch.length >= 2 * 4096) this.flush();
  }

  private flush(): void {
    if (this.batch.length === 0) return;
    this.store.write(this.batchStart, Int8Array.from(this.batch));
    this.batch = [];
  }
}

/** The loudest point in overview pairs (0–128). */
export function loudest(overview: Int8Array): number {
  let peak = 0;
  for (const v of overview) peak = Math.max(peak, Math.abs(v));
  return peak;
}

/**
 * Peaks for `columns` equal slices of [fromMs, toMs): min/max pairs. Wide slices (a second or
 * more) come from the overview; narrower ones from the fine bins in the store, reading only
 * the bins in range. Slices past `completedBins` read as silence.
 */
export function peaksForView(
  store: PeakStore,
  overview: Int8Array,
  completedBins: number,
  fromMs: number,
  toMs: number,
  columns: number,
): Int8Array {
  const out = new Int8Array(columns * 2);
  if (columns <= 0 || toMs <= fromMs) return out;
  const msPerColumn = (toMs - fromMs) / columns;
  const coarse = msPerColumn >= 1000;
  const binMs = coarse ? 1000 : 1000 / BINS_PER_SECOND;
  const available = coarse ? overview.length / 2 : completedBins;
  const firstBin = Math.max(0, Math.floor(fromMs / binMs));
  const lastBin = Math.min(available, Math.ceil(toMs / binMs));
  if (lastBin <= firstBin) return out;
  const pairs = coarse
    ? overview.subarray(firstBin * 2, lastBin * 2)
    : store.read(firstBin, lastBin);
  for (let c = 0; c < columns; c++) {
    const a = Math.max(firstBin, Math.floor((fromMs + c * msPerColumn) / binMs));
    const b = Math.min(
      lastBin,
      Math.max(a + 1, Math.ceil((fromMs + (c + 1) * msPerColumn) / binMs)),
    );
    let min = 0;
    let max = 0;
    for (let bin = a; bin < b; bin++) {
      const i = (bin - firstBin) * 2;
      min = Math.min(min, pairs[i] as number);
      max = Math.max(max, pairs[i + 1] as number);
    }
    out[c * 2] = min;
    out[c * 2 + 1] = max;
  }
  return out;
}
