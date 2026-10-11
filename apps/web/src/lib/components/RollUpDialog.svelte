<!--
  Roll-up captions from ordinary cues: each line of the cues becomes a roll-up line, shown from
  when it is spoken until newer lines push it out. Either the WebVTT way (one-line cues in a
  scroll:up region) or repeated lines (each cue shows the last few lines). Applies to the
  selected cues (a run of them) or to every cue, as one undo step.
-->
<script lang="ts">
  import { makeRollUp, type RollUpForm, type RollUpResult } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();

  let form = $state<RollUpForm>('region');
  let lines = $state(3);
  let pauseSeconds = $state(1);
  let selectedOnly = $state(false);

  /** Regions are WebVTT only; SubRip gets repeated lines. */
  const regions = $derived(editor.format.id === 'webvtt');

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      selectedOnly = editor.multiple;
      if (!regions) form = 'repeat';
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  const indices = $derived(selectedOnly ? editor.selection : editor.cueRows);

  /** What applying would do, or why it cannot. */
  const result = $derived.by((): RollUpResult | string => {
    if (!open) return '';
    if (!Number.isInteger(lines) || lines < 1) return 'Lines shown must be 1 or more.';
    if (!(pauseSeconds >= 0)) return 'The pause must be 0 seconds or more.';
    if (indices.length === 0) return 'There are no cues.';
    try {
      return makeRollUp(
        editor.doc,
        indices,
        { form: regions ? form : 'repeat', lines, clearAfterMs: Math.round(pauseSeconds * 1000) },
        editor.format.text,
      );
    } catch (error) {
      return (error as Error).message;
    }
  });

  function apply(): void {
    if (typeof result === 'string') return;
    editor.apply(result.document, 'Make roll-up captions');
    open = false;
  }
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="rollup-heading"
>
  <h2 id="rollup-heading">Roll-up captions</h2>
  <p class="muted">
    Each line of the cues becomes a roll-up line, shown from when it is spoken until newer lines
    push it out. A line's start comes from the word timing before it, or is spread over its cue by
    length.
  </p>

  <fieldset>
    <legend>Form</legend>
    <label
      ><input type="radio" bind:group={form} value="region" disabled={!regions} /> Scrolling region (WebVTT)</label
    >
    <label><input type="radio" bind:group={form} value="repeat" /> Repeated lines</label>
  </fieldset>
  <p class="muted small">
    {#if !regions}
      {editor.format.name} has no regions, so each cue repeats the lines before it.
    {:else if form === 'region'}
      One-line cues in a <code>scroll:up</code> region: lines slide up as each arrives in Firefox, Safari
      and the preview. Chrome's own captions ignore regions and show the newest line on top; YouTube drops
      regions.
    {:else}
      Each cue shows the last lines, the way YouTube's auto-captions roll. Every player shows it;
      nothing slides.
    {/if}
  </p>

  <div class="form">
    <label>
      Lines shown
      <input type="number" min="1" max="10" bind:value={lines} />
    </label>
    <label>
      Clear after a pause of (s)
      <input type="number" min="0" step="0.1" bind:value={pauseSeconds} />
    </label>
    {#if editor.multiple}
      <label class="check"
        ><input type="checkbox" bind:checked={selectedOnly} /> Only the {editor.selection.length} selected
        cues</label
      >
    {/if}
  </div>

  {#if typeof result === 'string'}
    {#if result}<p class="error-text" role="alert">{result}</p>{/if}
  {:else}
    <p class="muted" role="status">
      {indices.length}
      {indices.length === 1 ? 'cue becomes' : 'cues become'}
      {result.cues}
      {result.cues === 1 ? 'cue' : 'cues'} ({result.lines} roll-up {result.lines === 1
        ? 'line'
        : 'lines'}){result.region ? `, in a new region "${result.region}"` : ''}. Cue settings and
      ids are not kept{form === 'region' && regions ? '; the region places the lines' : ''}.
    </p>
  {/if}

  <div class="actions">
    <button onclick={() => (open = false)}>Cancel</button>
    <button class="primary" disabled={typeof result === 'string'} onclick={apply}>Apply</button>
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
    margin: 0 0 0.25rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
  }
  legend {
    font-weight: 600;
    padding: 0;
    margin-bottom: 0.25rem;
  }
  .small {
    font-size: 0.85rem;
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
  .form label.check {
    flex-direction: row;
    align-items: center;
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
