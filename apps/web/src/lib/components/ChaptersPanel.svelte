<!--
  Chapters mode: the outline of the chapters (nested ones indented), adding a chapter at the
  playhead, making the chapters follow each other, and chapter lists ("0:00 Intro" lines, as
  video sites read them from a description) in and out.
-->
<script lang="ts">
  import {
    chapterList,
    chapterOutline,
    chaptersFromList,
    formatListTime,
    makeChaptersContinuous,
    parseChapterList,
    splitChapterAt,
    type BodyItem,
  } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import type { Player } from '../player.svelte.ts';

  interface Props {
    editor: Editor;
    player: Player;
    /** Selects a cue and moves focus to the table. */
    onjump: (bodyIndex: number) => void;
  }

  let { editor, player, onjump }: Props = $props();
  let message = $state<string | null>(null);
  let listText = $state('');
  const LIST_EXAMPLE = ['0:00 Intro', '1:15 The problem', '4:30 Fixing it'].join('\n');
  let copied = $state(false);

  const outline = $derived(chapterOutline(editor.doc));
  const crossing = $derived(outline.filter((c) => c.crosses).length);
  /** The media's end, when media is open: where the last chapter ends. */
  const endMs = $derived(player.hasMedia && player.durationMs > 0 ? player.durationMs : undefined);
  const continuous = $derived(makeChaptersContinuous(editor.doc, endMs) === editor.doc);
  const parsed = $derived(parseChapterList(listText));
  const out = $derived(chapterList(editor.doc));

  function add(): void {
    const top = outline.filter((c) => c.depth === 0);
    const at = player.hasMedia ? player.currentMs : Math.max(0, ...top.map((c) => c.cue.endMs), 0);
    try {
      const { document, index } = splitChapterAt(
        editor.doc,
        at,
        `Chapter ${outline.length + 1}`,
        endMs,
      );
      editor.apply(document, 'Add chapter', { select: index });
      message = null;
    } catch (error) {
      message = (error as Error).message;
    }
  }

  function replaceWithList(): void {
    const cues = chaptersFromList(parsed.chapters, endMs);
    if (cues.length === 0) return;
    const existing = outline.length;
    if (
      existing > 0 &&
      !confirm(
        `Replace the ${existing} ${existing === 1 ? 'chapter' : 'chapters'} with the ${cues.length} in the list?`,
      )
    )
      return;
    // Comments stay, ahead of the chapters.
    const notes = editor.doc.body.filter((i) => i.type !== 'cue');
    const body: BodyItem[] = [...notes, ...cues];
    editor.apply({ ...editor.doc, body }, 'Import chapter list', { select: notes.length });
    listText = '';
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(out.text);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      message = 'The browser did not allow copying; select the list and copy it.';
    }
  }
</script>

<aside class="panel" aria-labelledby="chapters-heading">
  <h2 id="chapters-heading">Chapters</h2>

  {#if outline.length === 0}
    <p class="muted small">
      No chapters yet. Add one at the playhead, or paste a chapter list below.
    </p>
  {:else}
    <ol class="outline" aria-label="Chapter outline">
      {#each outline as c (c.index)}
        <li style:padding-left="{c.depth * 1.1}rem">
          <button
            class="item"
            class:current={c.index === editor.selected}
            aria-current={c.index === editor.selected ? 'true' : undefined}
            onclick={() => onjump(c.index)}
          >
            <span class="time">{formatListTime(c.cue.startMs)}</span>
            <span class="title">{c.title || '(untitled)'}</span>
            {#if c.crosses}<span
                class="warning-text"
                title="Overlaps another chapter without containing it">overlaps</span
              >{/if}
          </button>
        </li>
      {/each}
    </ol>
    {#if crossing > 0}
      <p class="warning-text small">
        {crossing} chapters overlap without one containing the other. Chapters must nest or follow each
        other; “Make continuous” fixes the top level.
      </p>
    {/if}
  {/if}

  <div class="row">
    <button
      onclick={add}
      title={player.hasMedia
        ? 'Start a chapter at the playhead (splitting the chapter there)'
        : 'Add a chapter after the last one'}
      >{player.hasMedia ? 'Add at playhead' : 'Add chapter'}</button
    >
    <button
      onclick={() =>
        editor.apply(makeChaptersContinuous(editor.doc, endMs), 'Make chapters continuous')}
      disabled={outline.length === 0 || continuous}
      title="Each top-level chapter ends where the next starts; the first starts at 0:00{endMs
        ? ' and the last ends with the media'
        : ''}">Make continuous</button
    >
  </div>
  {#if message}<p class="error-text small" role="alert">{message}</p>{/if}

  <details class="list-in">
    <summary>Import a chapter list</summary>
    <p class="muted small">
      One chapter per line, its time before or after the title: “0:00 Intro”, “1:02:03 - Part two”.
      Each chapter ends where the next starts{endMs ? ', the last with the media' : ''}.
    </p>
    <textarea
      aria-label="Chapter list to import"
      rows="5"
      bind:value={listText}
      placeholder={LIST_EXAMPLE}></textarea>
    {#if listText.trim() !== ''}
      <p class="small" role="status">
        {parsed.chapters.length}
        {parsed.chapters.length === 1 ? 'chapter' : 'chapters'} read{parsed.skipped.length > 0
          ? `; ${parsed.skipped.length} ${parsed.skipped.length === 1 ? 'line' : 'lines'} without a time left out (line ${parsed.skipped.join(', ')})`
          : ''}.
      </p>
    {/if}
    <button class="primary" disabled={parsed.chapters.length === 0} onclick={replaceWithList}
      >{outline.length > 0 ? 'Replace chapters' : 'Make chapters'}</button
    >
  </details>

  {#if outline.length > 0}
    <details class="list-out">
      <summary>Copy as a chapter list</summary>
      <textarea aria-label="Chapter list" rows="5" readonly value={out.text}></textarea>
      <div class="row">
        <button onclick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {#if out.nestedLeftOut > 0 || out.notes.length > 0}
        <ul class="small notes" aria-label="Notes on the list">
          {#if out.nestedLeftOut > 0}
            <li>
              {out.nestedLeftOut} nested {out.nestedLeftOut === 1 ? 'chapter is' : 'chapters are'} left
              out: lists have one level.
            </li>
          {/if}
          {#each out.notes as note (note)}<li>YouTube: {note}</li>{/each}
        </ul>
      {/if}
    </details>
  {/if}
</aside>

<style>
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.75rem;
    overflow-y: auto;
    min-height: 0;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.25rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .outline {
    list-style: none;
    margin: 0 0 0.4rem;
    padding: 0;
    max-height: 16rem;
    overflow-y: auto;
  }
  .item {
    width: 100%;
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    text-align: left;
    border: 1px solid transparent;
    background: none;
    padding: 0.1rem 0.3rem;
  }
  .item.current {
    border-color: var(--accent);
    background: var(--selected, transparent);
  }
  .time {
    font-variant-numeric: tabular-nums;
    min-width: 3.5rem;
  }
  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0.35rem 0;
  }
  details {
    margin-top: 0.4rem;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 0.85rem;
  }
  .notes {
    margin: 0.25rem 0 0;
    padding-left: 1.2rem;
  }
</style>
