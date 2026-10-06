<script lang="ts">
  import CueEditor from './lib/components/CueEditor.svelte';
  import CueTable from './lib/components/CueTable.svelte';
  import DiagnosticsPanel from './lib/components/DiagnosticsPanel.svelte';
  import ExportDialog from './lib/components/ExportDialog.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import { Editor } from './lib/editor.svelte.ts';
  import { loadThemeChoice, resolveTheme, saveThemeChoice } from './lib/themes.ts';
  import { VttWorker } from './lib/worker/client.ts';

  const editor = new Editor(new VttWorker());

  let theme = $state(loadThemeChoice());
  let prefersDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);
  let exportOpen = $state(false);
  let dragging = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();

  $effect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent): void => {
      prefersDark = e.matches;
    };
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  });

  $effect(() => {
    document.documentElement.dataset['theme'] = resolveTheme(theme, prefersDark).id;
    saveThemeChoice(theme);
  });

  $effect(() => {
    document.title = editor.hasDocument
      ? `${editor.dirty ? '• ' : ''}${editor.fileName} — MicroVTT`
      : 'MicroVTT';
  });

  // Warn before leaving with unsaved edits.
  $effect(() => {
    const listener = (e: BeforeUnloadEvent): void => {
      if (editor.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  });

  function openPicker(): void {
    fileInput?.click();
  }

  function openExport(): void {
    if (editor.hasDocument) exportOpen = true;
  }

  async function openFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (editor.dirty && !confirm('Discard your unsaved edits and open another file?')) return;
    await editor.open(file);
  }

  function focusText(): void {
    textarea?.focus();
  }

  function jumpTo(bodyIndex: number): void {
    editor.selected = bodyIndex;
    document.querySelector<HTMLElement>('[aria-label="Cues"]')?.focus();
  }

  const isTyping = (target: EventTarget | null): boolean =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  function onkeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === 'o') {
      event.preventDefault();
      openPicker();
    } else if (key === 's') {
      event.preventDefault();
      openExport();
    } else if (!isTyping(event.target) && (key === 'z' || key === 'y')) {
      // Inside text fields the browser's own undo applies.
      event.preventDefault();
      if (key === 'y' || event.shiftKey) editor.redo();
      else editor.undo();
    }
  }
</script>

<svelte:window
  {onkeydown}
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (e.relatedTarget === null) dragging = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    void openFile(e.dataTransfer?.files[0]);
  }}
/>

<input
  class="visually-hidden"
  type="file"
  accept=".vtt,text/vtt"
  bind:this={fileInput}
  onchange={(e) => {
    void openFile(e.currentTarget.files?.[0]);
    e.currentTarget.value = '';
  }}
  tabindex="-1"
  aria-hidden="true"
/>

<div class="app">
  <Toolbar {editor} bind:theme onopen={openPicker} onexport={openExport} />

  {#if editor.error}
    <p class="banner error-text" role="alert">
      {editor.error}
      <button onclick={() => (editor.error = null)}>Dismiss</button>
    </p>
  {/if}

  {#if editor.hasDocument}
    <main class="workspace">
      <section class="cues" aria-label="Cue list and editor">
        <CueTable {editor} onedit={focusText} />
        <CueEditor {editor} bind:textarea />
      </section>
      <DiagnosticsPanel {editor} onjump={jumpTo} />
    </main>
  {:else}
    <main class="start">
      <h1>MicroVTT</h1>
      <p>Open a WebVTT (.vtt) file, drop one anywhere on this page, or start a new one.</p>
      <p class="actions">
        <button class="primary" onclick={openPicker}>Open a file…</button>
        <button onclick={() => editor.newDocument()}>New file</button>
      </p>
      <p class="muted">Everything stays on your device: files are never uploaded.</p>
    </main>
  {/if}

  {#if dragging}
    <div class="drop" aria-hidden="true">Drop a .vtt file to open it</div>
  {/if}

  <ExportDialog {editor} bind:open={exportOpen} />
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
  }
  .workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
    gap: 0.75rem;
    padding: 0.75rem;
  }
  .cues {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }
  @media (max-width: 52rem) {
    .workspace {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }
  }
  .start {
    margin: auto;
    max-width: 32rem;
    padding: 2rem 1rem;
    text-align: center;
  }
  .start .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
  .banner {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .drop {
    position: fixed;
    inset: 0.75rem;
    display: grid;
    place-items: center;
    border: 3px dashed var(--accent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    font-size: 1.3rem;
    pointer-events: none;
  }
</style>
