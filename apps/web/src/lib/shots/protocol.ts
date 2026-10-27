/** Messages between the page and the shot-detection worker. */
import type { DetectorOptions } from './detect.ts';

export type ShotRequest = { type: 'detect'; file: File; options: DetectorOptions };

export type ShotResponse =
  | { type: 'started'; durationMs: number }
  /** How far it has got, and the cuts found so far (times in ms, as the frames have them). */
  | { type: 'progress'; doneMs: number; cuts: number[] }
  | { type: 'done'; cuts: number[]; frames: number }
  /** The video cannot be read here; `reason` says why. */
  | { type: 'unavailable'; reason: string }
  | { type: 'error'; message: string };
