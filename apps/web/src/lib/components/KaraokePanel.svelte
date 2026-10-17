<!--
  Word timing (karaoke): the timestamps in the cue's text, each the time the text after it
  starts. Edit or remove each; insert one at the cursor; spread the cue's time across its words;
  or tap the timing: play the media and tap as each word starts. Timed text can be wrapped in
  <c> so that :past and :future styles reach it.
-->
<script lang="ts">
  import {
    cuesWithUntaggedTiming,
    cueWords,
    insertTimestamp,
    removeTimestamp,
    removeTimestamps,
    setTimestamp,
    spreadWordTimes,
    timestampProblems,
    timestampTags,
    timeWords,
    wrapTimedParts,
    wrapTimedPartsInAll,
    type Cue,
  } from '@microvtt/core';
  import { tick } from 'svelte';
  import type { Editor } from '../editor.svelte.ts';
  import type { Player } from '../player.svelte.ts';
  import { formatTime, parseTimeInput } from '../time.ts';

  interface Props {
    editor: Editor;
    cue: Cue;
    player?: Player | undefined;
    /** The cursor in the text field. */
    caret: number;
    /** Replaces the cue's text; edits sharing `coalesce` are one undo step. */
    onchange: (text: string, label: string, coalesce?: string) => void;
  }

  let { editor, cue, player, caret, onchange }: Props = $props();
  let message = $state<string | null>(null);

  const language = $derived(editor.language ?? undefined);
  const tags = $derived(timestampTags(cue.text));
  const problems = $derived(
    new Map(timestampProblems(cue.text, cue.startMs, cue.endMs).map((p) => [p.index, p.message])),
  );
  const words = $derived(cueWords(cue.text, language));
  const media = $derived(player?.hasMedia ?? false);

  /** Whether this cue, and how many cues in all, have timed text that styles cannot reach. */
  const unwrapped = $derived(wrapTimedParts(cue.text) !== cue.text);
  const unwrappedCues = $derived(cuesWithUntaggedTiming(editor.doc));

  /** The word a timing starts (the first after it). */
  const wordAfter = (end: number): string => words.find((w) => w.start >= end)?.word ?? '';

  function run(change: () => void): void {
    try {
      change();
      message = null;
    } catch (error) {
      message = (error as Error).message;
    }
  }

  function setTime(index: number, input: HTMLInputElement): void {
    const ms = parseTimeInput(input.value);
    if (ms === null) {
      message = `"${input.value}" is not a time. Use h:mm:ss.ttt, m:ss.t or seconds.`;
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    input.removeAttribute('aria-invalid');
    run(() => onchange(setTimestamp(cue.text, index, ms), 'Change word timing'));
  }

  /** At the playhead with media; without, halfway between the timings either side. */
  function insertAtCaret(): void {
    let ms: number;
    if (media && player) {
      player.readTime();
      ms = player.currentMs;
    } else {
      const before = tags.filter((t) => t.end <= caret).at(-1)?.ms ?? cue.startMs;
      const after = tags.find((t) => t.start >= caret)?.ms ?? cue.endMs;
      ms = Math.round((before + after) / 2);
    }
    run(() => onchange(insertTimestamp(cue.text, caret, ms).text, 'Insert word timing'));
  }

  function spread(): void {
    const times = spreadWordTimes(cue.text, cue.startMs, cue.endMs, language);
    run(() => onchange(timeWords(cue.text, times, language), 'Spread word timings'));
  }

  // Tap timing.
  let tapping = $state(false);
  let tapBase = '';
  let tapTimes = $state<number[]>([]);
  let tapWords = $state<string[]>([]);
  let tapButton: HTMLButtonElement | undefined = $state();

  async function startTap(): Promise<void> {
    if (!player) return;
    tapBase = removeTimestamps(cue.text);
    tapWords = cueWords(tapBase, language).map((w) => w.word);
    tapTimes = [];
    tapping = true;
    player.seek(cue.startMs);
    if (player.paused) player.toggle();
    await tick();
    tapButton?.focus();
  }

  function tap(): void {
    if (!player || !tapping) return;
    player.readTime();
    tapTimes = [...tapTimes, player.currentMs];
    onchange(timeWords(tapBase, tapTimes, language), 'Tap word timings', 'tap');
    if (tapTimes.length >= tapWords.length - 1) stopTap();
  }

  function stopTap(): void {
    tapping = false;
    player?.pause();
  }

  $effect(() => {
    // Leaving the cue (the panel is rebuilt for each cue) ends tapping.
    return () => {
      if (tapping) stopTap();
    };
  });
</script>

<details class="karaoke">
  <summary>
    Word timing <span class="muted"
      >({tags.length === 0
        ? 'none'
        : `${tags.length} ${tags.length === 1 ? 'timing' : 'timings'}`}{problems.size > 0
        ? `, ${problems.size} to check`
        : ''})</span
    >
  </summary>
  <p class="muted small">
    For karaoke and paint-on: each timing is when the text after it starts. Styles can treat the
    text before and after the playhead differently (<code>::cue(:past)</code>,
    <code>::cue(:future)</code>), but only text in a tag such as <code>&lt;c&gt;</code>.
  </p>

  {#if tags.length > 0}
    <ol class="timings" aria-label="Word timings">
      {#each tags as t, i (`${i}:${t.ms}`)}
        <li>
          <input
            class="time"
            aria-label="Timing {i + 1}"
            value={formatTime(t.ms)}
            aria-invalid={problems.has(i) ? 'true' : undefined}
            onchange={(e) => setTime(i, e.currentTarget)}
            onkeydown={(e) => {
              if (e.key === 'Enter') setTime(i, e.currentTarget);
            }}
          />
          <span class="word" lang={language}>{wordAfter(t.end) || '(end)'}</span>
          {#if media && player}
            <button
              class="small"
              title="Set to the playhead"
              aria-label="Set timing {i + 1} to the playhead"
              onclick={() => {
                player.readTime();
                run(() =>
                  onchange(setTimestamp(cue.text, i, player.currentMs), 'Change word timing'),
                );
              }}>Playhead</button
            >
          {/if}
          <button
            class="small"
            aria-label="Remove timing {i + 1}"
            onclick={() => run(() => onchange(removeTimestamp(cue.text, i), 'Remove word timing'))}
            >×</button
          >
          {#if problems.has(i)}<span class="error-text small">{problems.get(i)}</span>{/if}
        </li>
      {/each}
    </ol>
  {/if}

  <div class="row">
    <button
      class="small"
      title={media
        ? 'Insert a timing at the cursor, at the playhead'
        : 'Insert a timing at the cursor, halfway between the timings either side'}
      onclick={insertAtCaret}>Insert at cursor</button
    >
    <button
      class="small"
      disabled={words.length < 2}
      title="Replace the timings with the cue’s time spread over its words by their length"
      onclick={spread}>Spread over words</button
    >
    <button
      class="small"
      disabled={tags.length === 0}
      onclick={() => run(() => onchange(removeTimestamps(cue.text), 'Remove word timings'))}
      >Remove all</button
    >
    {#if media}
      <button
        class="small"
        disabled={words.length < 2 || tapping}
        title="Play the cue and tap as each word starts"
        onclick={() => void startTap()}>Tap timing…</button
      >
    {/if}
  </div>

  {#if tags.length > 0 && (unwrapped || unwrappedCues > 0)}
    <div class="row wrap" role="group" aria-label="Wrap timed text">
      <span class="small"
        >{unwrapped ? 'Some timed text here' : 'Timed text in other cues'} is not in a tag, so
        <code>:past</code>/<code>:future</code> styles cannot reach it.</span
      >
      <button
        class="small"
        disabled={!unwrapped}
        title="Put each part of this cue's timed text in <c>"
        onclick={() => run(() => onchange(wrapTimedParts(cue.text), 'Wrap timed text in <c>'))}
        >Wrap in &lt;c&gt;</button
      >
      <button
        class="small"
        disabled={unwrappedCues === 0}
        title="Put the timed text of every cue in <c>, as one undo step"
        onclick={() => editor.apply(wrapTimedPartsInAll(editor.doc), 'Wrap timed text in <c>')}
        >In all cues ({unwrappedCues})</button
      >
    </div>
  {/if}

  {#if tapping}
    <div class="tap" role="status">
      <span>
        Tap as each word starts.
        {#if tapTimes.length + 1 < tapWords.length}
          Next: <strong lang={language}>{tapWords[tapTimes.length + 1]}</strong>
          ({tapTimes.length + 2} of {tapWords.length})
        {/if}
      </span>
      <button bind:this={tapButton} class="primary" data-keep-focus onclick={tap}>Tap</button>
      <button class="small" onclick={stopTap}>Stop</button>
    </div>
  {/if}

  {#if message}<p class="error-text small" role="alert">{message}</p>{/if}
</details>

<style>
  .karaoke {
    margin-top: 0.5rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .timings {
    margin: 0.25rem 0;
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .timings li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }
  .time {
    width: 7.5rem;
  }
  .word {
    min-width: 4rem;
  }
  .row,
  .tap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    margin-top: 0.3rem;
  }
  .tap {
    padding: 0.4rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
</style>
