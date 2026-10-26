/**
 * Finds cuts in a video, in a worker: run by the media worker (waveform.worker.ts) when it is
 * sent a `detect` request, in an instance of its own, so the video is read with the same copy
 * of Mediabunny and stopping is terminating that instance. The video track is read from the `File` a chunk
 * at a time (Mediabunny's `BlobSource`) and decoded with WebCodecs; each frame is drawn small
 * into a canvas, scored by the detector (detect.ts) and released at once, so memory does not
 */
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { CutDetector } from './detect.ts';
import type { ShotRequest, ShotResponse } from './protocol.ts';

/** Width frames are scored at: enough to tell shots apart, and cheap. */
const WIDTH = 128;
const PROGRESS_MS = 250;

export async function detectShots(
  request: ShotRequest,
  post: (message: ShotResponse) => void,
): Promise<void> {
  if (typeof OffscreenCanvas === 'undefined' || typeof VideoDecoder === 'undefined') {
    post({ type: 'unavailable', reason: 'this browser cannot decode video in the background' });
    return;
  }
  const input = new Input({ source: new BlobSource(request.file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) {
      post({ type: 'unavailable', reason: 'no video track that can be read here' });
      return;
    }
    if (!(await track.canDecode())) {
      post({
        type: 'unavailable',
        reason: `this browser cannot decode ${track.codec ?? 'this video codec'}`,
      });
      return;
    }
    const durationMs = Math.round((await track.computeDuration()) * 1000);
    post({ type: 'started', durationMs });

    const width = Math.min(WIDTH, track.displayWidth || WIDTH);
    const height = Math.max(
      1,
      Math.round((width * (track.displayHeight || 72)) / (track.displayWidth || WIDTH)),
    );
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      post({ type: 'unavailable', reason: 'no canvas to read frames with' });
      return;
    }
    const detector = new CutDetector(request.options);
    const cuts: number[] = [];
    let frames = 0;
    let lastReport = 0;
    for await (const sample of new VideoSampleSink(track).samples()) {
      const ms = Math.max(0, sample.timestamp * 1000);
      try {
        sample.draw(ctx, 0, 0, width, height);
      } finally {
        sample.close();
      }
      const pixels = ctx.getImageData(0, 0, width, height).data;
      cuts.push(...detector.push(ms, pixels, width * height));
      frames++;
      if (performance.now() - lastReport >= PROGRESS_MS) {
        lastReport = performance.now();
        post({ type: 'progress', doneMs: Math.round(ms), cuts: [...cuts] });
      }
    }
    cuts.push(...detector.finish());
    post({ type: 'done', cuts, frames });
  } finally {
    input.dispose();
  }
}
