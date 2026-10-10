<!--
  Style and accessibility findings: rules from a chosen style guide or accessibility guidance,
  listed apart from the format's problems (they never block export). Grouped by rule, with a
  fix where one is clear.
-->
<script lang="ts">
  import { RULES, RULESETS, type QualityFinding, type QualityRuleId } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import { SEVERITY_LABEL } from '../display.ts';

  interface Props {
    editor: Editor;
    /** Selects a cue and moves focus to the table. */
    onjump: (bodyIndex: number) => void;
    /** Opens the rules dialog. */
    onrules: () => void;
  }

  let { editor, onjump, onrules }: Props = $props();

  const MAX_SHOWN = 200;
  const ruleset = $derived(RULESETS.find((r) => r.id === editor.qualitySettings.ruleset));

  /** Findings by rule, in the ruleset's order. */
  const groups = $derived.by(() => {
    // Rebuilt whole on each change and never mutated afterwards.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const byRule = new Map<QualityRuleId, QualityFinding[]>();
    for (const f of editor.quality) {
      const list = byRule.get(f.rule);
      if (list) list.push(f);
      else byRule.set(f.rule, [f]);
    }
    const order = Object.keys(ruleset?.rules ?? {});
    return [...byRule.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  });
  const counts = $derived({
    warning: editor.quality.filter((f) => f.severity === 'warning').length,
    info: editor.quality.filter((f) => f.severity === 'info').length,
  });

  const rowOf = $derived(
    Object.fromEntries(editor.cueRows.map((bodyIndex, row) => [bodyIndex, row + 1])) as Record<
      number,
      number
    >,
  );

  function choose(id: string): void {
    editor.setQualitySettings({ ...editor.qualitySettings, ruleset: id });
  }

  const sourceOf = (id: QualityRuleId): string => {
    const entry = ruleset?.rules[id];
    const guide = ruleset?.sources.find((s) => s.id === entry?.source);
    return guide && entry?.section ? `${guide.title}, ${entry.section}` : 'MicroVTT';
  };
</script>

<aside class="panel" aria-labelledby="quality-heading">
  <div class="head">
    <h2 id="quality-heading">Style and accessibility</h2>
    <button class="small" onclick={onrules} disabled={!ruleset}>Rules…</button>
  </div>
  <label class="choose">
    Check against
    <select value={editor.qualitySettings.ruleset} onchange={(e) => choose(e.currentTarget.value)}>
      {#each RULESETS as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
      <option value="">Nothing</option>
    </select>
  </label>

  {#if !ruleset}
    <p class="muted">Style checks are off.</p>
  {:else if editor.qualityPaused}
    <p class="muted">
      Waiting for the auto-captions to be cleaned up: until then, almost every cue fails these
      checks.
      <button class="small" onclick={() => editor.checkQualityAnyway()}>Check anyway</button>
    </p>
  {:else}
    <p class="quality-summary" role="status">
      {#if editor.validating && editor.quality.length === 0}
        <span class="muted">Checking…</span>
      {:else if editor.quality.length === 0}
        <span class="muted">Nothing to report.</span>
      {:else}
        <span class="warning-text"
          >{counts.warning} {counts.warning === 1 ? 'warning' : 'warnings'}</span
        >
        {#if counts.info > 0}· <span class="info-text"
            >{counts.info} {counts.info === 1 ? 'note' : 'notes'}</span
          >{/if}
      {/if}
    </p>
    {#each groups as [rule, findings] (rule)}
      {@const fixable = findings.filter((f) => f.fix).length}
      <details class="group">
        <summary>
          <span class="{findings[0]?.severity}-text sev"
            >{SEVERITY_LABEL[findings[0]?.severity ?? 'info']}</span
          >
          {RULES[rule].title} ({findings.length})
        </summary>
        <p class="muted rule">{RULES[rule].description} <em>{sourceOf(rule)}</em></p>
        {#if fixable > 1}
          <button class="small" onclick={() => editor.applyRuleFixes(rule)}
            >Fix all {fixable}</button
          >
        {/if}
        <ul>
          {#each findings.slice(0, MAX_SHOWN) as f, i (i)}
            <li>
              {#if f.list === 'body' && rowOf[f.index] !== undefined}
                <button class="link" onclick={() => onjump(f.index)}>Cue {rowOf[f.index]}</button>
              {:else}
                <span class="muted">Style sheet</span>
              {/if}
              <span class="message">{f.message}</span>
              {#if f.fix}
                <button class="small" onclick={() => editor.applyQualityFix(f)}
                  >{f.fix.label}</button
                >
              {/if}
            </li>
          {/each}
        </ul>
        {#if findings.length > MAX_SHOWN}
          <p class="muted">… and {findings.length - MAX_SHOWN} more.</p>
        {/if}
      </details>
    {/each}
    <details class="about">
      <summary>About these checks</summary>
      <p class="muted">{ruleset.description}</p>
      {#if ruleset.sources.length > 0}
        <ul>
          {#each ruleset.sources as s (s.id)}
            <li>
              {#if s.url}<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a
                >{:else}{s.title}{/if}
              <span class="muted">({s.edition})</span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if ruleset.notChecked.length > 0}
        <p class="muted">Not checked:</p>
        <ul class="muted">
          {#each ruleset.notChecked as n (n)}<li>{n}</li>{/each}
        </ul>
      {/if}
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
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 0.25rem;
  }
  .choose {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.9rem;
    margin-bottom: 0.4rem;
  }
  .quality-summary {
    margin: 0 0 0.4rem;
    font-size: 0.9rem;
  }
  .small {
    padding: 0.1rem 0.5rem;
    font-size: 0.85rem;
  }
  .group summary,
  .about summary {
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0.2rem 0;
  }
  .sev {
    font-weight: 600;
    margin-right: 0.3rem;
  }
  .rule {
    font-size: 0.85rem;
    margin: 0.2rem 0 0.3rem;
  }
  ul {
    list-style: none;
    margin: 0 0 0.4rem;
    padding: 0;
    font-size: 0.88rem;
  }
  li {
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--border);
  }
  .about ul li {
    border-bottom: none;
    padding: 0.15rem 0;
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
  .about {
    margin-top: 0.6rem;
    font-size: 0.88rem;
  }
  .about a {
    color: var(--info);
  }
</style>
