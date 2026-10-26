/**
 * Finding the shot changes of the open video, in a media worker of its own (detect-video.ts),
 * started from the shot changes dialog. Cuts found so far are kept as it goes; stopping
 * terminates the worker.
 */
import { createWaveformWorker } from '../workers.ts';
import type { DetectorOptions } from './detect.ts';
import type { ShotResponse } from './protocol.ts';

export type DetectionState = 'idle' | 'running' | 'done' | 'stopped' | 'unavailable' | 'error';

export class ShotDetection {
  state = $state<DetectionState>('idle');
  durationMs = $state(0);
  doneMs = $state(0);
  /** Cuts found (ms, as the frames have them). */
  cuts = $state.raw<number[]>([]);
  /** Why it could not run, or what went wrong. */
  reason = $state<string | null>(null);
  private worker: Worker | null = null;
  private onDone: ((cuts: number[]) => void) | null = null;

  /** Starts on `file`; `ondone` gets the cuts when the whole video has been read. */
  start(file: File, options: DetectorOptions, ondone: (cuts: number[]) => void): void {
    this.stop();
    this.state = 'running';
    this.durationMs = 0;
    this.doneMs = 0;
    this.cuts = [];
    this.reason = null;
    this.onDone = ondone;
    // An instance of the media worker of its own, so stopping can terminate it.
    const worker = createWaveformWorker();
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<ShotResponse>) => this.receive(event.data);
    worker.onerror = (event) => {
      this.finish('error');
      this.reason = event.message || 'The shot detection worker failed.';
    };
    worker.postMessage({ type: 'detect', file, options });
  }

  /** Stops, keeping the cuts found so far in `cuts`. */
  stop(): void {
    if (this.state === 'running') this.finish('stopped');
    else this.finish(this.state);
  }

  /** How far it has got, from 0 to 1. */
  get progress(): number {
    return this.durationMs > 0 ? Math.min(1, this.doneMs / this.durationMs) : 0;
  }

  private finish(state: DetectionState): void {
    this.worker?.terminate();
    this.worker = null;
    this.state = state;
  }

  private receive(message: ShotResponse): void {
    switch (message.type) {
      case 'started':
        this.durationMs = message.durationMs;
        return;
      case 'progress':
        this.doneMs = message.doneMs;
        this.cuts = message.cuts;
        return;
      case 'done':
        this.cuts = message.cuts;
        this.doneMs = this.durationMs;
        this.finish('done');
        this.onDone?.(message.cuts);
        return;
      case 'unavailable':
        this.reason = message.reason;
        this.finish('unavailable');
        return;
      case 'error':
        this.reason = message.message;
        this.finish('error');
        return;
    }
  }
}
