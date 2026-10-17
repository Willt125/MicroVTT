<script lang="ts">
  import type { FileType } from '@microvtt/core';
  import { tick } from 'svelte';
  import { baseName } from '../filename.ts';
  import { FILE_TYPES } from '../filetypes.ts';
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
    onrollup: () => void;
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
    onrollup,
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

  /** Keeps focus where it is (in the cue text) when a button is clicked. */
  const keepFocus = (event: MouseEvent): void => event.preventDefault();

  /** Renaming the file in place: the name typed so far (without the extension). */
  let renaming = $state(false);
  let draft = $state('');
  let renameError = $state<string | null>(null);
  let nameInput: HTMLInputElement | undefined = $state();

  async function startRename(): Promise<void> {
    draft = baseName(editor.fileName);
    renameError = null;
    renaming = true;
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }

  /** Enter keeps the field open on a bad name, to fix it; leaving the field drops it. */
  function commitRename(event?: FocusEvent): void {
    if (!renaming) return;
    renameError = editor.rename(draft);
    if (renameError === null || event?.type === 'blur') renaming = false;
  }
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
    {#if editor.hasDocument && editor.format.id === 'webvtt'}
      <label
        class="type"
        title="What the file holds: captions or subtitles, chapter titles, or metadata for scripts. Checks, tools and export follow it."
      >
        Type
        <select
          value={editor.fileType}
          onchange={(e) => editor.setFileType(e.currentTarget.value as FileType)}
        >
          {#each FILE_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
        </select>
      </label>
    {/if}
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
    <!-- Clicking does not take focus from the cue text, so Split still knows the text cursor. -->
    <button
      onmousedown={keepFocus}
      onclick={onsplit}
      disabled={!editor.selectedCue}
      title="Split the selected cue (S): at the text cursor when it is in the cue text"
      >Split</button
    >
    <button
      onmousedown={keepFocus}
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
      onclick={onrollup}
      disabled={editor.cueRows.length === 0}
      title="Make roll-up captions from the cues' lines (all or the selected cues)">Roll-up…</button
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
  <div class="status">
    {#if !editor.busy && editor.hasDocument}
      {#if renaming}
        <form
          class="rename"
          onsubmit={(e) => {
            e.preventDefault();
            commitRename();
          }}
        >
          <input
            bind:this={nameInput}
            bind:value={draft}
            aria-label="File name"
            aria-invalid={renameError ? 'true' : undefined}
            aria-describedby={renameError ? 'rename-error' : undefined}
            spellcheck="false"
            autocomplete="off"
            size={Math.max(8, Math.min(40, draft.length + 1))}
            onkeydown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                renaming = false;
              }
            }}
            onblur={(e) => commitRename(e)}
          /><span class="muted">{editor.format.extensions[0]}</span>
          {#if renameError}<span id="rename-error" class="error-text" role="alert"
              >{renameError}</span
            >{/if}
        </form>
      {:else}
        <button class="name" onclick={startRename} title="Rename: the name the file is saved as"
          ><strong>{editor.fileName}</strong></button
        >
      {/if}
    {/if}
    <span aria-live="polite">
      {#if editor.busy}
        {editor.busy}
      {:else if editor.hasDocument}
        {editor.dirty ? ' • edited' : ''}
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
    </span>
  </div>
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
  .type {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .status {
    margin: 0;
    flex: 1;
    min-width: 10rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .name {
    background: none;
    border: 1px solid transparent;
    padding: 0.1rem 0.3rem;
    margin-left: -0.3rem;
    color: inherit;
    font: inherit;
    cursor: text;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name:hover,
  .name:focus-visible {
    border-color: var(--control);
  }
  .rename {
    display: inline-flex;
    align-items: baseline;
    gap: 0.15rem;
  }
  .rename .error-text {
    margin-left: 0.5rem;
    font-size: 0.85rem;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
</style>
