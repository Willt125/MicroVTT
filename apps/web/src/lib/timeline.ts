/** Timeline geometry that doesn't touch the DOM: zoom limits, ruler steps, view clamping. */

/** Closest zoom: milliseconds per pixel. */
export const MIN_MS_PER_PX = 2;
/** The view a newly loaded file starts with. */
export const DEFAULT_VIEW_MS = 30_000;

/** Ruler steps, in ms; the smallest that leaves at least `minPx` between labels is used. */
const STEPS = [
  100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  900_000, 1_800_000, 3_600_000, 7_200_000,
];

export function rulerStep(msPerPx: number, minPx = 80): number {
  return STEPS.find((s) => s / msPerPx >= minPx) ?? (STEPS[STEPS.length - 1] as number);
}

export interface View {
  /** Time at the left edge. */
  startMs: number;
  msPerPx: number;
}

/** The farthest zoom: the whole media (or document) across the width, with a little room. */
export const maxMsPerPx = (durationMs: number, widthPx: number): number =>
  Math.max(MIN_MS_PER_PX, (Math.max(durationMs, 10_000) * 1.02) / Math.max(1, widthPx));

/** Keeps a view within [0, duration] and the zoom limits. */
export function clampView(view: View, durationMs: number, widthPx: number): View {
  const msPerPx = Math.min(maxMsPerPx(durationMs, widthPx), Math.max(MIN_MS_PER_PX, view.msPerPx));
  const span = msPerPx * widthPx;
  const maxStart = Math.max(0, Math.max(durationMs, 10_000) - span * 0.5);
  return { msPerPx, startMs: Math.min(maxStart, Math.max(0, view.startMs)) };
}

/** Zooms by `factor` (<1 zooms in) keeping the time under `anchorPx` in place. */
export function zoomAt(view: View, factor: number, anchorPx: number): View {
  const anchorMs = view.startMs + anchorPx * view.msPerPx;
  const msPerPx = view.msPerPx * factor;
  return { msPerPx, startMs: anchorMs - anchorPx * msPerPx };
}

/** The view after the playhead, if it has left the view (or is about to), pages to follow it. */
export function follow(view: View, playheadMs: number, widthPx: number): View {
  const span = view.msPerPx * widthPx;
  if (playheadMs >= view.startMs && playheadMs <= view.startMs + span * 0.9) return view;
  return { ...view, startMs: playheadMs - span * 0.1 };
}

/** "1:02:03", "2:03" or "2:03.5" for ruler labels. */
export function rulerLabel(ms: number, stepMs: number): string {
  const total = Math.round(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  const tenths = Math.floor(total / 100) % 10;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  return stepMs < 1000 ? `${base}.${tenths}` : base;
}

/** The shortest cue a drag can make. */
export const MIN_CUE_MS = 10;

/** How a cue drag changes times: one edge of one cue, or whole cues. */
export type DragKind = 'start' | 'end' | 'move';

/** The nearest of `targets` within `maxDistanceMs` of `ms`, or null. */
export function nearest(
  ms: number,
  targets: readonly number[],
  maxDistanceMs: number,
): number | null {
  let best: number | null = null;
  let bestDistance = maxDistanceMs;
  for (const t of targets) {
    const d = Math.abs(t - ms);
    if (d <= bestDistance) {
      best = t;
      bestDistance = d;
    }
  }
  return best;
}

export interface DragResult {
  /** The change to apply: to the dragged edge, or to every moved cue. */
  deltaMs: number;
  /** The time snapped to, for drawing a guide, or null. */
  snappedTo: number | null;
}

/**
 * Resolves a drag of `deltaMs` (from the pointer) into the change to apply. `cue` is the dragged
 * cue; for a move, `span` is the earliest start and latest end of all the cues moving. The edge
 * (or, for a move, whichever of the block's edges is nearer a target) snaps to the nearest
 * target within `snapMs`, and the result keeps times at or after 0 and cues at least
 * `MIN_CUE_MS` long.
 */
export function resolveDrag(
  kind: DragKind,
  cue: { startMs: number; endMs: number },
  span: { startMs: number; endMs: number },
  deltaMs: number,
  targets: readonly number[],
  snapMs: number,
): DragResult {
  let delta = deltaMs;
  let snappedTo: number | null = null;
  if (kind === 'move') {
    const start = nearest(span.startMs + delta, targets, snapMs);
    const end = nearest(span.endMs + delta, targets, snapMs);
    const ds = start === null ? Infinity : Math.abs(start - (span.startMs + delta));
    const de = end === null ? Infinity : Math.abs(end - (span.endMs + delta));
    if (start !== null && ds <= de) {
      delta = start - span.startMs;
      snappedTo = start;
    } else if (end !== null) {
      delta = end - span.endMs;
      snappedTo = end;
    }
    if (span.startMs + delta < 0) {
      delta = -span.startMs;
      snappedTo = null;
    }
    return { deltaMs: Math.round(delta), snappedTo };
  }
  const edge = kind === 'start' ? cue.startMs : cue.endMs;
  const snapped = nearest(edge + delta, targets, snapMs);
  if (snapped !== null) {
    delta = snapped - edge;
    snappedTo = snapped;
  }
  const [min, max] =
    kind === 'start'
      ? [-cue.startMs, cue.endMs - MIN_CUE_MS - cue.startMs]
      : [cue.startMs + MIN_CUE_MS - cue.endMs, Infinity];
  if (delta < min || delta > max) {
    delta = Math.min(max, Math.max(min, delta));
    snappedTo = null;
  }
  return { deltaMs: Math.round(delta), snappedTo };
}
