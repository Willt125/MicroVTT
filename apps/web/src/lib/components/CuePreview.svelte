<!--
  The selected cue as the spec renderer draws it, in a small 16:9 frame: shows where its
  settings put it, with or without media.
-->
<script lang="ts">
  import type { Cue } from '@microvtt/core';
  import type { Editor } from '../editor.svelte.ts';
  import { CueRenderer } from '../render/renderer.ts';
  import { renderTrackOf } from '../render/track.ts';

  interface Props {
    editor: Editor;
    cue: Cue;
  }

  let { editor, cue }: Props = $props();
  let frame = $state.raw<HTMLDivElement | null>(null);
  let width = $state(0);

  $effect(() => {
    const el = frame;
    if (!el) return;
    const renderer = new CueRenderer(el);
    // Only this cue (and the header: regions and styles), at its start.
    const doc = { ...editor.doc, body: [cue] };
    void width; // Again when the frame is resized.
    renderer.render([renderTrackOf(doc, editor.format.id, editor.language)], cue.startMs);
    return () => renderer.clear();
  });
</script>

<div
  class="preview"
  bind:this={frame}
  bind:clientWidth={width}
  role="img"
  aria-label="Where the cue is drawn"
  data-testid="cue-preview"
></div>

<style>
  .preview {
    position: relative;
    width: min(100%, 24rem);
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    /* A neutral, picture-like ground for white captions. */
    background: linear-gradient(160deg, #3a4a5c, #20262e);
  }
</style>
