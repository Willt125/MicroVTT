<!--
  Editor for the selected cue: times, id, text, and settings. Values go through core's
  `updateCue`, which applies VTTCue's rules (e.g. position and size must be 0–100%).
-->
<script lang="ts">
  import type { AlignSetting, Cue, CueUpdate, DirectionSetting } from '@microvtt/core';
  import { regionsOf, updateCue } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import { SEVERITY_LABEL } from '../display.ts';
  import { formatDuration, formatTime, parseTimeInput } from '../time.ts';

  interface Props {
    editor: Editor;
    textarea?: HTMLTextAreaElement | undefined;
  }

  let { editor, textarea = $bindable() }: Props = $props();

  const cue = $derived(editor.selectedCue);
  const problems = $derived(editor.diagnosticsByItem.get(editor.selected) ?? []);
  const regions = $derived(regionsOf(editor.doc).map((r) => r.id));
  let fieldError = $state<string | null>(null);

  function update(change: CueUpdate, label: string, coalesce?: string): void {
    try {
      editor.updateSelected((c: Cue) => updateCue(c, change), label, coalesce);
      fieldError = null;
    } catch (error) {
      fieldError = (error as Error).message;
    }
  }

  /** Commits a time field on Enter or blur; invalid input is shown, not applied. */
  function commitTime(field: 'startMs' | 'endMs', input: HTMLInputElement): void {
    const ms = parseTimeInput(input.value);
    if (ms === null) {
      fieldError = `"${input.value}" is not a time. Use h:mm:ss.ttt, m:ss.t or seconds.`;
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    input.removeAttribute('aria-invalid');
    if (cue && ms !== cue[field])
      update({ [field]: ms }, field === 'startMs' ? 'Change start time' : 'Change end time');
    input.value = formatTime(ms);
  }

  /** Enter commits; ↑/↓ nudge by 0.1 s (1 s with Shift). Alt+↑/↓ are left to cue navigation. */
  function timeKeydown(field: 'startMs' | 'endMs', event: KeyboardEvent): void {
    if (event.key === 'Enter') commitTime(field, event.currentTarget as HTMLInputElement);
    else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey) {
      event.preventDefault();
      const step = event.shiftKey ? 1000 : 100;
      editor.nudge(field, event.key === 'ArrowUp' ? step : -step);
      const input = event.currentTarget as HTMLInputElement;
      input.removeAttribute('aria-invalid');
      if (editor.selectedCue) input.value = formatTime(editor.selectedCue[field]);
    }
  }

  /** "auto", a number (line number) or a percentage. */
  function commitLine(value: string): void {
    const v = value.trim();
    if (v === '' || v === 'auto') return update({ line: 'auto', snapToLines: true }, 'Change line');
    const pct = /^(-?[0-9.]+)%$/.exec(v);
    const n = Number(pct ? pct[1] : v);
    if (!Number.isFinite(n)) {
      fieldError = `"${value}" is not a line: use auto, a line number (e.g. -1) or a percentage (e.g. 90%).`;
      return;
    }
    update({ line: n, snapToLines: !pct }, 'Change line');
  }

  function commitPercent(field: 'position' | 'size', value: string): void {
    const v = value.trim().replace(/%$/, '');
    if (field === 'position' && (v === '' || v === 'auto'))
      return update({ position: 'auto' }, 'Change position');
    const n = Number(v);
    if (v === '' || !Number.isFinite(n)) {
      fieldError = `"${value}" is not a percentage.`;
      return;
    }
    update({ [field]: n }, field === 'position' ? 'Change position' : 'Change size');
  }

  const lineText = (c: Cue): string =>
    c.line === 'auto' ? 'auto' : c.snapToLines ? String(c.line) : `${c.line}%`;
  const posText = (c: Cue): string => (c.position === 'auto' ? 'auto' : `${c.position}%`);
</script>

