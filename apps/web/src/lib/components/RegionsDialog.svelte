<!--
  Regions: areas of the video that cues can be put in (WebVTT REGION blocks), e.g. for roll-up
  captions. Add, change and delete them; each change is one undo step, and renaming a region
  renames it in its cues.
-->
<script lang="ts">
  import {
    addRegion,
    deleteRegion,
    regionBoxSettings,
    regionsOf,
    regionUse,
    updateRegion,
    type Region,
    type RegionUpdate,
  } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let selectedId = $state<string | null>(null);
  let message = $state<string | null>(null);

  const regions = $derived(regionsOf(editor.doc));
  const use = $derived(regionUse(editor.doc));
  const region = $derived(regions.find((r) => r.id === selectedId) ?? regions[0] ?? null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      // The selected cue's region, if it has one.
      selectedId = editor.selectedCue?.region ?? regions[0]?.id ?? null;
      message = null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  function run(change: () => void): boolean {
    try {
      change();
      message = null;
      return true;
    } catch (error) {
      message = (error as Error).message;
      return false;
    }
  }

  function add(): void {
    run(() => {
      const before = new Set(regions.map((r) => r.id));
      editor.change((doc) => addRegion(doc), 'Add region');
      selectedId = regionsOf(editor.doc).find((r) => !before.has(r.id))?.id ?? null;
    });
  }

  function change(r: Region, update: RegionUpdate, input?: HTMLInputElement): void {
    const ok = run(() =>
      editor.change((doc) => updateRegion(doc, r.id, update), `Change region ${r.id}`),
    );
    if (input) {
      if (ok) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
    }
    if (ok && update.id !== undefined) selectedId = update.id;
  }

  /** A number field's value, or NaN (which the change then rejects with a message). */
  const num = (input: HTMLInputElement): number =>
    input.value.trim() === '' ? NaN : Number(input.value.replace(/%$/, ''));

  function remove(r: Region): void {
    const n = use.get(r.id) ?? 0;
    if (
      n > 0 &&
      !confirm(
        `${n} ${n === 1 ? 'cue is' : 'cues are'} in "${r.id}". Delete it and leave them in no region?`,
      )
    )
      return;
    run(() => editor.change((doc) => deleteRegion(doc, r.id), `Delete region ${r.id}`));
    selectedId = null;
  }

  const box = (r: Region): string => {
    const b = regionBoxSettings(r);
    return `left: ${b.left}%; top: ${b.top}%; width: ${b.width}%; height: ${b.height}%;`;
  };
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="regions-heading"
>
  <h2 id="regions-heading">Regions</h2>
  <p class="muted small">
    A region is an area of the video that cues can be put in (a cue's Region setting). Cues in a
    region stack up from its bottom; with "scroll up", older lines move up as new ones come in, as
    in roll-up captions.
  </p>

  <div class="layout">
    <div class="list">
      <ul aria-label="Regions in this file">
        {#each regions as r (r.id)}
          <li>
            <button
              class="item"
              class:current={r === region}
              aria-current={r === region ? 'true' : undefined}
              onclick={() => (selectedId = r.id)}
            >
              {r.id}
              <span class="muted"
                >{use.get(r.id) ?? 0} {(use.get(r.id) ?? 0) === 1 ? 'cue' : 'cues'}</span
              >
            </button>
          </li>
        {:else}
          <li class="muted">No regions yet.</li>
        {/each}
      </ul>
      <button onclick={add}>Add region</button>
    </div>

    <div class="frame" aria-hidden="true">
      {#each regions as r (r.id)}
        <div class="box" class:current={r === region} style={box(r)}>{r.id}</div>
      {/each}
    </div>
  </div>

  {#if region}
    {#key region.id}
      <fieldset class="form" aria-label="Region {region.id}">
        <label>
          Id
          <input
            value={region.id}
            onchange={(e) => change(region, { id: e.currentTarget.value.trim() }, e.currentTarget)}
          />
        </label>
        <label>
          Width (%)
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            value={region.width}
            onchange={(e) => change(region, { width: num(e.currentTarget) }, e.currentTarget)}
          />
        </label>
        <label>
          Lines
          <input
            type="number"
            min="0"
            step="1"
            value={region.lines}
            onchange={(e) => change(region, { lines: num(e.currentTarget) }, e.currentTarget)}
          />
        </label>
        <label
          title="The point of the region (as a percentage of its width and height) that is placed at the viewport anchor"
        >
          Region anchor X, Y (%)
          <span class="pair">
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              aria-label="Region anchor X"
              value={region.regionAnchorX}
              onchange={(e) =>
                change(region, { regionAnchorX: num(e.currentTarget) }, e.currentTarget)}
            />
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              aria-label="Region anchor Y"
              value={region.regionAnchorY}
              onchange={(e) =>
                change(region, { regionAnchorY: num(e.currentTarget) }, e.currentTarget)}
            />
          </span>
        </label>
        <label
          title="Where on the video (as a percentage of its width and height) the region anchor goes"
        >
          Viewport anchor X, Y (%)
          <span class="pair">
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              aria-label="Viewport anchor X"
              value={region.viewportAnchorX}
              onchange={(e) =>
                change(region, { viewportAnchorX: num(e.currentTarget) }, e.currentTarget)}
            />
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              aria-label="Viewport anchor Y"
              value={region.viewportAnchorY}
              onchange={(e) =>
                change(region, { viewportAnchorY: num(e.currentTarget) }, e.currentTarget)}
            />
          </span>
        </label>
        <label>
          Scroll
          <select
            value={region.scroll}
            onchange={(e) => change(region, { scroll: e.currentTarget.value === 'up' ? 'up' : '' })}
          >
            <option value="">none</option>
            <option value="up">up (roll-up)</option>
          </select>
        </label>
      </fieldset>
      <p class="row">
        <button onclick={() => remove(region)}>Delete region {region.id}</button>
      </p>
    {/key}
  {/if}

  {#if message}
    <p class="error-text" role="alert">{message}</p>
  {/if}

  <div class="actions">
    <button class="primary" onclick={() => (open = false)}>Done</button>
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
  .small {
    font-size: 0.85rem;
  }
  .layout {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin: 0.75rem 0;
  }
  .list {
    flex: 1 1 10rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: start;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
  }
  .item {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    text-align: left;
    border: 1px solid transparent;
    background: none;
  }
  .item.current {
    border-color: var(--accent);
    background: var(--selected, transparent);
  }
  .frame {
    position: relative;
    flex: 0 0 16rem;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: linear-gradient(160deg, #3a4a5c, #20262e);
    overflow: hidden;
  }
  .box {
    position: absolute;
    box-sizing: border-box;
    border: 1px dashed rgb(255 255 255 / 0.6);
    color: rgb(255 255 255 / 0.85);
    font-size: 0.7rem;
    padding: 0 0.2rem;
    overflow: hidden;
  }
  .box.current {
    border: 2px solid #ffd54a;
    background: rgb(255 213 74 / 0.15);
  }
  .form {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.9rem;
  }
  .pair {
    display: flex;
    gap: 0.3rem;
  }
  input[type='number'] {
    width: 5rem;
  }
  .row {
    margin: 0.6rem 0 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
</style>
