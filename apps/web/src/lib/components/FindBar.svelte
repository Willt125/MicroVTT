<!--
  Find and replace in cue text. Matches are searched in the raw text, markup included, and the
  current one is shown in context here (a text field's selection is invisible while unfocused).
-->
<script lang="ts">
  import type { Cue } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import {
    buildPattern,
    findAll,
    nextMatch,
    previousMatch,
    replaceAll,
    replaceOne,
    type Match,
  } from '../find.ts';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();

  let query = $state('');
  let replacement = $state('');
  let matchCase = $state(false);
  let wholeWord = $state(false);
  let regex = $state(false);
  let current = $state.raw<Match | null>(null);
  let status = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();

  const pattern = $derived(buildPattern({ query, matchCase, wholeWord, regex }));
  const matches = $derived(
    pattern instanceof RegExp ? findAll(editor.doc, editor.cueRows, pattern) : [],
  );
  const rowOf = $derived(
    Object.fromEntries(editor.cueRows.map((bodyIndex, row) => [bodyIndex, row])) as Record<
      number,
      number
    >,
  );
  const row = (bodyIndex: number): number => rowOf[bodyIndex] ?? -1;
  const currentIndex = $derived(
    current
      ? matches.findIndex(
          (m) =>
            m.bodyIndex === current?.bodyIndex &&
            m.start === current.start &&
            m.end === current.end,
        )
      : -1,
  );

  $effect(() => {
    if (open) input?.select();
  });

  // A new search starts from the selected cue.
  $effect(() => {
    void pattern;
    current = null;
    status = null;
  });

  function go(index: number): void {
    const m = matches[index];
    if (!m) {
      status = 'No matches.';
      return;
    }
    current = m;
    status = null;
    editor.selected = m.bodyIndex;
  }

  function findNext(): void {
    const from = current ?? { bodyIndex: editor.selected, start: -1, end: -1 };
    go(nextMatch(matches, row, row(from.bodyIndex), from.start + 1));
  }

  function findPrevious(): void {
    const from = current ?? { bodyIndex: editor.selected, start: 0, end: 0 };
    go(previousMatch(matches, row, row(from.bodyIndex), from.start));
  }

  function replaceCurrent(): void {
    if (!(pattern instanceof RegExp)) return;
    if (!current || currentIndex === -1) return findNext();
    const m = current;
    const cue = editor.doc.body[m.bodyIndex] as Cue;
    const text = replaceOne(cue.text, m, pattern, replacement, regex);
    const body = [...editor.doc.body];
    const next: Cue = { ...cue, text };
    delete next.source;
    body[m.bodyIndex] = next;
    editor.apply({ ...editor.doc, body }, 'Replace', { select: m.bodyIndex });
    // Continue after the replaced text (the match list is rebuilt from the new document).
    const after = m.start + (text.length - cue.text.length) + (m.end - m.start);
    current = null;
    if (matches.length === 0) status = 'Replaced the last match.';
    else go(nextMatch(matches, row, row(m.bodyIndex), after));
  }

  function replaceEverywhere(): void {
    if (!(pattern instanceof RegExp)) return;
    const result = replaceAll(editor.doc, editor.cueRows, pattern, replacement, regex);
    if (result.count === 0) {
      status = 'No matches.';
      return;
    }
    editor.apply(result.doc, `Replace all (${result.count})`);
    current = null;
    status = `Replaced ${result.count.toLocaleString()} ${result.count === 1 ? 'match' : 'matches'}.`;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
    } else if (event.key === 'Enter' && event.currentTarget === input) {
      event.preventDefault();
      if (event.shiftKey) findPrevious();
      else findNext();
    }
  }

  const context = $derived.by(() => {
    if (!current || currentIndex === -1) return null;
    const text = (editor.doc.body[current.bodyIndex] as Cue).text.replace(/\n/g, ' ');
    const from = Math.max(0, current.start - 30);
    return {
      cue: row(current.bodyIndex) + 1,
      before: (from > 0 ? '…' : '') + text.slice(from, current.start),
      match: text.slice(current.start, current.end),
      after:
        text.slice(current.end, current.end + 30) + (current.end + 30 < text.length ? '…' : ''),
    };
  });
</script>

{#if open}
  <section class="find" aria-label="Find and replace">
    <div class="row">
      <input
        bind:this={input}
        bind:value={query}
        {onkeydown}
        placeholder="Find in cue text"
        aria-label="Find"
        aria-invalid={typeof pattern === 'string'}
      />
      <input
        bind:value={replacement}
        onkeydown={(e) => e.key === 'Escape' && (open = false)}
        placeholder={regex ? 'Replace ($1 for groups)' : 'Replace with'}
        aria-label="Replace with"
      />
      <label title="Match case"><input type="checkbox" bind:checked={matchCase} /> Aa</label>
      <label title="Whole words only"><input type="checkbox" bind:checked={wholeWord} /> Word</label
      >
      <label title="Regular expression (JavaScript syntax)"
        ><input type="checkbox" bind:checked={regex} /> .*</label
      >
    </div>
    <div class="row">
      <button onclick={findPrevious} disabled={matches.length === 0} title="Previous (Shift+Enter)"
        >Previous</button
      >
      <button onclick={findNext} disabled={matches.length === 0} title="Next (Enter)">Next</button>
      <button onclick={replaceCurrent} disabled={matches.length === 0}>Replace</button>
      <button onclick={replaceEverywhere} disabled={matches.length === 0}>Replace all</button>
      <span class="status" aria-live="polite">
        {#if typeof pattern === 'string'}
          <span class="error-text">{pattern}</span>
        {:else if status}
          {status}
        {:else if pattern}
          {currentIndex === -1
            ? ''
            : `${(currentIndex + 1).toLocaleString()} of `}{matches.length.toLocaleString()}
          {matches.length === 1 ? 'match' : 'matches'}
        {/if}
      </span>
      <button class="close" onclick={() => (open = false)} title="Close (Escape)">Close</button>
    </div>
    {#if context}
      <p class="context">
        <span class="muted">Cue {context.cue}:</span>
        {context.before}<mark>{context.match}</mark>{context.after}
      </p>
    {/if}
  </section>
{/if}

<style>
  .find {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 0.6rem;
    align-items: center;
  }
  .row input:not([type]) {
    flex: 1;
    min-width: 10rem;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .status {
    flex: 1;
  }
  .context {
    margin: 0;
    font-family: var(--mono);
    font-size: 0.85rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  mark {
    background: var(--selected);
    color: var(--text);
    outline: 1px solid var(--accent);
  }
</style>
