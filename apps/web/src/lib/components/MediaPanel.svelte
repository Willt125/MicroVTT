<!--
  The media player: plays a local audio or video file with the document shown as captions (the
  browser's own WebVTT renderer, fed the exported file), loops the selected cue, and keeps the
  cue list and the playhead in step.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Editor } from '../editor.svelte.ts';
  import { cueAt, loopTarget } from '../media.ts';
  import { RATES, type Player } from '../player.svelte.ts';
  import { formatTime } from '../time.ts';

  interface Props {
    editor: Editor;
    player: Player;
    /** True while focus is in the cue editor (playback must not change the selection then). */
    isEditing: () => boolean;
  }

  let { editor, player, isEditing }: Props = $props();

  const PREVIEW_DELAY_MS = 600;
  const SCAN_INTERVAL_MS = 100;
  /**
   * Browsers parse caption tracks on the main thread (a 12-hour file takes ~0.3 s), so for long
   * documents the preview holds only the cues around the playhead, and moves along with it.
   */
  const PREVIEW_ALL_LIMIT = 2000;
  const WINDOW_BEFORE_MS = 60_000;
  const WINDOW_AFTER_MS = 300_000;
  const WINDOW_MARGIN_MS = 60_000;

  let trackUrl = $state<string | null>(null);
  let previewWindow = $state.raw<{ fromMs: number; toMs: number } | null>(null);
  let previewedDoc: unknown = null;
  let frame = 0;
  let lastScan = 0;
  /** The selection playback made, so it is not mistaken for the user's and seeked to. */
  let followed = -1;

  // Long documents: keep the preview window around the playhead.
  $effect(() => {
    const ms = player.currentMs;
    if (editor.cueRows.length <= PREVIEW_ALL_LIMIT) {
      previewWindow = null;
      return;
    }
    const w = untrack(() => previewWindow);
    if (!w || ms < w.fromMs || ms > w.toMs - WINDOW_MARGIN_MS)
      previewWindow = { fromMs: ms - WINDOW_BEFORE_MS, toMs: ms + WINDOW_AFTER_MS };
  });

  // Rebuild the caption preview after edits settle (at once when only the window moved).
  $effect(() => {
    if (!player.hasMedia || !player.captions) return;
    const doc = editor.doc;
    const window = previewWindow;
    const edited = doc !== previewedDoc;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        try {
          previewedDoc = doc;
          const text = await editor.preview(window ?? undefined);
          if (cancelled) return;
          const old = untrack(() => trackUrl);
          trackUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
          if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
        } catch {
          // The editor reports worker failures through validation.
        }
      },
      edited && untrack(() => trackUrl) ? PREVIEW_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  $effect(() => () => {
    if (trackUrl) URL.revokeObjectURL(trackUrl);
  });

  // Selecting a cue moves the playhead to it.
  $effect(() => {
    const selected = editor.selected;
    if (selected === followed) {
      followed = -1;
      return;
    }
    if (!player.sync || !player.element) return;
    const cue = untrack(() => editor.selectedCue);
    if (cue) untrack(() => player.seek(cue.startMs));
  });

  function tick(now: number): void {
    const media = player.element;
    if (!media) return;
    player.readTime();
    const cue = editor.selectedCue;
    if (player.loop && cue) {
      const target = loopTarget(cue, player.currentMs);
      if (target !== null) player.seek(target);
    } else if (player.sync && now - lastScan >= SCAN_INTERVAL_MS && !isEditing()) {
      lastScan = now;
      const inSelected = cue && cue.startMs <= player.currentMs && player.currentMs < cue.endMs;
      if (!inSelected) {
        const active = cueAt(editor.doc, editor.cueRows, player.currentMs);
        if (active !== -1) {
          followed = active;
          editor.selected = active;
        }
      }
    }
    if (!media.paused) frame = requestAnimationFrame(tick);
  }

  function onplay(): void {
    player.paused = false;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }

  function onpause(): void {
    player.paused = true;
    cancelAnimationFrame(frame);
    player.readTime();
  }

  function onloadedmetadata(event: Event): void {
    const media = event.currentTarget as HTMLVideoElement;
    player.durationMs = Number.isFinite(media.duration) ? media.duration * 1000 : 0;
    player.isAudio = media.videoWidth === 0;
    media.playbackRate = player.rate;
    player.error = null;
  }

  function onerror(): void {
    player.error = `This browser cannot play ${player.name}. Try another format (MP4/H.264, WebM or MP3 play almost everywhere).`;
  }

  /** Shows a newly added preview track (dynamically added tracks start disabled). */
  function showTrack(node: HTMLTrackElement): void {
    const show = (): void => {
      const tracks = player.element?.textTracks;
      if (tracks) for (const t of tracks) if (t !== node.track) t.mode = 'disabled';
      node.track.mode = 'showing';
    };
    show();
    node.addEventListener('load', show);
  }

  const playLabel = $derived(player.paused ? 'Play' : 'Pause');
</script>

<section class="media" aria-label="Media">
  <!-- svelte-ignore a11y_media_has_caption (captions are the document being edited) -->
  <video
    bind:this={player.element}
    class:audio={player.isAudio}
    src={player.url}
    controls
    playsinline
    preload="metadata"
    {onplay}
    {onpause}
    onseeked={() => player.readTime()}
    ontimeupdate={() => player.paused && player.readTime()}
    {onloadedmetadata}
    {onerror}
  >
    {#if trackUrl && player.captions}
      {#key trackUrl}
        <track kind="captions" label="Preview" src={trackUrl} use:showTrack />
      {/key}
    {/if}
  </video>

  {#if player.error}
    <p class="error-text" role="alert">{player.error}</p>
  {/if}

  <div class="controls">
    <button class="play" onclick={() => player.toggle()} title="{playLabel} (Space or K)"
      >{playLabel}</button
    >
    <button onclick={() => player.skip(-1000)} title="Back 1 second (J)" aria-label="Back 1 second"
      >−1 s</button
    >
    <button
      onclick={() => player.skip(1000)}
      title="Forward 1 second (L)"
      aria-label="Forward 1 second">+1 s</button
    >
    <span class="time" aria-label="Playhead">{formatTime(player.currentMs)}</span>
    <label class="rate">
      <span class="visually-hidden">Playback speed</span>
      <select
        value={player.rate}
        onchange={(e) => player.setRate(Number(e.currentTarget.value))}
        title="Playback speed"
      >
        {#each RATES as r (r)}<option value={r}>{r}×</option>{/each}
      </select>
    </label>
  </div>
  <div class="controls">
    <button
      onclick={() => editor.setTime('startMs', player.currentMs)}
      disabled={!editor.selectedCue}
      title="Set the selected cue’s start to the playhead ([)">Set start</button
    >
    <button
      onclick={() => editor.setTime('endMs', player.currentMs)}
      disabled={!editor.selectedCue}
      title="Set the selected cue’s end to the playhead (])">Set end</button
    >
    <label title="Repeat the selected cue (R)"
      ><input type="checkbox" bind:checked={player.loop} /> Loop cue</label
    >
    <label title="Select the cue being played, and play from the cue you select"
      ><input type="checkbox" bind:checked={player.sync} /> Sync list</label
    >
    <label title="Show the document as captions over the media"
      ><input type="checkbox" bind:checked={player.captions} /> Captions</label
    >
  </div>
  <p class="name muted">
    <span title={player.name}>{player.name}</span>
    {#if player.durationMs > 0}· {formatTime(Math.round(player.durationMs))}{/if}
    <button class="link" onclick={() => player.unload()}>Close</button>
  </p>
</section>

<style>
  .media {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  video {
    width: 100%;
    max-height: 45vh;
    background: #000;
    border-radius: var(--radius);
  }
  video.audio {
    /* Room for captions over audio-only files. */
    aspect-ratio: 16 / 9;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
    font-size: 0.9rem;
  }
  .controls button {
    padding: 0.2rem 0.55rem;
  }
  .play {
    min-width: 4.5rem;
  }
  .time {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .rate {
    margin-left: auto;
  }
  .name {
    margin: 0;
    font-size: 0.85rem;
    display: flex;
    gap: 0.3rem;
    align-items: baseline;
    min-width: 0;
  }
  .name span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .link {
    margin-left: auto;
    border: none;
    background: none;
    padding: 0;
    color: var(--info);
    text-decoration: underline;
  }
</style>
