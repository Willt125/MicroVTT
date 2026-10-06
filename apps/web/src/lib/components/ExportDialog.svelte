<!--
  Export: choose options, see exactly what repair will change, then save. The preview runs the
  real export in the worker, so what is listed is what gets written.
-->
<script lang="ts">
  import type { FileType } from '@microvtt/core';
  import { DIAGNOSTICS } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import type { ExportedFile } from '../worker/protocol.ts';
  import { canSaveInPlace, download, pickSaveFile, writeFile } from '../files.ts';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  const LF = '\n';
  const CRLF = '\r\n';
  let lineEnding = $state<typeof LF | typeof CRLF>(LF);
  let omitZeroHours = $state(false);
  let result = $state.raw<ExportedFile | null>(null);
  let failure = $state<string | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  const pickers = canSaveInPlace();

  const FILE_TYPES: { value: FileType; label: string }[] = [
    { value: 'captions', label: 'Captions / subtitles' },
    { value: 'chapters', label: 'Chapters' },
    { value: 'metadata', label: 'Metadata' },
    { value: 'any', label: 'Any (structure only)' },
  ];

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  // Re-run the preview whenever the dialog opens or an option changes.
  $effect(() => {
    if (!open) return;
    const options = { lineEnding, omitZeroHours, fileType: editor.fileType };
    void editor.doc; // Also when the document changes underneath.
    result = null;
    failure = null;
    editor
      .export(options)
      .then((r) => (result = r))
      .catch((e: Error) => (failure = e.message));
  });

  const grouped = $derived.by(() => {
    const groups: Record<string, { message: string; count: number }> = {};
    for (const entry of result?.report ?? []) {
      const g = (groups[entry.code] ??= { message: entry.message, count: 0 });
      g.count++;
    }
    return Object.entries(groups);
  });

  const exportName = $derived(editor.fileName.replace(/\.[^.]*$/, '') + '.vtt');

  /** Saves through the browser's downloads. */
  function saveDownload(): void {
    if (!result) return;
    download(result.text, exportName);
    editor.markSaved();
    open = false;
  }

  /** Writes to `handle`, or to a file chosen in the save picker. */
  async function saveTo(handle: FileSystemFileHandle | null): Promise<void> {
    if (!result) return;
    saving = true;
    saveError = null;
    try {
      const target = handle ?? (await pickSaveFile(exportName));
      if (!target) return; // Cancelled.
      if (!(await writeFile(target, result.text))) {
        saveError = `Permission to write ${target.name} was not given.`;
        return;
      }
      editor.markSaved(target);
      open = false;
    } catch (error) {
      saveError = `Could not save: ${(error as Error).message}`;
    } finally {
      saving = false;
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-labelledby="export-heading">
  <h2 id="export-heading">Export {exportName}</h2>

  <fieldset>
    <legend>Options</legend>
    <label>
      File type
      <select
        value={editor.fileType}
        onchange={(e) => editor.setFileType(e.currentTarget.value as FileType)}
      >
        {#each FILE_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
      </select>
    </label>
    <label>
      Line endings
      <select bind:value={lineEnding}>
        <option value={LF}>LF (Unix, macOS, web)</option>
        <option value={CRLF}>CRLF (Windows)</option>
      </select>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={omitZeroHours} />
      Short timestamps (omit "00:" hours)
    </label>
  </fieldset>

  <section aria-live="polite">
    {#if failure}
      <p class="error-text">Export failed: {failure}</p>
    {:else if !result}
      <p class="muted">Checking…</p>
    {:else if grouped.length === 0}
      <p>The document already conforms; it is written as is.</p>
    {:else}
      <p>
        Export makes {result.report.length}
        {result.report.length === 1 ? 'change' : 'changes'} so the file conforms:
      </p>
      <ul class="report">
        {#each grouped as [code, g] (code)}
          <li>
            {g.count > 1 ? `${g.count} × ` : ''}{g.message}
            <span class="muted"
              >({DIAGNOSTICS[code as keyof typeof DIAGNOSTICS]?.rule ?? code})</span
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#if result && result.diagnostics.length > 0}
      <p class="warning-text">
        {result.diagnostics.length} warning{result.diagnostics.length === 1 ? '' : 's'} remain (valid,
        but possibly not what you meant). See the Problems panel.
      </p>
    {/if}
  </section>

  {#if saveError}
    <p class="error-text" role="alert">{saveError}</p>
  {/if}
  <div class="actions">
    <button onclick={() => (open = false)}>Cancel</button>
    {#if pickers}
      <button disabled={!result || saving} onclick={saveDownload} title="Save a copy to Downloads"
        >Download</button
      >
      {#if editor.fileHandle}
        <button disabled={!result || saving} onclick={() => saveTo(null)}>Save as…</button>
        <button
          class="primary"
          disabled={!result || saving}
          onclick={() => saveTo(editor.fileHandle)}
          title="Overwrite the file you opened">Save to {editor.fileHandle.name}</button
        >
      {:else}
        <button class="primary" disabled={!result || saving} onclick={() => saveTo(null)}
          >Save as…</button
        >
      {/if}
    {:else}
      <button class="primary" disabled={!result} onclick={saveDownload}>Save {exportName}</button>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--control);
    border-radius: var(--radius);
    width: min(40rem, 92vw);
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
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.9rem;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }
  .report {
    max-height: 40vh;
    overflow-y: auto;
    padding-left: 1.2rem;
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
</style>
