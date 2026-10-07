<!--
  The timeline under the editor: the media's waveform, the cues as blocks, and the playhead.
  Scroll to move through time, Ctrl/⌘ + scroll (or the buttons) to zoom; click to seek, click a
  cue to select it. Peaks for the visible range are read from the waveform worker, so a
  12-hour file draws as cheaply as a short one.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Cue } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import type { Player } from '../player.svelte.ts';
  import {
    DEFAULT_VIEW_MS,
    clampView,
    follow,
    maxMsPerPx,
    rulerLabel,
    rulerStep,
    zoomAt,
    type View,
  } from '../timeline.ts';
  import type { Waveform } from '../waveform/waveform.svelte.ts';
  import { plainText } from '../display.ts';

  interface Props {
    editor: Editor;
    player: Player;
    waveform: Waveform;
  }

  let { editor, player, waveform }: Props = $props();

  const RULER_PX = 18;
  const CUE_LANE_PX = 26;

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

  const durationMs = $derived(
    Math.max(player.durationMs, waveform.durationMs, lastCueEnd(editor.doc.body)),
  );

  function lastCueEnd(body: typeof editor.doc.body): number {
    let end = 0;
    for (const item of body) if (item.type === 'cue' && item.endMs > end) end = item.endMs;
    return end;
  }

  const setView = (next: View): void => {
    view = clampView(next, durationMs, width);
  };

  /** Set when the view should return to the start at the default zoom, once the width is known. */
  let resetPending = true;

  // A new media file starts at its beginning, at the default zoom.
  $effect(() => {
    void player.url;
    resetPending = true;
    if (untrack(() => width) > 0) resetView();
  });

  function resetView(): void {
    resetPending = false;
    setView({ startMs: 0, msPerPx: DEFAULT_VIEW_MS / width });
  }

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
    void [view, width, height, editor.doc, editor.selected, player.currentMs, waveform.state];
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
    ctx.font = '12px system-ui, sans-serif';
    for (const i of editor.cueRows) {
      const cue = editor.doc.body[i] as Cue;
      if (cue.endMs < view.startMs || cue.startMs > endMs) continue;
      const x1 = Math.max(-1, x(cue.startMs));
      const x2 = Math.min(width + 1, x(cue.endMs));
      const selected = i === editor.selected;
      ctx.fillStyle = selected ? c.accent : c.cue;
      ctx.globalAlpha = selected ? 0.35 : 1;
      ctx.fillRect(x1, laneTop + 2, Math.max(1, x2 - x1), CUE_LANE_PX - 4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = selected ? c.accent : c.border;
      ctx.strokeRect(x1 + 0.5, laneTop + 2.5, Math.max(1, x2 - x1 - 1), CUE_LANE_PX - 5);
      if (x2 - x1 > 24) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x1 + 3, laneTop, x2 - x1 - 6, CUE_LANE_PX);
        ctx.clip();
        ctx.fillStyle = c.text;
        ctx.fillText(plainText(cue.text).replace(/\n/g, ' '), x1 + 4, laneTop + 17);
        ctx.restore();
      }
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
      if (resetPending) resetView();
      else setView(view);
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

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
  }

  /** The cue drawn at a point in the cue lane (the last drawn wins, as it is on top). */
  function cueAtPoint(px: number, py: number): number {
    if (py < height - CUE_LANE_PX) return -1;
    const ms = view.startMs + px * view.msPerPx;
    let found = -1;
    for (const i of editor.cueRows) {
      const cue = editor.doc.body[i] as Cue;
      if (cue.startMs <= ms && ms <= cue.endMs) found = i;
    }
    return found;
  }

  let dragFrom: { px: number; startMs: number } | null = null;
  let dragged = false;

  function onpointerdown(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragFrom = { px: event.clientX, startMs: view.startMs };
    dragged = false;
  }

  function onpointermove(event: PointerEvent): void {
    if (!dragFrom) return;
    const dx = event.clientX - dragFrom.px;
    if (Math.abs(dx) > 3) dragged = true;
    if (dragged) setView({ ...view, startMs: dragFrom.startMs - dx * view.msPerPx });
  }

  function onpointerup(event: PointerEvent): void {
    const from = dragFrom;
    dragFrom = null;
    if (!from || dragged) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const px = event.clientX - rect.left;
    const cue = cueAtPoint(px, event.clientY - rect.top);
    if (cue !== -1) editor.selected = cue;
    else player.seek(view.startMs + px * view.msPerPx);
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
  data-start-ms={Math.round(view.startMs)}
  data-ms-per-px={view.msPerPx}
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
    aria-label="Waveform and cues; click to seek or select a cue"
    {onwheel}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
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
