<!--
  Auto-caption cleanup: de-roll YouTube's roll-up captions and re-segment them by rules. The
  preview runs the real cleanup in the worker; Apply replaces the document as one undo step.
-->
<script lang="ts">
  import type { CleanupOptions, CleanupResult, Cue } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import { plainText } from '../display.ts';
  import { formatTime } from '../time.ts';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let checking = $state(false);
  let result = $state.raw<CleanupResult | null>(null);
  let failure = $state<string | null>(null);

  // Options (seconds in the form, milliseconds for the engine).
  let maxLineLength = $state(42);
  let maxLines = $state(2);
  let minDuration = $state(1);
  let maxDuration = $state(7);
  let maxCharsPerSecond = $state(20);
  let wordHold = $state(2);
  let breakOnSpeakerChange = $state(true);
  let wordBreaks = $state(false);
  let keepWordTimings = $state(true);
  let keepCueSettings = $state(false);
  let collapseSpaces = $state(true);
  let removeDoubledZeroWidthSpaces = $state(true);

  const info = $derived(editor.autoCaptions);
  const approximate = $derived(info?.approximateTimings ?? false);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void prepare();
    }
    if (!open && dialog.open) dialog.close();
  });

  async function prepare(): Promise<void> {
    if (!editor.autoCaptions) {
      checking = true;
      await editor.detectAutoCaptions();
      checking = false;
    }
    // Translations' word times are estimates: default to line breaks and no timing tags.
    keepWordTimings = !approximate;
    wordBreaks = false;
  }

  const options = $derived<Partial<CleanupOptions>>({
    maxLineLength,
    maxLines,
    minDurationMs: Math.round(minDuration * 1000),
    maxDurationMs: Math.round(maxDuration * 1000),
    maxCharsPerSecond,
    maxWordHoldMs: Math.round(wordHold * 1000),
    breakOnSpeakerChange,
    unit: approximate && !wordBreaks ? 'line' : 'word',
    keepWordTimings,
    keepCueSettings,
    collapseSpaces,
    removeDoubledZeroWidthSpaces,
  });

  const valid = $derived(
    maxLineLength >= 10 &&
      maxLines >= 1 &&
      maxDuration > 0 &&
      minDuration >= 0 &&
      minDuration <= maxDuration &&
      maxCharsPerSecond > 0 &&
      wordHold > 0,
  );

  // Re-run the preview when the options settle.
  $effect(() => {
    if (!open || !info || !valid) return;
    const current = options;
    void editor.doc;
    result = null;
    failure = null;
    const timer = setTimeout(() => {
      editor
        .previewCleanup(current)
        .then((r) => {
          if (current === options) result = r;
        })
        .catch((e: Error) => (failure = e.message));
    }, 300);
    return () => clearTimeout(timer);
  });

  const sample = $derived(
    (result?.document.body.filter((i): i is Cue => i.type === 'cue') ?? []).slice(0, 6),
  );

  function apply(): void {
    if (!result) return;
    editor.applyCleanup(result);
    open = false;
  }
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="cleanup-heading"
>
  <h2 id="cleanup-heading">Clean up auto-captions</h2>

  {#if checking}
    <p class="muted">Checking the file…</p>
  {:else if !info}
    <p>
      This file does not look like YouTube auto-captions (no rolling, repeated lines), so there is
      nothing to de-roll.
    </p>
  {:else}
    <p class="detected">
      {info.cues.toLocaleString()} cues, {info.lines.toLocaleString()} caption lines{info.language
        ? `, language ${info.language}`
        : ''}. Word timings
      {#if approximate}
        are <strong>estimates</strong> (a machine translation spaces them evenly).
      {:else}
        come from the audio.
      {/if}
    </p>

    <fieldset>
      <legend>Cue limits</legend>
      <label
        >Characters per line <input
          type="number"
          min="10"
          max="200"
          bind:value={maxLineLength}
        /></label
      >
      <label>Lines per cue <input type="number" min="1" max="5" bind:value={maxLines} /></label>
      <label
        >Shortest cue (s) <input type="number" min="0" step="0.1" bind:value={minDuration} /></label
      >
      <label
        >Longest cue (s) <input type="number" min="1" step="0.5" bind:value={maxDuration} /></label
      >
      <label
        >Reading speed (characters/s) <input
          type="number"
          min="5"
          max="60"
          bind:value={maxCharsPerSecond}
        /></label
      >
      <label
        title="A word lasts until the next one starts; before a pause, keep it on screen at most this long"
        >Hold before a pause (s) <input
          type="number"
          min="0.5"
          step="0.5"
          bind:value={wordHold}
        /></label
      >
    </fieldset>

    <fieldset class="checks">
      <legend>Breaks and output</legend>
      <label
        ><input type="checkbox" bind:checked={breakOnSpeakerChange} /> New cue at each speaker change
        (&gt;&gt;)</label
      >
      {#if approximate}
        <label title="More natural breaks, but cue times inside YouTube's lines are estimates"
          ><input type="checkbox" bind:checked={wordBreaks} /> Break between words (times become estimates)</label
        >
      {/if}
      <label title="As timestamp tags in the cue text, for karaoke-style display and later editing"
        ><input type="checkbox" bind:checked={keepWordTimings} /> Keep word timings</label
      >
      <label
        ><input type="checkbox" bind:checked={keepCueSettings} /> Keep YouTube's left-aligned positioning</label
      >
      <label><input type="checkbox" bind:checked={collapseSpaces} /> Collapse repeated spaces</label
      >
      <label
        title="A single U+200B separates words in some scripts (Thai, Khmer…) and is kept; doubled ones, and ones next to a space, are artifacts of machine translation"
        ><input type="checkbox" bind:checked={removeDoubledZeroWidthSpaces} /> Remove doubled zero-width
        spaces</label
      >
    </fieldset>

    <section class="preview" aria-live="polite">
      {#if !valid}
        <p class="error-text">
          Check the limits: the shortest cue must not be longer than the longest.
        </p>
      {:else if failure}
        <p class="error-text">Cleanup failed: {failure}</p>
      {:else if !result}
        <p class="muted">Preparing a preview…</p>
      {:else}
        <p>
          {result.report.sourceCues.toLocaleString()} cues become
          <strong>{result.report.cues.toLocaleString()}</strong>, with all
          {result.report.words.toLocaleString()} words kept.
        </p>
        <ol class="sample">
          {#each sample as cue, i (i)}
            <li>
              <span class="time">{formatTime(cue.startMs)}</span>
              <span class="text">{plainText(cue.text)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
    <p class="muted note">Applying is one step: Undo brings back the original cues.</p>
  {/if}

  <div class="actions">
    <button onclick={() => (open = false)}>Cancel</button>
    <button class="primary" disabled={!result || !valid} onclick={apply}>Apply cleanup</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--control);
    border-radius: var(--radius);
    width: min(44rem, 94vw);
    max-height: 90vh;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  h2 {
    margin-top: 0;
    font-size: 1.1rem;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-bottom: 0.75rem;
  }
  fieldset label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.88rem;
  }
  fieldset input[type='number'] {
    width: 6rem;
  }
  .checks {
    flex-direction: column;
  }
  .checks label {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
  .detected {
    margin-top: 0;
  }
  .preview p {
    margin: 0.25rem 0;
  }
  .sample {
    margin: 0.25rem 0 0;
    padding-left: 1.5rem;
    font-size: 0.88rem;
    max-height: 12rem;
    overflow-y: auto;
  }
  .sample .time {
    font-family: var(--mono);
    margin-right: 0.5rem;
  }
  .note {
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
</style>
