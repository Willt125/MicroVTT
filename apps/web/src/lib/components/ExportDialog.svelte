<!--
  Export: choose options, see exactly what repair will change, then save. The preview runs the
  real export in the worker, so what is listed is what gets written.
-->
<script lang="ts">
  import type { CompatibilityFix, CompatibilityId, FileType } from '@microvtt/core';
  import {
    COMPATIBILITY_FIXES,
    DIAGNOSTICS,
    FEATURES,
    YOUTUBE,
    YOUTUBE_FIXES,
  } from '@microvtt/core';
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
  let headerLines = $state(false);
  let result = $state.raw<ExportedFile | null>(null);
  let failure = $state<string | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  const pickers = canSaveInPlace();
  // Fixes that keep what viewers see start ticked; they only apply where the list shows them.
  let compatibility = $state<CompatibilityId[]>(
    COMPATIBILITY_FIXES.filter((f) => f.recommended).map((f) => f.id),
  );
  const fixById = (id: CompatibilityId): CompatibilityFix =>
    COMPATIBILITY_FIXES.find((f) => f.id === id) as CompatibilityFix;
  const featureName = (id: string): string => FEATURES.find((f) => f.id === id)?.name ?? id;
  const STATUS: Record<string, string> = {
    kept: 'shown as written',
    untested: 'not tested on YouTube yet',
    changed: 'shown differently',
    dropped: 'dropped',
  };

  /** Whether a fix that avoids a YouTube problem in this file is not ticked yet. */
  const youtubeFixable = $derived(
    result?.youtube.some((y) => {
      const fix = YOUTUBE[y.id].fixedBy;
      return fix !== undefined && !compatibility.includes(fix);
    }) ?? false,
  );

  /** Ticks every fix that helps on YouTube (the others stay as they are). */
  function forYouTube(): void {
    compatibility = [...new Set([...compatibility, ...YOUTUBE_FIXES])];
  }

  function toggle(id: CompatibilityId, on: boolean): void {
    compatibility = on ? [...compatibility, id] : compatibility.filter((x) => x !== id);
  }

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
    const options = {
      lineEnding,
      omitZeroHours,
      headerLines,
      fileType: editor.fileType,
      compatibility: [...compatibility],
    };
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

  const warnings = $derived(result?.diagnostics.filter((d) => d.severity !== 'error').length ?? 0);

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
    {#if result && warnings > 0}
      <p class="warning-text">
        {warnings} warning{warnings === 1 ? '' : 's'} remain (valid, but possibly not what you meant).
        See the Problems panel.
      </p>
    {/if}
    {#if result && headerLines && result.diagnostics.some((d) => d.code === 'header-text')}
      <p class="warning-text">
        As chosen, the header lines make this file non-conforming WebVTT (for HLS players).
      </p>
    {/if}
  </section>

  {#if result && result.compatibility.length > 0}
    <fieldset class="compat">
      <legend>Player compatibility</legend>
      <p class="muted small">
        This file is valid, but some players misread parts of it. These fixes keep it valid.
      </p>
      {#each result.compatibility as c (c.id)}
        {@const fix = fixById(c.id)}
        <label class="check option">
          <input
            type="checkbox"
            checked={compatibility.includes(c.id)}
            onchange={(e) => toggle(c.id, e.currentTarget.checked)}
          />
          <span>
            {fix.label} ({c.count.toLocaleString()})
            <span class="muted small why"
              >{fix.why}{fix.lossy ? ' Changes what viewers see in other players.' : ''}</span
            >
          </span>
        </label>
      {/each}
    </fieldset>
  {/if}

  {#if result?.headerLines}
    <fieldset class="compat">
      <legend>Header lines</legend>
      <label class="check option">
        <input type="checkbox" bind:checked={headerLines} />
        <span>
          Keep the lines under "WEBVTT" (such as <code>X-TIMESTAMP-MAP=…</code>, <code>Kind:</code>,
          <code>Language:</code>) instead of writing them as a comment
          <span class="muted small why"
            >HLS players need <code>X-TIMESTAMP-MAP</code> there, and YouTube writes its files this way.
            Valid in the 2014–15 drafts but not today, so the file will not conform.</span
          >
        </span>
      </label>
    </fieldset>
  {/if}

  {#if result && result.youtube.length > 0}
    <details class="youtube">
      <summary>
        Uploading to YouTube? {result.youtube.length}
        {result.youtube.length === 1 ? 'feature' : 'features'} to check
      </summary>
      <p class="muted small">
        Found by uploading a test file (docs/YOUTUBE-TEST.md). The file is valid either way; this is
        only a warning.
      </p>
      <ul>
        {#each result.youtube as y (y.id)}
          {@const support = YOUTUBE[y.id]}
          <li>
            {featureName(y.id)}: {y.count.toLocaleString()}
            <span class="muted"
              >({STATUS[support.status] ?? support.status}{support.note
                ? `: ${support.note}`
                : ''})</span
            >
            {#if support.fixedBy && compatibility.includes(support.fixedBy)}
              <strong class="avoided">Avoided: "{fixById(support.fixedBy).label}" is ticked.</strong
              >
            {/if}
          </li>
        {/each}
      </ul>
      {#if youtubeFixable}
        <button onclick={forYouTube}>Tick the fixes for YouTube</button>
      {/if}
    </details>
  {/if}

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
  .compat {
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }
  .compat p {
    margin: 0;
  }
  label.option {
    align-items: flex-start;
  }
  .why {
    display: block;
  }
  .small {
    font-size: 0.85rem;
  }
  .youtube {
    margin-top: 0.75rem;
    font-size: 0.9rem;
  }
  .avoided {
    display: block;
    font-weight: 600;
  }
  .youtube ul {
    padding-left: 1.2rem;
  }
</style>