<section class="editor" aria-label="Selected cue">
  {#if cue}
    {#key editor.selected}
      <div class="times">
        <label>
          Start
          <input
            class="time"
            value={formatTime(cue.startMs)}
            title="↑/↓ nudge by 0.1 s, with Shift by 1 s"
            onblur={(e) => commitTime('startMs', e.currentTarget)}
            onkeydown={(e) => timeKeydown('startMs', e)}
          />
        </label>
        <label>
          End
          <input
            class="time"
            value={formatTime(cue.endMs)}
            title="↑/↓ nudge by 0.1 s, with Shift by 1 s"
            onblur={(e) => commitTime('endMs', e.currentTarget)}
            onkeydown={(e) => timeKeydown('endMs', e)}
          />
        </label>
        <span class="muted duration">Duration {formatDuration(cue.endMs - cue.startMs)}</span>
        <label class="id">
          ID
          <input
            value={cue.id}
            placeholder="(none)"
            oninput={(e) => update({ id: e.currentTarget.value }, 'Change id', 'id')}
          />
        </label>
      </div>

      <label class="text-label" for="cue-text"
        >Text <span class="muted">(WebVTT markup, e.g. &lt;i&gt;, &lt;v Name&gt;, &amp;amp;)</span
        ></label
      >
      <textarea
        id="cue-text"
        bind:this={textarea}
        value={cue.text}
        rows="3"
        spellcheck="true"
        oninput={(e) => update({ text: e.currentTarget.value }, 'Edit text', 'text')}></textarea>

      <details class="settings">
        <summary>Settings</summary>
        <div class="grid">
          <label>
            Align
            <select
              value={cue.align}
              onchange={(e) =>
                update({ align: e.currentTarget.value as AlignSetting }, 'Change alignment')}
            >
              {#each ['start', 'center', 'end', 'left', 'right'] as a (a)}<option value={a}
                  >{a}</option
                >{/each}
            </select>
          </label>
          <label>
            Vertical
            <select
              value={cue.vertical}
              onchange={(e) =>
                update({ vertical: e.currentTarget.value as DirectionSetting }, 'Change direction')}
            >
              <option value="">horizontal</option>
              <option value="rl">rl (growing left)</option>
              <option value="lr">lr (growing right)</option>
            </select>
          </label>
          <label>
            Line
            <input value={lineText(cue)} onchange={(e) => commitLine(e.currentTarget.value)} />
          </label>
          <label>
            Position
            <input
              value={posText(cue)}
              onchange={(e) => commitPercent('position', e.currentTarget.value)}
            />
          </label>
          <label>
            Size
            <input
              value={`${cue.size}%`}
              onchange={(e) => commitPercent('size', e.currentTarget.value)}
            />
          </label>
          <label>
            Region
            <select
              value={cue.region ?? ''}
              onchange={(e) => update({ region: e.currentTarget.value || null }, 'Change region')}
            >
              <option value="">(none)</option>
              {#each regions as id (id)}<option value={id}>{id}</option>{/each}
            </select>
          </label>
        </div>
      </details>

      {#if fieldError}
        <p class="error-text" role="alert">{fieldError}</p>
      {/if}
      {#if problems.length > 0}
        <ul class="problems">
          {#each problems as p, i (i)}
            <li>
              <span class="{p.severity}-text">{SEVERITY_LABEL[p.severity]}:</span>
              {p.message}
            </li>
          {/each}
        </ul>
      {/if}
    {/key}
  {:else}
    <p class="muted">Select a cue to edit it.</p>
  {/if}
</section>

<style>
  .editor {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .times {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.85rem;
  }
  .time {
    font-family: var(--mono);
    width: 9.5rem;
  }
  .duration {
    font-size: 0.85rem;
    padding-bottom: 0.35rem;
  }
  .id {
    margin-left: auto;
  }
  textarea {
    width: 100%;
    resize: vertical;
    font-family: var(--mono);
    font-size: 0.9rem;
  }
  .text-label {
    display: block;
  }
  .settings summary {
    cursor: pointer;
    font-size: 0.9rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.5rem;
    margin-top: 0.4rem;
  }
  :global([aria-invalid='true']) {
    border-color: var(--error);
  }
  .problems {
    margin: 0;
    padding-left: 1.1rem;
    font-size: 0.9rem;
  }
  p {
    margin: 0;
  }
</style>
