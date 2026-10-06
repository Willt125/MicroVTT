/** Playback helpers that don't touch the DOM. */
import type { Cue, VttDocument } from '@microvtt/core';

/**
 * The body index of the cue showing at `ms`: of the cues with start ≤ ms < end, the one that
 * started last (the most recent caption), or -1.
 */
export function cueAt(doc: VttDocument, rows: readonly number[], ms: number): number {
  let best = -1;
  let bestStart = -1;
  for (const i of rows) {
    const cue = doc.body[i] as Cue;
    if (cue.startMs <= ms && ms < cue.endMs && cue.startMs > bestStart) {
      best = i;
      bestStart = cue.startMs;
    }
  }
  return best;
}

/** Where looping playback should jump to, or null to keep playing. */
export function loopTarget(cue: Cue, ms: number): number | null {
  // A little slack before the start, so seeking slightly early doesn't loop.
  return ms >= cue.endMs || ms < cue.startMs - 250 ? cue.startMs : null;
}

/** Split time for a cue: the playhead if it is inside, else in proportion to the text offset. */
export function splitTime(cue: Cue, playheadMs: number | null, textOffset: number): number | null {
  if (cue.endMs - cue.startMs < 2) return null;
  if (playheadMs !== null && playheadMs > cue.startMs && playheadMs < cue.endMs) return playheadMs;
  const ratio = cue.text.length > 0 ? textOffset / cue.text.length : 0.5;
  const ms = Math.round(cue.startMs + (cue.endMs - cue.startMs) * ratio);
  return Math.min(cue.endMs - 1, Math.max(cue.startMs + 1, ms));
}

/** The document with only the cues showing between `fromMs` and `toMs` (head kept). */
export function sliceDocument(doc: VttDocument, fromMs: number, toMs: number): VttDocument {
  return {
    ...doc,
    body: doc.body.filter((i) => i.type === 'cue' && i.endMs > fromMs && i.startMs < toMs),
  };
}

export function isMediaFile(file: File): boolean {
  return (
    /^(audio|video)\//.test(file.type) ||
    /\.(mp4|m4v|m4a|mov|webm|mkv|ogg|ogv|oga|opus|mp3|wav|flac|aac)$/i.test(file.name)
  );
}

/**
 * A text offset to split raw cue text at, near `ratio` of its length: the closest whitespace
 * outside tags, else the ratio point itself (core moves it out of any tag).
 */
export function splitOffset(text: string, ratio: number): number {
  const target = Math.round(text.length * Math.min(1, Math.max(0, ratio)));
  let best = -1;
  let inTag = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag && (ch === ' ' || ch === '\n') && i > 0 && i < text.length - 1) {
      if (best === -1 || Math.abs(i - target) < Math.abs(best - target)) best = i;
    }
  }
  return best === -1 ? target : best;
}
