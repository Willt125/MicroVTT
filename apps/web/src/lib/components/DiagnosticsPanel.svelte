<!--
  Problems in the current document (live), plus a summary of what was wrong in the file as
  imported. Each problem links to its cue; severity is shown in words, not only color.
-->
<script lang="ts">
  import { DIAGNOSTICS, specUrl } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import type { ItemDiagnostic } from '../worker/protocol.ts';
  import { SEVERITY_LABEL } from '../display.ts';

  interface Props {
    editor: Editor;
    /** Selects a cue and moves focus to the table. */
    onjump: (bodyIndex: number) => void;
  }

  let { editor, onjump }: Props = $props();

  const MAX_SHOWN = 300;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = $derived(
    [...editor.diagnostics].sort(
      (a, b) => order[a.severity] - order[b.severity] || a.index - b.index,
    ),
  );
  const counts = $derived({
    error: editor.diagnostics.filter((d) => d.severity === 'error').length,
    warning: editor.diagnostics.filter((d) => d.severity === 'warning').length,
    info: editor.diagnostics.filter((d) => d.severity === 'info').length,
  });

  /** Import problems grouped by code, with counts. */
  const imported = $derived.by(() => {
    const groups: Record<string, { count: number; sample: ItemDiagnostic }> = {};
    for (const d of editor.importDiagnostics) {
      const g = (groups[d.code] ??= { count: 0, sample: d });
      g.count++;
    }
    return Object.entries(groups).sort((a, b) => b[1].count - a[1].count);
  });

  const reviewCounts = $derived({
    censored: editor.review.filter((m) => m.kind === 'censored').length,
    sound: editor.review.filter((m) => m.kind === 'sound').length,
  });

  /** Body index → 1-based row number in the cue table. */
  const rowOf = $derived(
    Object.fromEntries(editor.cueRows.map((bodyIndex, row) => [bodyIndex, row + 1])) as Record<
      number,
      number
    >,
  );

  function cueNumber(index: number): number | null {
    return rowOf[index] ?? null;
  }

  /** The cue before a body item: its index and table number. */
  function cueBefore(index: number): { index: number; number: number } | null {
    for (let i = index - 1; i >= 0; i--) {
      const n = cueNumber(i);
      if (n !== null) return { index: i, number: n };
    }
    return null;
  }

  /** The first line of a comment's text, shortened. */
  function excerpt(index: number): string {
    const item = editor.doc.body[index];
    const line = item?.type === 'note' ? (item.text.replace(/^\n/, '').split('\n')[0] ?? '') : '';
    return line.length > 40 ? `${line.slice(0, 40)}…` : line;
  }

  function where(d: ItemDiagnostic): string {
    if (d.list === 'file') return 'File';
    if (d.list === 'head') return 'Header';
    const n = cueNumber(d.index);
    return n === null ? 'Comment' : `Cue ${n}`;
  }
</script>

