<!--
  Markup tools for the cue text field: buttons that wrap the selection in a span (or take it
  out of one), and a breadcrumb of the spans the cursor is in. The text field stays the source;
  every tool is an edit of its raw text, so markup it does not touch is kept as written.
-->
<script lang="ts">
  import {
    classProblem,
    clearMarkup,
    cueSelectors,
    languageProblem,
    removeSpan,
    spansAt,
    spanTags,
    wrapRange,
    type MarkupEdit,
    type MarkupKind,
    type MarkupSpan,
  } from '@microvtt/core';
  import { tick, type Snippet } from 'svelte';
  import type { Editor } from '../editor.svelte.ts';
  import { spanLabel, toggleSpan, type SimpleSpan } from '../richtext.ts';

  interface Props {
    editor: Editor;
    text: string;
    kind: MarkupKind;
    /** The selection in the text field. */
    start: number;
    end: number;
    /** Applies an edit and selects its range in the text field. */
    onedit: (edit: MarkupEdit, label: string) => void;
    /** Selects a range in the text field. */
    onselect: (start: number, end: number) => void;
    /** The text field, shown between the tools and the breadcrumb. */
    children: Snippet;
  }

  let { editor, text, kind, start, end, onedit, onselect, children }: Props = $props();

  type Asking = 'c' | 'v' | 'lang' | 'ruby';
  let asking = $state<Asking | null>(null);
  let value = $state('');
  let problem = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();

  const simple: { name: SimpleSpan; label: string; key?: string }[] = $derived(
    kind === 'srt'
      ? [
          { name: 'i', label: 'Italic', key: 'I' },
          { name: 'b', label: 'Bold', key: 'B' },
          { name: 'u', label: 'Underline', key: 'U' },
          { name: 's', label: 'Strikethrough' },
        ]
      : [
          { name: 'i', label: 'Italic', key: 'I' },
          { name: 'b', label: 'Bold', key: 'B' },
          { name: 'u', label: 'Underline', key: 'U' },
        ],
  );
  const at = $derived(spansAt(text, start, end, kind));
  const active = $derived(new Set(at.map((s) => s.name)));
  const used = $derived(asking ? cueSelectors(editor.doc) : null);
  const suggestions = $derived.by(() => {
    if (!used) return [];
    const map =
      asking === 'c'
        ? used.classes
        : asking === 'v'
          ? used.voices
          : asking === 'lang'
            ? used.languages
            : null;
    return map ? [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k) : [];
  });

  const ASK: Record<Asking, { label: string; placeholder: string; button: string }> = {
    c: { label: 'Class name', placeholder: 'e.g. loud', button: 'Add class' },
    v: { label: 'Voice (speaker)', placeholder: 'e.g. Mary', button: 'Add voice' },
    lang: { label: 'Language', placeholder: 'e.g. fr', button: 'Add language' },
    ruby: { label: 'Ruby text (reading)', placeholder: 'e.g. かんじ', button: 'Add ruby' },
  };

  function toggle(name: SimpleSpan, label: string): void {
    onedit(toggleSpan(text, start, end, kind, name), label);
  }

  async function ask(kind: Asking): Promise<void> {
    asking = kind;
    value = '';
    problem = null;
    await tick();
    input?.focus();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!asking) return;
    const v = value.trim();
    let tags: [string, string];
    if (asking === 'c') {
      const classes = v
        .replace(/^\./, '')
        .split('.')
        .filter((c) => c !== '');
      problem =
        classes.length === 0
          ? classProblem('')
          : (classes.map(classProblem).find((p) => p) ?? null);
      tags = spanTags({ name: 'c', classes });
    } else if (asking === 'v') {
      problem = v === '' ? 'Enter the speaker’s name.' : null;
      tags = spanTags({ name: 'v', voice: v });
    } else if (asking === 'lang') {
      problem = languageProblem(v);
      tags = spanTags({ name: 'lang', language: v });
    } else {
      problem = v === '' ? 'Enter the ruby text.' : null;
      tags = spanTags({ name: 'ruby', annotation: v });
    }
    if (problem) {
      input?.setAttribute('aria-invalid', 'true');
      return;
    }
    const label = ASK[asking].button;
    asking = null;
    onedit(wrapRange(text, start, end, tags[0], tags[1], kind), label);
  }

  function cancel(): void {
    asking = null;
    onselect(start, end);
  }

  function remove(span: MarkupSpan): void {
    const removed = removeSpan(text, span, kind);
    const caret = Math.min(span.open.start, removed.length);
    onedit({ text: removed, start: caret, end: caret }, `Remove ${spanLabel(span).toLowerCase()}`);
  }
