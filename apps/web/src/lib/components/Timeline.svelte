<!--
  The timeline under the editor: the media's waveform, the cues as blocks, and the playhead.
  Scroll to move through time, Ctrl/⌘ + scroll (or the buttons) to zoom; click to seek, click a
  cue to select it (Ctrl/⌘ and Shift add to the selection). Drag a cue's edge to retime it, or
  the cue to move it with the rest of the selection; edges snap to other cues' edges, word
  timings and the playhead (hold Alt not to snap). Peaks for the visible range are read from
  the waveform worker, so a 12-hour file draws as cheaply as a short one.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { textTimestamps, type Cue } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import type { Player } from '../player.svelte.ts';
  import {
    DEFAULT_VIEW_MS,
    clampView,
    follow,
    maxMsPerPx,
    resolveDrag,
    rulerLabel,
    rulerStep,
    zoomAt,
    type DragKind,
    type DragResult,
    type View,
  } from '../timeline.ts';
  import type { Waveform } from '../waveform/waveform.svelte.ts';
  import { plainText } from '../display.ts';

  interface Props {
    editor: Editor;
    player: Player;
    waveform: Waveform;
    /** Called with the time under the mouse pointer, or null when it leaves the timeline. */
    onpointertime?: (ms: number | null) => void;
  }

  let { editor, player, waveform, onpointertime }: Props = $props();

  const RULER_PX = 18;
  const CUE_LANE_PX = 26;
  /** How near (in px) a cue's edge the pointer must be to drag the edge. */
  const EDGE_PX = 6;
  /** How near (in px) an edge snaps to a target. */
  const SNAP_PX = 8;
  /** Length (in px) of the word-timing ticks at the top and bottom of a cue block. */
  const TICK_PX = 5;

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let view = $state<View>({ startMs: 0, msPerPx: DEFAULT_VIEW_MS / 800 });
  /** Peaks for the last view requested, and the view they are for. */
  let peaks: { view: View; width: number; data: Int8Array; peak: number } | null = null;
  /** Most gain applied to quiet files, so silence and hiss are not blown up. */
  const MAX_GAIN = 16;
  let requested = 0;
  let frame = 0;
  /** Word-timing ticks in the last frame drawn (for tests: the canvas cannot be read back). */
  let drawnTicks = $state(0);

  const durationMs = $derived(
    Math.max(player.durationMs, waveform.durationMs, lastCueEnd(editor.doc.body)),
  );

  /** Word timings inside each cue (cues are never changed in place, so they key the cache). */
  const timings = new WeakMap<Cue, number[]>();
  function wordTimings(cue: Cue): number[] {
    let found = timings.get(cue);
    if (!found) {
      found = textTimestamps(editor.format.text, cue.text).filter(
        (ms) => ms > cue.startMs && ms < cue.endMs,
      );
      timings.set(cue, found);
    }
    return found;
  }

  function lastCueEnd(body: typeof editor.doc.body): number {
    let end = 0;
    for (const item of body) if (item.type === 'cue' && item.endMs > end) end = item.endMs;
    return end;
  }

  const setView = (next: View): void => {
    view = clampView(next, durationMs, width);
    untouched = false;
  };

  /** Set when the view should return to the start at the default zoom, once the width is known. */
  let resetPending = true;
  /**
   * True while the view is still the default one (nothing has scrolled, zoomed or followed the
   * playhead): it is then laid out again when the media's length becomes known, which may be
   * after the first layout, and when the timeline is resized.
   */
  let untouched = false;

  // A new media file starts at its beginning, at the default zoom.
  $effect(() => {
    void player.url;
    resetPending = true;
    if (untrack(() => width) > 0) resetView();
  });

  function resetView(): void {
    resetPending = false;
    setView({ startMs: 0, msPerPx: DEFAULT_VIEW_MS / width });
    untouched = true;
  }

  // The default view is limited to the length known when it was laid out (at first perhaps only
  // the cues'): lay it out again as the media's length arrives.
  $effect(() => {
    void durationMs;
    if (untrack(() => untouched && width > 0)) untrack(resetView);
  });

  // Follow the playhead while playing.
  $effect(() => {
    const ms = player.currentMs;
    if (!player.paused && width > 0) {
      const next = follow(view, ms, width);
      if (next !== view) setView(next);
    }
  });

  // Ask for peaks when the view changes or more audio has been decoded.
  $effect(() => {
    const v = view;
    const w = width;
    void waveform.version;
    void waveform.state;
    if (w <= 0) return;
    const id = ++requested;
    void waveform.range(v.startMs, v.startMs + v.msPerPx * w, w).then(({ peaks: data, peak }) => {
      if (id !== requested) return;
      peaks = { view: v, width: w, data, peak };
      schedule();
    });
  });

  // Redraw whenever anything drawn changes.
  $effect(() => {
    void [view, width, height, editor.doc, editor.selection, player.currentMs, waveform.state];
    schedule();
  });

  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  }

  interface Colors {
    bg: string;
    text: string;
    muted: string;
    border: string;
    cue: string;
    accent: string;
    playhead: string;
  }

  function colors(): Colors {
    const style = getComputedStyle(canvas as HTMLCanvasElement);
    const get = (name: string): string => style.getPropertyValue(name).trim() || '#888';
    return {
      bg: get('--surface'),
      text: get('--text'),
      muted: get('--muted'),
      border: get('--border'),
      cue: get('--selected'),
      accent: get('--accent'),
      playhead: get('--error'),
    };
  }

  function draw(): void {
    const ctx = canvas?.getContext('2d');
    if (!ctx || width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors();
    const x = (ms: number): number => (ms - view.startMs) / view.msPerPx;
    const endMs = view.startMs + view.msPerPx * width;

    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, width, height);

    // Ruler.
    const step = rulerStep(view.msPerPx);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = c.muted;
    ctx.strokeStyle = c.border;
    ctx.beginPath();
    for (let t = Math.floor(view.startMs / step) * step; t <= endMs; t += step) {
      const px = Math.round(x(t)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, RULER_PX);
      ctx.fillText(rulerLabel(t, step), px + 3, 12);
    }
    ctx.stroke();

    // Waveform, between the ruler and the cue lane.
    const top = RULER_PX;
    const waveHeight = height - RULER_PX - CUE_LANE_PX;
    const mid = top + waveHeight / 2;
    if (peaks && peaks.data.length > 0) {
      // Peaks may be for a slightly different view while a new request is in flight: map them.
      const p = peaks;
      // Scaled to the file's loudest point (not the view's, so scrolling does not rescale).
      const gain = Math.min(MAX_GAIN, 128 / Math.max(1, p.peak));
      ctx.fillStyle = c.muted;
      for (let px = 0; px < width; px++) {
        const ms = view.startMs + px * view.msPerPx;
        const col = Math.floor((ms - p.view.startMs) / p.view.msPerPx);
        if (col < 0 || col >= p.width) continue;
        const min = ((p.data[col * 2] as number) * gain) / 128;
        const max = ((p.data[col * 2 + 1] as number) * gain) / 128;
        const y1 = mid - max * (waveHeight / 2);
        const y2 = mid - min * (waveHeight / 2);
        ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1));
      }
    } else {
      ctx.strokeStyle = c.border;
      ctx.beginPath();
      ctx.moveTo(0, mid + 0.5);
      ctx.lineTo(width, mid + 0.5);
      ctx.stroke();
    }

    // Cues, in the lane at the bottom.
    const laneTop = height - CUE_LANE_PX;
    let ticks = 0;
    ctx.font = '12px system-ui, sans-serif';
    for (const i of editor.cueRows) {
      const cue = shown(i, editor.doc.body[i] as Cue);
      if (cue.endMs < view.startMs || cue.startMs > endMs) continue;
      const x1 = Math.max(-1, x(cue.startMs));
      const x2 = Math.min(width + 1, x(cue.endMs));
      const selected = editor.isSelected(i);
      ctx.fillStyle = selected ? c.accent : c.cue;
      ctx.globalAlpha = selected ? 0.35 : 1;
      ctx.fillRect(x1, laneTop + 2, Math.max(1, x2 - x1), CUE_LANE_PX - 4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = selected ? c.accent : c.border;
      ctx.strokeRect(x1 + 0.5, laneTop + 2.5, Math.max(1, x2 - x1 - 1), CUE_LANE_PX - 5);
      // Word timings: short ticks at the top and bottom of the block (a dashed line would look
      // like the snap marker). They move with the cue when it is dragged, not with its edges.
      const stamps = wordTimings(editor.doc.body[i] as Cue);
      if (stamps.length > 0 && x2 - x1 > 6) {
        const offset =
          drag?.result && drag.hit.kind === 'move' && drag.moving.has(i) ? drag.result.deltaMs : 0;
        ctx.strokeStyle = c.text;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        let lastPx = -Infinity;
        for (const ms of stamps) {
          const px = Math.round(x(ms + offset)) + 0.5;
          // Within the block, and not crowded into a smear when zoomed out.
          if (px <= x1 + 1 || px >= x2 - 1 || px - lastPx < 3) continue;
          lastPx = px;
          ticks++;
          ctx.moveTo(px, laneTop + 3);
          ctx.lineTo(px, laneTop + 3 + TICK_PX);
          ctx.moveTo(px, laneTop + CUE_LANE_PX - 3 - TICK_PX);
          ctx.lineTo(px, laneTop + CUE_LANE_PX - 3);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (x2 - x1 > 24) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1 + 3, laneTop, x2 - x1 - 6, CUE_LANE_PX);
        ctx.clip();
        ctx.fillStyle = c.text;
        ctx.fillText(
          plainText(cue.text, editor.format.text).replace(/\n/g, ' '),
          x1 + 4,
          laneTop + 17,
        );
        ctx.restore();
      }
    }

    drawnTicks = ticks;

    // The time a drag has snapped to.
    if (drag?.result?.snappedTo != null) {
      const sx = Math.round(x(drag.result.snappedTo)) + 0.5;
      ctx.strokeStyle = c.accent;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, RULER_PX);
      ctx.lineTo(sx, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Playhead.
    const ph = Math.round(x(player.currentMs)) + 0.5;
    if (ph >= 0 && ph <= width) {
      ctx.strokeStyle = c.playhead;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ph, 0);
      ctx.lineTo(ph, height);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // Size the canvas to its box (in device pixels).
  $effect(() => {
    const el = canvas;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      width = Math.round(entry.contentRect.width);
      height = Math.round(entry.contentRect.height);
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(width * dpr);
      el.height = Math.round(height * dpr);
      if (resetPending || untouched) resetView();
      else setView(view);
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  /** Records the time under the pointer, for the playhead-to-pointer shortcut. */
  function trackPointer(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onpointertime?.(Math.max(0, view.startMs + (event.clientX - rect.left) * view.msPerPx));
  }

  function onwheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (event.ctrlKey || event.metaKey) {
      setView(zoomAt(view, Math.exp(event.deltaY * 0.002), px));
    } else {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      setView({ ...view, startMs: view.startMs + delta * view.msPerPx });
    }
    trackPointer(event);
  }

  interface Hit {
    index: number;
    kind: DragKind;
  }

  /**
   * The cue at a point in the cue lane, and which part: an edge (within a few pixels; on a
   * narrow cue, its outer thirds) or the body. Of overlapping cues, the last drawn (on top) wins.
   */
  function hitAt(px: number, py: number): Hit | null {
    if (py < height - CUE_LANE_PX) return null;
    const x = (ms: number): number => (ms - view.startMs) / view.msPerPx;
    let found: Hit | null = null;
    for (const i of editor.cueRows) {
      const cue = editor.doc.body[i] as Cue;
      const x1 = x(cue.startMs);
      const x2 = x(cue.endMs);
      if (px < x1 - EDGE_PX || px > x2 + EDGE_PX) continue;
      const edge = Math.min(EDGE_PX, (x2 - x1) / 3);
      if (px <= x1 + edge) found = { index: i, kind: 'start' };
      else if (px >= x2 - edge) found = { index: i, kind: 'end' };
      else found = { index: i, kind: 'move' };
    }
    return found;
  }

  interface Drag {
    pointerX: number;
    hit: Hit;
    /** Body indices of the cues that move (for a move; else just the dragged one). */
    moving: Set<number>;
    span: { startMs: number; endMs: number };
    targets: number[];
    result: DragResult | null;
  }

  /** Panning the view (a drag outside the cues), or a click to seek. */
  let pan: { px: number; startMs: number } | null = null;
  let panned = false;
  let drag: Drag | null = null;

  /** A cue's times as drawn: moved by the drag in progress, if it takes part. */
  function shown(i: number, cue: Cue): Cue {
    if (!drag?.result || !drag.moving.has(i)) return cue;
    const d = drag.result.deltaMs;
    if (drag.hit.kind === 'move') return { ...cue, startMs: cue.startMs + d, endMs: cue.endMs + d };
    return drag.hit.kind === 'start'
      ? { ...cue, startMs: cue.startMs + d }
      : { ...cue, endMs: cue.endMs + d };
  }

  /**
   * What edges can snap to: edges of the cues that stay put, word timings, and the playhead.
   * Only cues near the view are looked at, as a drag does not go much further.
   */
  function snapTargets(moving: Set<number>, kind: DragKind, dragged: number): number[] {
    const span = view.msPerPx * width;
    const from = view.startMs - span;
    const to = view.startMs + 2 * span;
    const targets = [player.currentMs];
    for (const i of editor.cueRows) {
      const cue = editor.doc.body[i] as Cue;
      if (cue.endMs < from || cue.startMs > to) continue;
      const moves = moving.has(i);
      if (!moves) targets.push(cue.startMs, cue.endMs);
      // A cue's own word timings stay put while one of its edges is dragged.
      if (!moves || (kind !== 'move' && i === dragged))
        targets.push(...textTimestamps(editor.format.text, cue.text));
    }
    return targets;
  }

  function onpointerdown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const rect = target.getBoundingClientRect();
    const hit = hitAt(event.clientX - rect.left, event.clientY - rect.top);
    if (!hit) {
      pan = { px: event.clientX, startMs: view.startMs };
      panned = false;
      return;
    }
    // No text selection or native drag while working on cues.
    event.preventDefault();
    if (event.shiftKey) return editor.selectRange(hit.index);
    if (event.ctrlKey || event.metaKey) return editor.toggleSelected(hit.index);
    if (!editor.isSelected(hit.index)) editor.selected = hit.index;
    const moving = new Set(
      hit.kind === 'move' && editor.isSelected(hit.index) ? editor.selection : [hit.index],
    );
    let startMs = Infinity;
    let endMs = 0;
    for (const i of moving) {
      const cue = editor.doc.body[i] as Cue;
      startMs = Math.min(startMs, cue.startMs);
      endMs = Math.max(endMs, cue.endMs);
    }
    drag = {
      pointerX: event.clientX,
      hit,
      moving,
      span: { startMs, endMs },
      targets: snapTargets(moving, hit.kind, hit.index),
      result: null,
    };
  }

  function onpointermove(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (event.pointerType !== 'touch') trackPointer(event);
    if (drag) {
      const dx = event.clientX - drag.pointerX;
      if (!drag.result && Math.abs(dx) <= 3) return;
      const cue = editor.doc.body[drag.hit.index] as Cue;
      drag.result = resolveDrag(
        drag.hit.kind,
        cue,
        drag.span,
        dx * view.msPerPx,
        event.altKey ? [] : drag.targets,
        SNAP_PX * view.msPerPx,
      );
      schedule();
      return;
    }
    if (pan) {
      const dx = event.clientX - pan.px;
      if (Math.abs(dx) > 3) panned = true;
      if (panned) setView({ ...view, startMs: pan.startMs - dx * view.msPerPx });
      return;
    }
    const rect = target.getBoundingClientRect();
    const hit = hitAt(event.clientX - rect.left, event.clientY - rect.top);
    target.style.cursor = !hit ? '' : hit.kind === 'move' ? 'grab' : 'ew-resize';
  }

  function onpointerup(event: PointerEvent): void {
    const d = drag;
    drag = null;
    if (d) {
      if (d.result) {
        const { deltaMs } = d.result;
        if (d.hit.kind === 'move')
          editor.changeTimes({ kind: 'move', indices: [...d.moving], deltaMs });
        else editor.changeTimes({ kind: d.hit.kind, index: d.hit.index, deltaMs });
      } else if (editor.multiple) {
        // A plain click on one of several selected cues selects it alone.
        editor.selected = d.hit.index;
      }
      schedule();
      return;
    }
    const from = pan;
    pan = null;
    if (!from || panned) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    player.seek(view.startMs + (event.clientX - rect.left) * view.msPerPx);
  }

  function onpointercancel(): void {
    drag = null;
    pan = null;
    schedule();
  }

  function zoom(factor: number): void {
    // Around the playhead when it is in view, else the middle.
    const ph = (player.currentMs - view.startMs) / view.msPerPx;
    setView(zoomAt(view, factor, ph >= 0 && ph <= width ? ph : width / 2));
  }

  const status = $derived.by(() => {
    switch (waveform.state) {
      case 'loading':
        return waveform.durationMs > 0
          ? `Reading the audio… ${Math.min(100, Math.floor((waveform.doneMs / waveform.durationMs) * 100))}%`
          : 'Reading the audio…';
      case 'unavailable':
        return `No waveform: ${waveform.reason ?? 'the audio cannot be read here'}.`;
      case 'error':
        return `No waveform: ${waveform.reason ?? 'the audio could not be read'}.`;
      default:
        return '';
    }
  });
</script>

<section
  class="timeline"
  aria-label="Timeline"
  data-waveform={waveform.state}
  data-method={waveform.method}
  data-where={waveform.where}
  data-start-ms={Math.round(view.startMs)}
  data-ms-per-px={view.msPerPx}
  data-ticks={drawnTicks}
>
  <div class="bar">
    <span class="status muted" aria-live="polite">{status}</span>
    <button onclick={() => zoom(0.5)} title="Zoom in (Ctrl/⌘ + scroll)" aria-label="Zoom in"
      >+</button
    >
    <button onclick={() => zoom(2)} title="Zoom out" aria-label="Zoom out">−</button>
    <button
      onclick={() => setView({ startMs: 0, msPerPx: maxMsPerPx(durationMs, width) })}
      title="Show the whole file">Whole file</button
    >
  </div>
  <canvas
    bind:this={canvas}
    aria-label="Waveform and cues; click to seek or select a cue, drag a cue or its edges to retime it"
    {onwheel}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {onpointercancel}
    onpointerleave={() => onpointertime?.(null)}
  ></canvas>
</section>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0 0.75rem 0.75rem;
    height: 9.5rem;
    flex-shrink: 0;
  }
  .bar {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    font-size: 0.85rem;
  }
  .status {
    flex: 1;
  }
  .bar button {
    padding: 0.1rem 0.6rem;
  }
  canvas {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    touch-action: none;
    cursor: pointer;
  }
</style>
