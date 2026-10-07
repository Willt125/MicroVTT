/**
 * Computes waveform peaks off the main thread. The audio track is read from the `File` a chunk
 * at a time (Mediabunny's `BlobSource`) and decoded with WebCodecs; each decoded chunk is
 * reduced to peaks and released at once, so memory does not grow with the media's length. The
 * fine peaks go to OPFS (see cache.ts), and later opens of the same file reuse them.
 */
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import { openCache, overviewOf, type OpenedCache } from './cache.ts';
import { BINS_PER_SECOND, PeakReducer, loudest, peaksForView, type PeakStore } from './peaks.ts';
import type { WaveformRequest, WaveformResponse } from './protocol.ts';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WaveformRequest>) => void) | null;
  postMessage(message: WaveformResponse, transfer?: Transferable[]): void;
};
const post = (message: WaveformResponse, transfer: Transferable[] = []): void =>
  scope.postMessage(message, transfer);

/** How often to report progress while decoding. */
const PROGRESS_MS = 250;

let generation = 0;
let store: PeakStore | null = null;
let overview: () => Int8Array = () => new Int8Array(0);
let completedBins = (): number => 0;
let cache: OpenedCache | null = null;

function reset(): void {
  generation++;
  store?.close();
  store = null;
  cache = null;
  overview = () => new Int8Array(0);
  completedBins = () => 0;
}

async function open(file: File): Promise<void> {
  reset();
  const mine = generation;
  const opened = await openCache(file);
  if (mine !== generation) return opened.store.close();
  cache = opened;
  store = opened.store;

  if (opened.record) {
    const record = opened.record;
    const pairs = overviewOf(record);
    overview = () => pairs;
    completedBins = () => record.bins;
    post({ type: 'started', method: 'cache', durationMs: record.durationMs, where: opened.where });
    post({ type: 'done', durationMs: record.durationMs });
    return;
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (!track) {
      // Not a container Mediabunny reads, or no audio: the browser's own decoder may still.
      post({ type: 'unavailable', reason: 'no audio track that can be streamed', fallback: true });
      return;
    }
    if (!(await track.canDecode())) {
      post({
        type: 'unavailable',
        reason: `this browser cannot stream-decode ${track.codec ?? 'this audio codec'}`,
        fallback: true,
      });
      return;
    }
    const durationMs = Math.round((await track.computeDuration()) * 1000);
    if (mine !== generation) return;
    post({ type: 'started', method: 'stream', durationMs, where: opened.where });

    const reducer = new PeakReducer(opened.store);
    overview = () => reducer.overviewPairs();
    completedBins = () => reducer.completed;
    const planes: Float32Array[] = [];
    let lastReport = 0;
    for await (const sample of new AudioSampleSink(track).samples()) {
      if (mine !== generation) {
        sample.close();
        return;
      }
      const frames = sample.numberOfFrames;
      for (let ch = 0; ch < sample.numberOfChannels; ch++) {
        if ((planes[ch]?.length ?? 0) < frames) planes[ch] = new Float32Array(frames);
        const plane = planes[ch] as Float32Array;
        sample.copyTo(plane, { planeIndex: ch, format: 'f32-planar', frameCount: frames });
      }
      reducer.push(
        planes.slice(0, sample.numberOfChannels).map((p) => p.subarray(0, frames)),
        sample.sampleRate,
        Math.max(0, sample.timestamp),
      );
      const doneMs = Math.round((sample.timestamp + sample.duration) * 1000);
      sample.close();
      if (performance.now() - lastReport >= PROGRESS_MS) {
        lastReport = performance.now();
        post({ type: 'progress', doneMs });
      }
    }
    reducer.finish();
    const finalMs = Math.max(durationMs, Math.round((reducer.completed / BINS_PER_SECOND) * 1000));
    await opened.complete(reducer.completed, finalMs, reducer.overviewPairs());
    if (mine === generation) post({ type: 'done', durationMs: finalMs });
  } catch (error) {
    if (mine === generation) post({ type: 'error', message: (error as Error).message });
  } finally {
    input.dispose();
  }
}

/** Reduces audio the main thread decoded with `decodeAudioData` (the fallback). */
async function fromPcm(channels: Float32Array[], sampleRate: number): Promise<void> {
  if (!cache || !store) return;
  const opened = cache;
  const reducer = new PeakReducer(store);
  overview = () => reducer.overviewPairs();
  completedBins = () => reducer.completed;
  const durationMs = Math.round(((channels[0]?.length ?? 0) / sampleRate) * 1000);
  post({ type: 'started', method: 'decode-audio-data', durationMs, where: opened.where });
  // In slices, so range requests can be answered while it runs.
  const slice = sampleRate * 60;
  for (let i = 0; i < (channels[0]?.length ?? 0); i += slice) {
    reducer.push(
      channels.map((c) => c.subarray(i, i + slice)),
      sampleRate,
      i / sampleRate,
    );
    post({ type: 'progress', doneMs: Math.round(((i + slice) / sampleRate) * 1000) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  reducer.finish();
  await opened.complete(reducer.completed, durationMs, reducer.overviewPairs());
  post({ type: 'done', durationMs });
}

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case 'open':
      void open(request.file);
      break;
    case 'pcm':
      void fromPcm(request.channels, request.sampleRate);
      break;
    case 'range': {
      const peaks = store
        ? peaksForView(
            store,
            overview(),
            completedBins(),
            request.fromMs,
            request.toMs,
            request.columns,
          )
        : new Int8Array(request.columns * 2);
      post({ type: 'range', id: request.id, peaks, peak: loudest(overview()) }, [peaks.buffer]);
      break;
    }
    case 'close':
      reset();
      break;
  }
};
