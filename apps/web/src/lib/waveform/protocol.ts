/** Messages between the timeline and the waveform worker. */

/**
 * How the peaks were (or are being) obtained: from the cache, streamed (Mediabunny reading the
 * file in chunks, decoding PCM itself and anything else with WebCodecs), or decoded whole.
 */
export type WaveformMethod = 'cache' | 'stream' | 'decode-audio-data';

export type WaveformRequest =
  /** Start on a media file: from the cache, or by streaming its audio through WebCodecs. */
  | { type: 'open'; file: File }
  /** Decoded audio from the main-thread fallback (`decodeAudioData`), to reduce and keep. */
  | { type: 'pcm'; channels: Float32Array[]; sampleRate: number }
  /** Peaks for `columns` slices of [fromMs, toMs). */
  | { type: 'range'; id: number; fromMs: number; toMs: number; columns: number }
  | { type: 'close' };

export type WaveformResponse =
  | { type: 'started'; method: WaveformMethod; durationMs: number; where: 'opfs' | 'memory' }
  /** The file cannot be streamed here; `fallback` says whether `decodeAudioData` may try. */
  | { type: 'unavailable'; reason: string; fallback: boolean }
  | { type: 'progress'; doneMs: number }
  | { type: 'done'; durationMs: number }
  /** `peak`: the loudest point so far (0–128), for drawing at a readable scale. */
  | { type: 'range'; id: number; peaks: Int8Array; peak: number }
  | { type: 'error'; message: string };
