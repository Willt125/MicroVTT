<!--
  The video's shot changes: how many are marked, importing a list from another tool (Subtitle
  Edit, ffmpeg's scene detection, timecodes), saving the list, and clearing it. Marking one at
  the playhead is the C key; the timeline draws them and cue edges snap to them.
-->
<script lang="ts">
  import { formatShotChanges, formatTimestamp, parseShotChanges } from '@microvtt/core';
  import type { ShotChangeUnit } from '@microvtt/core';
  import type { Player } from '../player.svelte.ts';
  import type { ShotChanges } from '../shotchanges.svelte.ts';
  import { rateLabel } from '../frames.ts';

  interface Props {
    shots: ShotChanges;
    player: Player;
    /** The frame rate, when known: needed for lists in frames, and to snap times to frames. */
    fps: number | null;
    open: boolean;
  }

  let { shots, player, fps, open = $bindable() }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let text = $state('');
  let unit = $state<ShotChangeUnit>('seconds');
  let replace = $state(true);
  let status = $state('');

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      text = '';
      status = '';
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  const preview = $derived(text.trim() === '' ? null : parseShotChanges(text, { unit, fps }));

  function use(): void {
    if (!preview) return;
    const { times, skipped, problem } = preview;
    if (times.length === 0) {
      status = problem ?? 'No times found in the list.';
      return;
    }
    shots.set(replace ? times : [...shots.times, ...times]);
    const n = times.length.toLocaleString();
    status =
      `${replace ? 'Imported' : 'Added'} ${n} shot ${times.length === 1 ? 'change' : 'changes'}.` +
      (skipped > 0 ? ` ${skipped} ${skipped === 1 ? 'line was' : 'lines were'} not a time.` : '') +
      (problem ? ` ${problem}` : '');
    text = '';
  }

  async function pick(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) text = await file.text();
  }

  function save(): void {
    const url = URL.createObjectURL(
      new Blob([formatShotChanges(shots.times)], { type: 'text/plain;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${player.name.replace(/\.[^.]+$/, '') || 'video'}.shotchanges`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function clear(): void {
    const n = shots.times.length;
    shots.set([]);
    status = `Cleared ${n.toLocaleString()} shot ${n === 1 ? 'change' : 'changes'}.`;
  }

  const first = $derived(shots.times.slice(0, 3).map((t) => formatTimestamp(t)));
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="shots-heading"
>
  <h2 id="shots-heading">Shot changes</h2>
  <p class="muted intro">
    The cuts in the video, for timing cues to them (Netflix’s rules are checked when a Netflix
    ruleset is chosen). Press <kbd>C</kbd> to mark one at the playhead: step to the first frame of
    the new shot first (<kbd>,</kbd> and <kbd>.</kbd>). Kept in this browser for this video.
  </p>
  <p>
    <strong>{shots.times.length.toLocaleString()}</strong>
    marked{#if first.length > 0}: {first.join(', ')}{shots.times.length > 3 ? ', …' : ''}{/if}.
    {#if fps}Frame rate {rateLabel(fps)}.{:else}<span class="muted"
        >Choose the frame rate in the media panel to snap them to frames.</span
      >{/if}
  </p>

  <fieldset>
    <legend>Import a list</legend>
    <p class="muted">
      A Subtitle Edit <code>.shotchanges</code> file, the log of ffmpeg’s scene detection (<code
        >-vf "select='gt(scene,0.3)',showinfo"</code
      >), ffprobe output, or one time per line (<code>12.345</code>, <code>00:00:12.345</code>,
      <code>00:00:12:08</code>).
    </p>
    <p class="row">
      <button onclick={() => fileInput?.click()}>Open a list…</button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".shotchanges,.txt,.log,.csv,text/plain"
        hidden
        onchange={(e) => void pick(e)}
      />
      <label
        >Plain numbers are
        <select bind:value={unit}>
          <option value="seconds">seconds</option>
          <option value="milliseconds">milliseconds</option>
          <option value="frames">frames</option>
        </select></label
      >
    </p>
    <textarea
      bind:value={text}
      rows="5"
      aria-label="Shot-change list"
      placeholder="Or paste it here"></textarea>
    <p class="row">
      <label><input type="checkbox" bind:checked={replace} /> Replace the marked ones</label>
      <button class="primary" disabled={!preview || preview.times.length === 0} onclick={use}
        >{replace ? 'Import' : 'Add'}{preview
          ? ` ${preview.times.length.toLocaleString()}`
          : ''}</button
      >
      {#if preview?.problem}<span class="muted">{preview.problem}</span>{/if}
    </p>
  </fieldset>

  <p class="status" aria-live="polite">{status}</p>

  <div class="actions">
    <button disabled={shots.times.length === 0} onclick={clear}>Clear all</button>
    <button
      disabled={shots.times.length === 0}
      onclick={save}
      title="As a Subtitle Edit .shotchanges file (seconds, one per line)">Save list…</button
    >
    <span class="spacer"></span>
    <button onclick={() => (open = false)}>Close</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--control);
    border-radius: var(--radius);
    width: min(40rem, 94vw);
    max-height: 90vh;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  h2 {
    margin-top: 0;
    font-size: 1.1rem;
  }
  .intro {
    margin-top: 0;
    font-size: 0.9rem;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }
  textarea {
    width: 100%;
    font-family: var(--mono);
  }
  .status:empty {
    display: none;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .spacer {
    flex: 1;
  }
</style>
