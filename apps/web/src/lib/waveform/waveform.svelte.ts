/**
 * The waveform of the loaded media, for the timeline. Peaks come from the waveform worker
 * (streamed WebCodecs decoding, cached in OPFS). Where the browser cannot stream-decode the
 * file, short media is decoded whole with `decodeAudioData` at a low sample rate instead; long
 * media then has no waveform, only the timeline.
 */
import type { WaveformMethod, WaveformRequest, WaveformResponse } from './protocol.ts';

/**
 * Longest media decoded whole by the fallback. `decodeAudioData` decodes at the codec's own rate
 * before resampling, so even at the 8 kHz asked for here it costs about 45 MB per minute of
 * stereo (23 MB mono) at its peak, measured in Chromium (see BENCHMARKS.md): 10 minutes is
 * about 450 MB at worst.
 */
export const FALLBACK_CAP_MS = 10 * 60_000;
/** Without a known duration, the largest file the fallback tries (10 minutes at 320 kbps). */
export const FALLBACK_CAP_BYTES = 25 * 1024 * 1024;
const FALLBACK_RATE = 8000;

export interface PeakRange {
  /** Min/max pairs, signed bytes (±128 is full scale). */
  peaks: Int8Array;
  /** The loudest point in the file so far (0–128). */
  peak: number;
}

export type WaveformState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export class Waveform {
  state = $state<WaveformState>('idle');
  method = $state<WaveformMethod | null>(null);
  where = $state<'opfs' | 'memory' | null>(null);
  durationMs = $state(0);
  /** How far decoding has got. */
  doneMs = $state(0);
  /** Why there is no waveform, when there is none. */
  reason = $state<string | null>(null);
  /** The video's measured frame rate, or null (no video, or not known yet). */
  fps = $state<number | null>(null);
  /** Bumped whenever more peaks are available, so views redraw. */
  version = $state(0);

  private worker: Worker | null = null;
  private nextId = 1;
  // Request bookkeeping, not state anything renders.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  private readonly pending = new Map<number, (result: PeakRange) => void>();
  private file: File | null = null;
  private mediaDurationMs: () => number = () => 0;

  /** Starts on a media file; `mediaDurationMs` is the player's duration (0 while unknown). */
  open(file: File, mediaDurationMs: () => number): void {
    this.close();
    this.file = file;
    this.mediaDurationMs = mediaDurationMs;
    this.state = 'loading';
    // Vite resolves the worker from this exact form; it is not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    this.worker = new Worker(new URL('./waveform.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WaveformResponse>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      this.state = 'error';
      this.reason = event.message || 'The waveform worker failed.';
    };
    this.post({ type: 'open', file });
  }

  close(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const resolve of this.pending.values()) resolve({ peaks: new Int8Array(0), peak: 0 });
    this.pending.clear();
    this.file = null;
    this.state = 'idle';
    this.method = null;
    this.where = null;
    this.durationMs = 0;
    this.doneMs = 0;
    this.reason = null;
    this.fps = null;
  }

  /** Min/max peak pairs for `columns` slices of [fromMs, toMs), and the file's loudest point. */
  range(fromMs: number, toMs: number, columns: number): Promise<PeakRange> {
    if (!this.worker || this.state === 'unavailable') {
      return Promise.resolve({ peaks: new Int8Array(0), peak: 0 });
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.post({ type: 'range', id, fromMs, toMs, columns });
    });
  }

  private post(message: WaveformRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  private receive(message: WaveformResponse): void {
    switch (message.type) {
      case 'started':
        this.method = message.method;
        this.where = message.where;
        this.durationMs = message.durationMs;
        this.doneMs = 0;
        break;
      case 'progress':
        this.doneMs = message.doneMs;
        this.version++;
        break;
      case 'done':
        this.durationMs = message.durationMs;
        this.doneMs = message.durationMs;
        this.state = 'ready';
        this.version++;
        break;
      case 'video':
        this.fps = message.fps;
        break;
      case 'range':
        this.pending.get(message.id)?.({ peaks: message.peaks, peak: message.peak });
        this.pending.delete(message.id);
        break;
      case 'unavailable':
        if (message.fallback) void this.fallback(message.reason);
        else this.unavailable(message.reason);
        break;
      case 'error':
        this.state = 'error';
        this.reason = message.message;
        break;
    }
  }

  private unavailable(reason: string): void {
    this.state = 'unavailable';
    this.reason = reason;
  }

  /** Decodes the whole file with `decodeAudioData`, if it is short enough. */
  private async fallback(reason: string): Promise<void> {
    const file = this.file;
    if (!file) return;
    if (typeof OfflineAudioContext === 'undefined') return this.unavailable(reason);
    // The player may not know the duration yet; give it a moment.
    for (let i = 0; i < 20 && this.mediaDurationMs() === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const duration = this.mediaDurationMs();
    if (duration > FALLBACK_CAP_MS || (duration === 0 && file.size > FALLBACK_CAP_BYTES)) {
      return this.unavailable(
        `${reason}, and the media is too long to decode whole (over ${FALLBACK_CAP_MS / 60_000} minutes)`,
      );
    }
    try {
      const context = new OfflineAudioContext(1, 1, FALLBACK_RATE);
      const audio = await context.decodeAudioData(await file.arrayBuffer());
      if (this.file !== file) return;
      const channels = Array.from({ length: audio.numberOfChannels }, (_, c) =>
        audio.getChannelData(c),
      );
      this.post(
        { type: 'pcm', channels, sampleRate: audio.sampleRate },
        channels.map((c) => c.buffer),
      );
    } catch {
      if (this.file === file) this.unavailable(`${reason}, and the browser could not decode it`);
    }
  }
}
