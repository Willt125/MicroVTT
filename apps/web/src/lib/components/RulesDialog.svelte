<!--
  The rules of the chosen ruleset: switch rules off and change their settings. Changes are kept
  per ruleset in this browser, and can be reset to the guide's values.
-->
<script lang="ts">
  import {
    RULES,
    RULESETS,
    type QualityRuleId,
    type RuleOverride,
    type RuleOverrides,
  } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';

  interface Props {
    editor: Editor;
    open: boolean;
  }

  let { editor, open = $bindable() }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  const ruleset = $derived(RULESETS.find((r) => r.id === editor.qualitySettings.ruleset));
  const overrides = $derived<RuleOverrides>(
    ruleset ? (editor.qualitySettings.overrides[ruleset.id] ?? {}) : {},
  );
  const entries = $derived(
    ruleset
      ? (Object.entries(ruleset.rules) as [
          QualityRuleId,
          NonNullable<(typeof ruleset.rules)[QualityRuleId]>,
        ][])
      : [],
  );

  function change(id: QualityRuleId, update: (o: RuleOverride) => RuleOverride): void {
    if (!ruleset) return;
    const next: RuleOverrides = { ...overrides, [id]: update(overrides[id] ?? {}) };
    editor.setQualitySettings({
      ...editor.qualitySettings,
      overrides: { ...editor.qualitySettings.overrides, [ruleset.id]: next },
    });
  }

  function value(id: QualityRuleId, key: string): number {
    return (
      overrides[id]?.params?.[key] ??
      ruleset?.rules[id]?.params?.[key] ??
      (RULES[id].defaults[key] as number)
    );
  }

  function reset(): void {
    if (!ruleset) return;
    const rest = { ...editor.qualitySettings.overrides };
    delete rest[ruleset.id];
    editor.setQualitySettings({ ...editor.qualitySettings, overrides: rest });
  }

  const changed = $derived(Object.keys(overrides).length > 0);
  const sourceTitle = (id: string | undefined): string =>
    ruleset?.sources.find((s) => s.id === id)?.title ?? 'MicroVTT';
</script>

<dialog
  bind:this={dialog}
  onclose={() => (open = dialog?.open ?? false)}
  aria-labelledby="rules-heading"
>
  <h2 id="rules-heading">Rules: {ruleset?.name ?? 'none'}</h2>
  <p class="muted">
    Switch rules off or change their settings; changes are kept in this browser, for this ruleset
    only.
  </p>
  <table>
    <tbody>
      {#each entries as [id, entry] (id)}
        {@const rule = RULES[id]}
        <tr>
          <td>
            <label>
              <input
                type="checkbox"
                checked={overrides[id]?.enabled !== false}
                onchange={(e) => {
                  const enabled = e.currentTarget.checked;
                  change(id, (o) => ({ ...o, enabled }));
                }}
              />
              {rule.title}
            </label>
            <div class="muted small">
              {rule.description}
              {#if entry.section}<em>{sourceTitle(entry.source)}, {entry.section}.</em>{/if}
            </div>
          </td>
          <td class="params">
            {#each rule.params as p (p.key)}
              <label class="param">
                <span class="visually-hidden">{rule.title}: {p.label}</span>
                <input
                  type="number"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={Math.round(value(id, p.key) * 100) / 100}
                  disabled={overrides[id]?.enabled === false}
                  onchange={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (!Number.isFinite(n) || n < p.min || n > p.max) return;
                    change(id, (o) => ({ ...o, params: { ...o.params, [p.key]: n } }));
                  }}
                />
                <span class="muted">{p.unit}</span>
              </label>
            {/each}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="actions">
    <button onclick={reset} disabled={!changed}>Reset to the guide’s values</button>
    <button class="primary" onclick={() => (open = false)}>Close</button>
  </div>
</dialog>

<style>
  dialog {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--control);
    border-radius: var(--radius);
    width: min(40rem, 94vw);
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
  td {
    padding: 0.4rem 0.5rem 0.4rem 0;
    vertical-align: top;
    border-top: 1px solid var(--border);
  }
  .small {
    font-size: 0.82rem;
    margin-left: 1.6rem;
  }
  .params {
    white-space: nowrap;
  }
  .param input {
    width: 5.5rem;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: 1rem;
  }
</style>
