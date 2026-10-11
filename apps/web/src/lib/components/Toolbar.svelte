<script lang="ts">
  import type { Editor } from '../editor.svelte.ts';
  import { SYSTEM, THEMES } from '../themes.ts';

  interface Props {
    editor: Editor;
    theme: string;
    mod: string;
    onopen: () => void;
    onmedia: () => void;
    onexport: () => void;
    onsplit: () => void;
    onfind: () => void;
    ontiming: () => void;
    onstyles: () => void;
    oncleanup: () => void;
    onglossary: () => void;
    onhelp: () => void;
  }

  let {
    editor,
    theme = $bindable(),
    mod,
    onopen,
    onmedia,
    onexport,
    onsplit,
    onfind,
    ontiming,
    onstyles,
    oncleanup,
    onglossary,
    onhelp,
  }: Props = $props();

  const AUTOSAVE_TEXT = {
    idle: '',
    saved: 'autosaved',
    unsupported: 'autosave unavailable',
    failed: 'autosave failed',
  } as const;
  const AUTOSAVE_TITLE = {
    idle: '',
    saved: 'Your edits are kept in this browser until you save, in case the tab closes.',
    unsupported:
      'This browser does not offer storage for autosave here (for example in a private window).',
    failed: 'The last autosave could not be written; your edits are still open here.',
  } as const;
</script>

<header class="toolbar">
  <div class="group">
    <button onclick={() => editor.newDocument()} title="Start an empty file">New</button>
    <button onclick={onopen} title="Open a .vtt or .srt file ({mod}O)">Open…</button>
    <button
      onclick={onmedia}
      disabled={!editor.hasDocument}
      title="Open an audio or video file to time cues against">Media…</button
    >
    <button
      class="primary"
      onclick={onexport}
      disabled={!editor.hasDocument}
      title="Export a .vtt or .srt file ({mod}S)">Export…</button
    >
  </div>
  <div class="group" aria-label="Edit">
    <button onclick={() => editor.undo()} disabled={!editor.canUndo} title="Undo ({mod}Z)"
      >Undo</button
    >
    <button onclick={() => editor.redo()} disabled={!editor.canRedo} title="Redo ({mod}Shift+Z)"
      >Redo</button
    >
    <button
      onclick={() => editor.addCue()}
      disabled={!editor.hasDocument}
      title="Add a cue after the selected one">Add cue</button
    >
    <button
      onclick={() => editor.deleteSelected()}
      disabled={!editor.selectedCue}
      title="Delete the selected cues (Delete)">Delete</button
    >
    <button onclick={onsplit} disabled={!editor.selectedCue} title="Split the selected cue (S)"
      >Split</button
    >
    <button
      onclick={() => editor.mergeWithNext()}
      disabled={!editor.canMerge}
      title="Merge the selected cues, or the selected cue with the next one (M)">Merge</button
    >
    <button onclick={onfind} disabled={!editor.hasDocument} title="Find and replace ({mod}F)"
      >Find</button
    >
    <button
      onclick={ontiming}
      disabled={editor.cueRows.length === 0}
      title="Shift, resync or change the frame rate of all or the selected cues">Timing…</button
    >
    <button
      onclick={onstyles}
      disabled={!editor.hasDocument || !editor.format.styleSheets}
      title={editor.format.styleSheets
        ? 'Edit the CSS for the cues (STYLE blocks)'
        : `${editor.format.name} files have no style sheets`}>Styles…</button
    >
  </div>
  <div class="group" aria-label="Auto-captions">
    <button
      onclick={oncleanup}
      disabled={!editor.hasDocument || editor.format.id !== 'webvtt'}
      title={editor.format.id === 'webvtt'
        ? 'De-roll YouTube auto-captions and re-segment them into readable cues'
        : 'Cleanup is for WebVTT auto-captions; export this file as WebVTT first'}>Clean up…</button
    >
    <button
      onclick={onglossary}
      disabled={!editor.hasDocument}
      title="Corrections applied to the whole file (saved in this browser)">Glossary…</button
    >
  </div>
  <p class="status" aria-live="polite">
    {#if editor.busy}
      {editor.busy}
    {:else if editor.hasDocument}
      <strong>{editor.fileName}</strong>{editor.dirty ? ' • edited' : ''}
      <span class="muted"
        >· {editor.cueRows.length.toLocaleString()}
        {editor.cueRows.length === 1 ? 'cue' : 'cues'}</span
      >
      {#if editor.dirty && editor.autosaveStatus !== 'idle'}
        <span
          class={editor.autosaveStatus === 'saved' ? 'muted' : 'warning-text'}
          title={AUTOSAVE_TITLE[editor.autosaveStatus]}
          >· {AUTOSAVE_TEXT[editor.autosaveStatus]}</span
        >
      {/if}
    {/if}
  </p>
  <button onclick={onhelp} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
  <label class="theme">
    Theme
    <select bind:value={theme}>
      <option value={SYSTEM}>System</option>
      <optgroup label="Light">
        {#each THEMES.filter((t) => t.scheme === 'light') as t (t.id)}<option value={t.id}
            >{t.name}</option
          >{/each}
      </optgroup>
      <optgroup label="Dark">
        {#each THEMES.filter((t) => t.scheme === 'dark') as t (t.id)}<option value={t.id}
            >{t.name}</option
          >{/each}
      </optgroup>
    </select>
  </label>
</header>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .group {
    display: flex;
    gap: 0.35rem;
  }
  .status {
    margin: 0;
    flex: 1;
    min-width: 10rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
</style>
