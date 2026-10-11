<!--
  Styles: the file's STYLE blocks (CSS for its cues). Add, edit and delete them, with the
  problems in the sheet as you type, rules to start from (including for the classes, voices and
  languages the cues use), and a preview of a cue drawn with them. Typing in one block is one
  undo step.
-->
<script lang="ts">
  import {
    addStyle,
    cueSelectors,
    deleteStyle,
    NEW_STYLE_SHEET,
    parseStylesheet,
    ruleTemplates,
    styleSheetProblems,
    updateStyle,
    type Cue,
  } from '@microvtt/core';
  import { tick } from 'svelte';
  import type { Editor } from '../editor.svelte.ts';
  import CuePreview from './CuePreview.svelte';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();
  /** Header index of the selected STYLE block. */
  let selected = $state<number | null>(null);

  const styles = $derived(
    editor.doc.head.flatMap((h, index) => (h.type === 'style' ? [{ index, css: h.css }] : [])),
  );
  const style = $derived(styles.find((s) => s.index === selected) ?? styles[0] ?? null);
  const problems = $derived(style ? styleSheetProblems(style.css) : []);
  const templates = $derived(open ? ruleTemplates(cueSelectors(editor.doc)) : []);
  const previewCue = $derived<Cue | null>(
    editor.selectedCue ?? editor.doc.body.find((i): i is Cue => i.type === 'cue') ?? null,
  );

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      selected = styles[0]?.index ?? null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  });

  const ruleCount = (css: string): number => parseStylesheet(css).rules.length;

  async function add(): Promise<void> {
    const { document, index } = addStyle(editor.doc);
    editor.apply(document, 'Add style block');
    selected = index;
    await tick();
    // Inside the starting rule, ready to type a declaration.
    const at = NEW_STYLE_SHEET.indexOf('\n  ') + 3;
    textarea?.focus();
    textarea?.setSelectionRange(at, at);
  }

  function edit(css: string): void {
    if (!style) return;
    editor.apply(updateStyle(editor.doc, style.index, css), 'Edit style block', {
      coalesce: `style:${style.index}`,
    });
  }

  function remove(): void {
    if (!style) return;
    if (style.css.trim() !== '' && !confirm('Delete this style block and its rules?')) return;
    editor.apply(deleteStyle(editor.doc, style.index), 'Delete style block');
    selected = null;
  }

  async function insert(css: string): Promise<void> {
    if (!style || !textarea) return;
    const text = style.css;
    const end = ruleEnd(text, textarea.selectionEnd);
    const before = text.slice(0, end);
    const after = text.slice(end);
    const lead = before === '' || before.endsWith('\n') ? '' : '\n';
    const trail = after === '' || after.startsWith('\n') ? '' : '\n';
    editor.apply(
      updateStyle(editor.doc, style.index, before + lead + css + trail + after),
      'Add rule',
    );
    await tick();
    const caret = before.length + lead.length + css.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }

  /** `at`, or if that is inside a rule's braces, just after the rule. */
  function ruleEnd(text: string, at: number): number {
    let depth = 0;
    for (const ch of text.slice(0, at))
      depth = Math.max(0, depth + (ch === '{' ? 1 : ch === '}' ? -1 : 0));
    for (let i = at; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}' && --depth === 0) return i + 1;
    }
    return depth > 0 ? text.length : at;
  }

  function goToLine(line: number): void {
    if (!textarea || !style) return;
    const lines = style.css.split('\n');
    const at = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(at, at + (lines[line - 1]?.length ?? 0));
  }
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="styles-heading"
>
  <h2 id="styles-heading">Styles</h2>
  <p class="muted small">
    STYLE blocks hold CSS for the cues: <code>::cue</code> for all cue text,
    <code>::cue(selector)</code> for parts of it (<code>i</code>, <code>.class</code>,
    <code>v[voice="Name"]</code>), and <code>::cue-region</code> for regions. Players differ in which
    properties they support; colour, background and font are the safest.
  </p>

  <div class="layout">
    <div class="list">
      <ul aria-label="Style blocks in this file">
        {#each styles as s, n (s.index)}
          <li>
            <button
              class="item"
              class:current={s === style}
              aria-current={s === style ? 'true' : undefined}
              onclick={() => (selected = s.index)}
            >
              Style {n + 1}
              <span class="muted"
                >{ruleCount(s.css)} {ruleCount(s.css) === 1 ? 'rule' : 'rules'}</span
              >
            </button>
          </li>
        {:else}
          <li class="muted">No style blocks yet.</li>
        {/each}
      </ul>
      <button onclick={add}>Add style block</button>
      {#if style}
        <button onclick={remove}>Delete style block</button>
      {/if}
    </div>

    {#if style}
      <div class="sheet">
        <label class="editor-label">
          CSS
          <textarea
            bind:this={textarea}
            class="css"
            spellcheck="false"
            autocomplete="off"
            rows="10"
            value={style.css}
            oninput={(e) => edit(e.currentTarget.value)}
            aria-describedby="style-problems"></textarea>
        </label>
        <label class="insert">
          Add a rule for
          <select
            value=""
            onchange={(e) => {
              const t = templates[Number(e.currentTarget.value)];
              e.currentTarget.value = '';
              if (t) void insert(t.css);
            }}
          >
            <option value="" disabled>Choose…</option>
            {#each templates as t, i (t.label)}<option value={i}>{t.label}</option>{/each}
          </select>
        </label>
        <div id="style-problems" aria-live="polite">
          {#if problems.length === 0}
            <p class="muted small">No problems.</p>
          {:else}
            <ul class="problems" aria-label="Problems in this style block">
              {#each problems as p, i (i)}
                <li class={p.severity}>
                  <button class="link" onclick={() => goToLine(p.line)}>Line {p.line}</button>:
                  {p.message}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if open && previewCue}
    <div class="preview">
      <span class="muted small">Preview ({editor.selectedCue ? 'selected cue' : 'first cue'})</span>
      <CuePreview {editor} cue={previewCue} />
    </div>
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
    width: min(48rem, 94vw);
    max-height: 90vh;
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
    flex: 0 1 11rem;
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
  .sheet {
    flex: 1 1 20rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .editor-label,
  .insert {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.9rem;
  }
  .insert {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  .css {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 0.85rem;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    tab-size: 2;
  }
  .problems {
    font-size: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .problems .error {
    color: var(--error, inherit);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 24rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.75rem;
  }
</style>