<aside class="panel" aria-labelledby="problems-heading">
  <h2 id="problems-heading">Problems</h2>
  <p class="summary">
    {#if editor.validating && editor.diagnostics.length === 0}
      <span class="muted">Checking…</span>
    {:else if editor.diagnostics.length === 0}
      <span class="muted">No problems found.</span>
    {:else}
      <span class="error-text">{counts.error} errors</span> ·
      <span class="warning-text">{counts.warning} warnings</span>
      {#if counts.info > 0}· <span class="info-text">{counts.info} notes</span>{/if}
    {/if}
  </p>

  <ul class="list">
    {#each sorted.slice(0, MAX_SHOWN) as d, i (i)}
      <li>
        <span class="{d.severity}-text sev">{SEVERITY_LABEL[d.severity]}</span>
        {#if d.list === 'body' && cueNumber(d.index) !== null}
          <button class="link" onclick={() => onjump(d.index)}>{where(d)}</button>
        {:else}
          <span class="muted">{where(d)}</span>
        {/if}
        <span class="message">{d.message}</span>
        {#if specUrl(d.code)}
          <a
            class="spec"
            href={specUrl(d.code)}
            target="_blank"
            rel="noreferrer"
            title={DIAGNOSTICS[d.code].rule}>spec</a
          >
        {:else}
          <span class="spec muted" title={DIAGNOSTICS[d.code].rule}>rule</span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if sorted.length > MAX_SHOWN}
    <p class="muted">
      … and {sorted.length - MAX_SHOWN} more. Fix these first, or export: export fixes errors automatically.
    </p>
  {/if}

  {#if editor.quickFixes.length > 0}
    <details class="fixes" open>
      <summary>Can be fixed ({editor.quickFixes.length})</summary>
      <p class="muted">
        Text that players ignore, kept as a comment, that was probably meant otherwise. Fixing it
        changes what players show.
      </p>
      <ul>
        {#each editor.quickFixes.slice(0, MAX_SHOWN) as f (f.index)}
          {@const cue = cueBefore(f.index)}
          <li>
            {#if cue !== null}
              <button class="link" onclick={() => onjump(cue.index)}>After cue {cue.number}</button>
            {/if}
            <code class="excerpt">{excerpt(f.index)}</code>
            <button onclick={() => editor.applyQuickFix(f.index)}>{f.label}</button>
          </li>
        {/each}
      </ul>
      {#if editor.quickFixes.length > 1}
        <button onclick={() => editor.applyAllQuickFixes()}
          >Fix all {editor.quickFixes.length}</button
        >
      {/if}
    </details>
  {/if}

  {#if editor.stylesMiss.cues.length > 0}
    {@const miss = editor.stylesMiss}
    <details class="fixes styles-miss" open>
      <summary>Not reached by the styles ({miss.cues.length})</summary>
      <p class="muted">
        {#if miss.wrap === 'all'}
          This file's styles put the background on <code>&lt;c&gt;</code> spans, so text outside one shows
          without a background.
        {:else}
          This file's <code>:past</code> / <code>:future</code> styles reach only timed text in a
          tag such as <code>&lt;c&gt;</code>.
        {/if}
      </p>
      <ul class="cues">
        {#each miss.cues.slice(0, MAX_SHOWN) as index (index)}
          <li>
            <button class="link" onclick={() => onjump(index)}>Cue {cueNumber(index)}</button>
          </li>
        {/each}
      </ul>
      <button onclick={() => editor.wrapForFileStyles()}
        >Wrap in &lt;c&gt; ({miss.cues.length} {miss.cues.length === 1 ? 'cue' : 'cues'})</button
      >
    </details>
  {/if}

  {#if editor.review.length > 0}
    <details class="review" open>
      <summary>
        To review ({editor.review.length})
        <span class="muted">
          · {reviewCounts.censored} censored {reviewCounts.censored === 1 ? 'word' : 'words'}, {reviewCounts.sound}
          sound {reviewCounts.sound === 1 ? 'tag' : 'tags'}
        </span>
      </summary>
      <p class="muted">
        YouTube hides words it censors as <code>[ __ ]</code>; you will usually want to restore
        them. Sound tags like <code>[music]</code> are worth a check.
      </p>
      <ul>
        {#each editor.review.slice(0, MAX_SHOWN) as m, i (i)}
          <li>
            {#if cueNumber(m.index) !== null}
              <button class="link" onclick={() => onjump(m.index)}>Cue {cueNumber(m.index)}</button>
            {/if}
            <span class={m.kind === 'censored' ? 'warning-text' : 'muted'}
              >{m.kind === 'censored' ? 'Censored word' : 'Sound tag'}</span
            >
            <code>{m.text}</code>
          </li>
        {/each}
      </ul>
      {#if editor.review.length > MAX_SHOWN}
        <p class="muted">… and {editor.review.length - MAX_SHOWN} more.</p>
      {/if}
    </details>
  {/if}

  {#if imported.length > 0}
    <details class="imported">
      <summary>Found when the file was opened ({editor.importDiagnostics.length})</summary>
      <p class="muted">
        These were in the original file. Export fixes all errors; the list says how.
      </p>
      <ul>
        {#each imported as [code, g] (code)}
          <li>
            <span class="{g.sample.severity}-text">{SEVERITY_LABEL[g.sample.severity]}</span>
            {g.count > 1 ? `${g.count} ×` : ''}
            {DIAGNOSTICS[g.sample.code].rule}
            <span class="muted">Export: {DIAGNOSTICS[g.sample.code].fix}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</aside>

<style>
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.6rem 0.75rem;
    overflow-y: auto;
    min-height: 0;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.25rem;
  }
  .summary {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }
  .fixes ul {
    list-style: none;
    margin: 0 0 0.4rem;
    padding: 0;
    font-size: 0.88rem;
  }
  .styles-miss .cues {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.6rem;
  }
  .styles-miss .cues li {
    border-bottom: none;
    padding: 0;
  }
  .fixes li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--border);
  }
  .excerpt {
    flex: 1 1 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list,
  .imported ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.88rem;
  }
  .list li,
  .imported li {
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border);
  }
  .sev {
    font-weight: 600;
    margin-right: 0.3rem;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    color: var(--info);
    text-decoration: underline;
    margin-right: 0.3rem;
  }
  .message {
    display: block;
  }
  .spec {
    color: var(--info);
    font-size: 0.8rem;
  }
  .imported,
  .review {
    margin-top: 0.75rem;
  }
  .review ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.88rem;
  }
  .review li {
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--border);
  }
  .review summary {
    cursor: pointer;
  }
  .imported summary {
    cursor: pointer;
  }
  .imported .muted {
    display: block;
  }
</style>
