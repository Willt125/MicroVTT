<!--
  Timing for many cues at once: shift by an amount, two-point resync (fixes subtitles timed for
  another cut or speed), and frame-rate change. Applies to every cue or to the selected ones,
  as one undo step; word timings move with their cues.
-->
<script lang="ts">
  import { syncMap, type Cue } from '@microvtt/core';
  import type { Editor, Scope } from '../editor.svelte.ts';
  import type { Player } from '../player.svelte.ts';
  import { FRAME_RATES } from '../frames.ts';
  import { formatShift, formatTime, parseSignedTime, parseTimeInput } from '../time.ts';

  interface Props {
    editor: Editor;
    player: Player;
    open: boolean;
  }

  let { editor, player, open = $bindable() }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();

  type Mode = 'shift' | 'resync' | 'rate';
  let mode = $state<Mode>('shift');
  let scope = $state<Scope>('all');
  let shiftText = $state('');
  /** Cue numbers (1-based rows) and the times their starts should move to. */
  let row1 = $state(1);
  let row2 = $state(1);
  let to1 = $state('');
  let to2 = $state('');
  let fromRate = $state(String(25));
  let toRate = $state(String(24_000 / 1001));
  let message = $state<string | null>(null);

  const cueAtRow = (row: number): Cue | null => {
    const i = editor.cueRows[row - 1];
    return i === undefined ? null : (editor.doc.body[i] as Cue);
  };

  // On opening: the selection as scope when several cues are selected, and the resync points
  // on the first and last cue of that scope.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      scope = editor.multiple ? 'selected' : 'all';
      const rows = (scope === 'selected' ? editor.selection : editor.cueRows).map(
        (i) => editor.cueRows.indexOf(i) + 1,
      );
      row1 = rows[0] ?? 1;
      row2 = rows.at(-1) ?? 1;
      to1 = formatTime(cueAtRow(row1)?.startMs ?? 0);
      to2 = formatTime(cueAtRow(row2)?.startMs ?? 0);
      shiftText = '';
      message = null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  const shiftMs = $derived(parseSignedTime(shiftText));
  const cue1 = $derived(cueAtRow(row1));
  const cue2 = $derived(cueAtRow(row2));

  /** The resync points, or an explanation of what is wrong with them. */
  const points = $derived.by(() => {
    const t1 = parseTimeInput(to1);
    const t2 = parseTimeInput(to2);
    if (!cue1 || !cue2) return `There is no cue ${!cue1 ? row1 : row2}.`;
    if (t1 === null || t2 === null) return `"${t1 === null ? to1 : to2}" is not a time.`;
    const a = { fromMs: cue1.startMs, toMs: t1 };
    const b = { fromMs: cue2.startMs, toMs: t2 };
    try {
      return { a, b, factor: syncMap(a, b).factor };
    } catch (error) {
      return (error as Error).message + '.';
    }
  });

  const rateFactor = $derived(Number(fromRate) / Number(toRate));

  /** The earliest start among the cues the scope covers. */
  function firstStart(): number | null {
    const indices = scope === 'selected' ? editor.selection : editor.cueRows;
    const starts = indices.map((i) => (editor.doc.body[i] as Cue).startMs);
    return starts.length ? Math.min(...starts) : null;
  }

  function shiftToPlayhead(): void {
    const first = firstStart();
    if (first !== null) shiftText = formatShift(player.currentMs - first).replace(' s', '');
  }

  function apply(): void {
    message = null;
    if (mode === 'shift') {
      if (shiftMs === null || shiftMs === 0) {
        message = 'Enter an amount to shift by, such as -1.5 or +0:02.250.';
        return;
      }
      const applied = editor.shift(shiftMs, scope);
      if (applied !== shiftMs) {
        message = `Shifted by ${formatShift(applied)} only, so that no cue starts before 0.`;
        return;
      }
    } else if (mode === 'resync') {
      if (typeof points === 'string') {
        message = points;
        return;
      }
      editor.resync(points.a, points.b, scope);
    } else {
      if (!(rateFactor > 0) || !Number.isFinite(rateFactor)) return;
      editor.resync(
        { fromMs: 0, toMs: 0 },
        { fromMs: 1_000_000, toMs: 1_000_000 * rateFactor },
        scope,
      );
    }
    open = false;
  }

  const rateText = (fps: number): string =>
    FRAME_RATES.find((r) => r.fps === fps)?.label ?? String(fps);
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="timing-heading"
>
  <h2 id="timing-heading">Timing</h2>

  <fieldset>
    <legend>Apply to</legend>
    <label
      ><input type="radio" bind:group={scope} value="all" /> All cues ({editor.cueRows.length.toLocaleString()})</label
    >
    <label
      ><input
        type="radio"
        bind:group={scope}
        value="selected"
        disabled={editor.selection.length === 0}
      />
      Selected cues ({editor.selection.length.toLocaleString()})</label
    >
  </fieldset>

  <fieldset>
    <legend>Change</legend>
    <label><input type="radio" bind:group={mode} value="shift" /> Shift</label>
    <label><input type="radio" bind:group={mode} value="resync" /> Two-point resync</label>
    <label><input type="radio" bind:group={mode} value="rate" /> Frame rate change</label>
  </fieldset>

  {#if mode === 'shift'}
    <div class="form">
      <label>
        Shift by (seconds, or m:ss.ttt; negative is earlier)
        <input class="time" bind:value={shiftText} placeholder="-1.5" />
      </label>
      {#if player.hasMedia}
        <button onclick={shiftToPlayhead}>First cue to the playhead</button>
      {/if}
      {#if shiftMs !== null && shiftMs !== 0}<p class="muted">{formatShift(shiftMs)}</p>{/if}
    </div>
  {:else if mode === 'resync'}
    <p class="muted">
      Pick two cues far apart whose correct start times you know: everything in between is moved and
      stretched in proportion. This fixes subtitles timed for another cut or speed.
    </p>
    <table>
      <thead>
        <tr><th>Cue</th><th>Starts now</th><th>Should start at</th><th></th></tr>
      </thead>
      <tbody>
        {#each [1, 2] as n (n)}
          {@const cue = n === 1 ? cue1 : cue2}
          <tr>
            <td>
              {#if n === 1}
                <input
                  type="number"
                  min="1"
                  max={editor.cueRows.length}
                  bind:value={row1}
                  aria-label="First cue number"
                />
              {:else}
                <input
                  type="number"
                  min="1"
                  max={editor.cueRows.length}
                  bind:value={row2}
                  aria-label="Second cue number"
                />
              {/if}
            </td>
            <td class="time">{cue ? formatTime(cue.startMs) : '—'}</td>
            <td>
              {#if n === 1}
                <input class="time" bind:value={to1} aria-label="First cue's correct start" />
              {:else}
                <input class="time" bind:value={to2} aria-label="Second cue's correct start" />
              {/if}
            </td>
            <td>
              {#if player.hasMedia}
                <button
                  onclick={() =>
                    n === 1
                      ? (to1 = formatTime(player.currentMs))
                      : (to2 = formatTime(player.currentMs))}>Playhead</button
                >
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="muted" role="status">
      {#if typeof points === 'string'}
        {points}
      {:else}
        Times are scaled by {points.factor.toFixed(5)} and moved so both cues land where given.
      {/if}
    </p>
  {:else}
    <p class="muted">
      For subtitles timed against a video at another frame rate (often 25 fps against 23.976): all
      times are scaled by the ratio of the rates.
    </p>
    <div class="form">
      <label>
        Timed for
        <select bind:value={fromRate}>
          {#each FRAME_RATES as r (r.label)}<option value={String(r.fps)}>{r.label}</option>{/each}
        </select>
      </label>
      <label>
        Video is
        <select bind:value={toRate}>
          {#each FRAME_RATES as r (r.label)}<option value={String(r.fps)}>{r.label}</option>{/each}
        </select>
      </label>
    </div>
    <p class="muted" role="status">
      {rateText(Number(fromRate))} → {rateText(Number(toRate))}: times × {rateFactor.toFixed(5)}
    </p>
  {/if}

  {#if message}<p class="error-text" role="alert">{message}</p>{/if}

  <div class="actions">
    <button onclick={() => (open = false)}>Cancel</button>
    <button class="primary" onclick={apply}>Apply</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--control);
    border-radius: var(--radius);
    width: min(36rem, 92vw);
    max-height: 85vh;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  h2 {
    margin-top: 0;
    font-size: 1.1rem;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0 0 0.75rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
  }
  legend {
    font-weight: 600;
    padding: 0;
    margin-bottom: 0.25rem;
  }
  .form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.5rem 1rem;
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.9rem;
  }
  .time {
    font-family: var(--mono);
    width: 9.5rem;
  }
  table {
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    font-weight: normal;
    padding: 0 0.75rem 0.25rem 0;
  }
  td {
    padding: 0.15rem 0.75rem 0.15rem 0;
  }
  input[type='number'] {
    width: 5rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
</style>
