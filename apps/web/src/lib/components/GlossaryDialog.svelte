<!--
  The glossary: corrections applied to the whole document at once (names and terms speech
  recognition keeps getting wrong). Saved in this browser; also editable as plain text.
-->
<script lang="ts">
  import type { Editor } from '../editor.svelte.ts';
  import {
    applyGlossary,
    countGlossary,
    formatGlossary,
    loadGlossary,
    newEntry,
    parseGlossary,
    saveGlossary,
    type GlossaryEntry,
  } from '../glossary.ts';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();

  let dialog: HTMLDialogElement | undefined = $state();
  let entries = $state<GlossaryEntry[]>([]);
  let counts = $state.raw<number[]>([]);
  let status = $state<string | null>(null);
  let text = $state('');

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      entries = loadGlossary();
      if (entries.length === 0) entries = [newEntry()];
      status = null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  // Save and recount when entries (or the document) change, after typing settles.
  $effect(() => {
    if (!open) return;
    const snapshot = $state.snapshot(entries) as GlossaryEntry[];
    const doc = editor.doc;
    const rows = editor.cueRows;
    const timer = setTimeout(() => {
      saveGlossary(snapshot.filter((e) => e.find.trim() !== ''));
      counts = countGlossary(doc, rows, snapshot);
    }, 250);
    return () => clearTimeout(timer);
  });

  const total = $derived(counts.reduce((n, c) => n + c, 0));

  function applyAll(): void {
    const { doc, counts: done } = applyGlossary(
      editor.doc,
      editor.cueRows,
      $state.snapshot(entries) as GlossaryEntry[],
    );
    const n = done.reduce((a, b) => a + b, 0);
    if (n === 0) {
      status = 'Nothing to replace.';
      return;
    }
    editor.apply(doc, `Glossary (${n})`);
    status = `Replaced ${n.toLocaleString()} ${n === 1 ? 'match' : 'matches'}. Undo reverts them all.`;
  }

  function loadText(): void {
    const parsed = parseGlossary(text);
    if (parsed.length === 0) {
      status = 'No "find => replace" lines found in the text.';
      return;
    }
    entries = parsed;
    status = `Loaded ${parsed.length} ${parsed.length === 1 ? 'entry' : 'entries'}.`;
  }
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="glossary-heading"
>
  <h2 id="glossary-heading">Glossary</h2>
  <p class="muted intro">
    Corrections for every file: names and terms the speech recognition gets wrong. Spaces also match
    across word timings. Saved in this browser.
  </p>

  <table>
    <thead>
      <tr>
        <th scope="col">Find</th>
        <th scope="col">Replace with</th>
        <th scope="col" title="Match case">Aa</th>
        <th scope="col" title="Whole words only">Word</th>
        <th scope="col">Matches</th>
        <th scope="col"><span class="visually-hidden">Remove</span></th>
      </tr>
    </thead>
    <tbody>
      {#each entries as entry, i (i)}
        <tr>
          <td><input bind:value={entry.find} aria-label="Find (entry {i + 1})" /></td>
          <td><input bind:value={entry.replace} aria-label="Replace with (entry {i + 1})" /></td>
          <td><input type="checkbox" bind:checked={entry.matchCase} aria-label="Match case" /></td>
          <td><input type="checkbox" bind:checked={entry.wholeWord} aria-label="Whole words" /></td>
          <td class="count">{counts[i] ?? ''}</td>
          <td>
            <button
              class="remove"
              onclick={() => entries.splice(i, 1)}
              aria-label="Remove entry {i + 1}">×</button
            >
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="row">
    <button onclick={() => entries.push(newEntry())}>Add entry</button>
    <span class="status" aria-live="polite">{status ?? ''}</span>
  </p>

  <details ontoggle={() => (text = formatGlossary(entries))}>
    <summary>Edit as text</summary>
    <p class="muted">One correction per line: <code>find =&gt; replace</code>.</p>
    <textarea bind:value={text} rows="6" aria-label="Glossary as text"></textarea>
    <button onclick={loadText}>Use this list</button>
  </details>

  <div class="actions">
    <button onclick={() => (open = false)}>Close</button>
    <button class="primary" disabled={total === 0} onclick={applyAll}
      >Apply all ({total.toLocaleString()})</button
    >
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
  .intro {
    margin-top: 0;
    font-size: 0.9rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    font-weight: 600;
    padding: 0.2rem;
  }
  td {
    padding: 0.2rem;
  }
  td input:not([type]) {
    width: 100%;
  }
  .count {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .remove {
    padding: 0.1rem 0.5rem;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  textarea {
    width: 100%;
    font-family: var(--mono);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
</style>