</script>

<div class="tools" role="toolbar" aria-label="Text markup">
  {#each simple as s (s.name)}
    <button
      class="small tool {s.name}"
      aria-pressed={active.has(s.name)}
      title="{s.label}{s.key ? ` (Ctrl+${s.key})` : ''}: on or off for the selection"
      onclick={() => toggle(s.name, s.label)}>{s.name.toUpperCase()}</button
    >
  {/each}
  {#if kind === 'webvtt'}
    <button
      class="small"
      title="Wrap the selection in a class (<c.name>), for styling it"
      onclick={() => void ask('c')}>Class…</button
    >
    <button
      class="small"
      title="Mark who is speaking the selection (<v Name>)"
      onclick={() => void ask('v')}>Voice…</button
    >
    <button
      class="small"
      title="Mark the selection as another language (<lang tag>)"
      onclick={() => void ask('lang')}>Language…</button
    >
    <button
      class="small"
      title="Add a reading above the selection (ruby, e.g. furigana)"
      onclick={() => void ask('ruby')}>Ruby…</button
    >
  {/if}
  <button
    class="small"
    title="Remove the markup in the selection (all of it with no selection); word timings are kept"
    onclick={() => onedit(clearMarkup(text, start, end, kind), 'Clear markup')}>Clear</button
  >
</div>

{#if asking}
  <form class="ask" onsubmit={submit} aria-label={ASK[asking].button}>
    <label>
      {ASK[asking].label}
      <input
        bind:this={input}
        bind:value
        list={suggestions.length > 0 ? 'markup-suggestions' : undefined}
        placeholder={ASK[asking].placeholder}
        autocomplete="off"
        lang={asking === 'ruby' ? (editor.language ?? undefined) : undefined}
        oninput={() => {
          problem = null;
          input?.removeAttribute('aria-invalid');
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            // Submitted here: with suggestions, Safari's list can take the Enter key.
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
      />
    </label>
    {#if suggestions.length > 0}
      <datalist id="markup-suggestions">
        {#each suggestions as s (s)}<option value={s}></option>{/each}
      </datalist>
    {/if}
    <button class="small primary" type="submit">{ASK[asking].button}</button>
    <button class="small" type="button" onclick={cancel}>Cancel</button>
    {#if problem}<span class="error-text" role="alert">{problem}</span>{/if}
  </form>
{/if}

{@render children()}

<nav class="crumbs" aria-label="Markup at the cursor">
  {#if at.length > 0}
    <span class="muted">In:</span>
    {#each at as span, i (span.open.start)}
      {#if i > 0}<span class="muted" aria-hidden="true">›</span>{/if}
      <span class="crumb">
        <button
          class="link"
          title="Select its text"
          onclick={() => onselect(span.inner.start, span.inner.end)}>{spanLabel(span)}</button
        ><button
          class="link remove"
          aria-label="Remove {spanLabel(span)}"
          title={span.name === 'ruby' || span.name === 'rt'
            ? 'Remove (the ruby text goes too)'
            : 'Remove (its text stays)'}
          onclick={() => remove(span)}>×</button
        >
      </span>
    {/each}
  {/if}
</nav>

<style>
  .tools,
  .ask,
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }
  .tools {
    margin-bottom: 0.25rem;
  }
  .tool {
    min-width: 2rem;
    font-weight: 600;
  }
  .tool.i {
    font-style: italic;
  }
  .tool.u {
    text-decoration: underline;
  }
  .tool.s {
    text-decoration: line-through;
  }
  .tool[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--selected, transparent);
  }
  .ask {
    margin: 0.25rem 0;
    font-size: 0.9rem;
  }
  .ask label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .crumbs {
    font-size: 0.85rem;
    margin-top: 0.2rem;
  }
  .crumb {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 0.25rem;
  }
  .link {
    background: none;
    border: none;
    padding: 0 0.1rem;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
  }
  .remove {
    color: inherit;
    opacity: 0.7;
  }
</style>
