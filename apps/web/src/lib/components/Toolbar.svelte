<script lang="ts">
  import type { Editor } from '../editor.svelte.ts';
  import { SYSTEM, THEMES } from '../themes.ts';

  interface Props {
    editor: Editor;
    theme: string;
    onopen: () => void;
    onexport: () => void;
  }

  let { editor, theme = $bindable(), onopen, onexport }: Props = $props();

  const mod =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
</script>

<header class="toolbar">
  <div class="group">
    <button onclick={() => editor.newDocument()} title="Start an empty file">New</button>
    <button onclick={onopen} title="Open a .vtt file ({mod}O)">Open…</button>
    <button
      class="primary"
      onclick={onexport}
      disabled={!editor.hasDocument}
      title="Export a conforming .vtt ({mod}S)">Export…</button
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
      title="Delete the selected cue (Delete)">Delete</button
    >
  </div>
  <p class="status" aria-live="polite">
    {#if editor.busy}
      {editor.busy}
    {:else if editor.hasDocument}
      <strong>{editor.fileName}</strong>{editor.dirty ? ' • edited' : ''}
      <span class="muted">· {editor.cueRows.length.toLocaleString()} cues</span>
    {/if}
  </p>
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
