<!-- Keyboard shortcuts reference. -->
<script lang="ts">
  import { SHORTCUTS } from '../shortcuts.ts';

  interface Props {
    open: boolean;
    mod: string;
  }

  let { open = $bindable(), mod }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  const general = $derived([
    [`${mod}O`, 'Open a file'],
    [`${mod}S`, 'Export / save'],
    [`${mod}F`, 'Find and replace'],
    [`${mod}Z, ${mod}Shift+Z`, 'Undo, redo (outside text fields)'],
    ['Enter (in the list)', 'Edit the cue’s text'],
    ['Delete (in the list)', 'Delete the cue'],
    ['↑ ↓ (in a time field)', 'Nudge by 0.1 s (with Shift: 1 s)'],
  ]);
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-labelledby="help-heading">
  <h2 id="help-heading">Keyboard shortcuts</h2>
  <p class="muted">
    Single keys work when you are not typing. Add Alt (⌥ on a Mac) to use them anywhere, including
    while editing cue text.
  </p>
  <table>
    <tbody>
      {#each SHORTCUTS as s (s.action)}
        <tr><th scope="row"><kbd>{s.label}</kbd></th><td>{s.description}</td></tr>
      {/each}
      {#each general as [keys, what] (keys)}
        <tr><th scope="row"><kbd>{keys}</kbd></th><td>{what}</td></tr>
      {/each}
    </tbody>
  </table>
  <div class="actions">
    <button class="primary" onclick={() => (open = false)}>Close</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--control);
    border-radius: var(--radius);
    width: min(36rem, 92vw);
    max-height: 85vh;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  h2 {
    margin-top: 0;
    font-size: 1.1rem;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    font-weight: normal;
    white-space: nowrap;
    padding: 0.25rem 1rem 0.25rem 0;
    vertical-align: top;
  }
  td {
    padding: 0.25rem 0;
  }
  tr + tr {
    border-top: 1px solid var(--border);
  }
  kbd {
    font-family: var(--mono);
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }
</style>
