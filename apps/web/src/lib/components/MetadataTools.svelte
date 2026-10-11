<!--
  Metadata mode, under the payload field: whether a JSON payload parses, Format and One line
  (which also escape the cue-ending arrow inside JSON strings), and what the payload cannot hold.
-->
<script lang="ts">
  import { formatJson, jsonProblem, looksLikeJson, metadataPayloadProblems } from '@microvtt/core';

  interface Props {
    text: string;
    onchange: (text: string, label: string) => void;
  }

  let { text, onchange }: Props = $props();

  const json = $derived(looksLikeJson(text));
  const problem = $derived(json ? jsonProblem(text) : null);
  const problems = $derived(metadataPayloadProblems(text));
</script>

<div class="metadata" aria-label="Payload checks">
  {#if json}
    {#if problem}
      <span class="error-text" role="status">JSON does not parse: {problem}</span>
    {:else}
      <span class="muted" role="status">Valid JSON.</span>
    {/if}
    <button
      class="small"
      disabled={problem !== null}
      title="Indent the JSON, one value per line"
      onclick={() => onchange(formatJson(text, 2), 'Format JSON')}>Format</button
    >
    <button
      class="small"
      disabled={problem !== null}
      title="Write the JSON on one line"
      onclick={() => onchange(formatJson(text, 0), 'Compact JSON')}>One line</button
    >
  {:else}
    <span class="muted">Plain text payload (start it with &#123; or [ for JSON checks).</span>
  {/if}
  {#each problems as p (p)}<span class="warning-text">{p}</span>{/each}
</div>

<style>
  .metadata {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.5rem;
    font-size: 0.85rem;
  }
</style>
