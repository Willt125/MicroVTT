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
