<!--
  Virtualized cue list: only the rows in view (plus a margin) are in the DOM, so 44k cues scroll
  as smoothly as 40. Rows have a fixed height; the selected cue is edited in CueEditor.
  Ctrl/⌘-click adds or removes a cue from the selection, Shift-click selects a range.
-->
<script lang="ts">
  import type { Editor } from '../editor.svelte.ts';
  import { SEVERITY_LABEL, plainText, worstSeverity } from '../display.ts';
  import { formatTime } from '../time.ts';

  interface Props {
    editor: Editor;
    /** Called when the user asks to edit the selected cue's text (Enter). */
    onedit: () => void;
  }

  let { editor, onedit }: Props = $props();

  const OVERSCAN = 8;
  let viewport: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let height = $state(400);
  let rowHeight = $state(36);

  const rows = $derived(editor.cueRows);
  const first = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN));
  const last = $derived(
    Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN),
  );
  const visible = $derived(rows.slice(first, last));
  const selectedRow = $derived(rows.indexOf(editor.selected));

  $effect(() => {
    if (!viewport) return;
    // The row height follows the root font size (--row-height is in rem).
    rowHeight =
      parseFloat(getComputedStyle(viewport).getPropertyValue('--row-height')) *
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 36;
    const observer = new ResizeObserver(() => {
      if (viewport) height = viewport.clientHeight;
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  });

  // Keep the selected row in view when the selection moves.
  $effect(() => {
    if (!viewport || selectedRow < 0) return;
    const top = selectedRow * rowHeight;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + rowHeight > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = top + rowHeight - viewport.clientHeight;
    }
  });

  function onkeydown(event: KeyboardEvent): void {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: page,
      PageUp: -page,
      Home: -Infinity,
      End: Infinity,
    };
    const delta = moves[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      editor.moveSelection(Number.isFinite(delta) ? delta : delta > 0 ? rows.length : -rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onedit();
    } else if (event.key === 'Delete') {
      event.preventDefault();
      editor.deleteSelected();
    }
  }

  const rowId = (bodyIndex: number): string => `cue-row-${bodyIndex}`;

  function select(event: MouseEvent, bodyIndex: number): void {
    if (event.shiftKey) editor.selectRange(bodyIndex);
    else if (event.ctrlKey || event.metaKey) editor.toggleSelected(bodyIndex);
    else editor.selected = bodyIndex;
  }
</script>

<div class="table">
  <div class="header" aria-hidden="true">
    <span class="num">#</span>
    <span class="time">Start</span>
    <span class="time">End</span>
    <span class="text">Text</span>
    <span class="flag">Problems</span>
  </div>
  <div
    class="viewport"
    bind:this={viewport}
    onscroll={() => (scrollTop = viewport?.scrollTop ?? 0)}
    {onkeydown}
    role="listbox"
    tabindex="0"
    aria-label="Cues"
    aria-multiselectable="true"
    aria-activedescendant={editor.selected >= 0 ? rowId(editor.selected) : undefined}
  >
    {#if rows.length === 0}
      <p class="empty muted">No cues yet. Use “Add cue” to create one.</p>
    {/if}
    <div class="spacer" style:height="{rows.length * rowHeight}px">
      {#each visible as bodyIndex, i (bodyIndex)}
        {@const cue = editor.doc.body[bodyIndex]}
        {@const problems = editor.diagnosticsByItem.get(bodyIndex) ?? []}
        {@const worst = worstSeverity(problems.map((p) => p.severity))}
        {#if cue?.type === 'cue'}
          <div
            id={rowId(bodyIndex)}
            class="row"
            class:selected={editor.isSelected(bodyIndex)}
            class:current={editor.multiple && bodyIndex === editor.selected}
            style:transform="translateY({(first + i) * rowHeight}px)"
            role="option"
            aria-selected={editor.isSelected(bodyIndex)}
            aria-posinset={first + i + 1}
            aria-setsize={rows.length}
            onclick={(e) => select(e, bodyIndex)}
            ondblclick={onedit}
            onkeydown={() => {}}
            tabindex="-1"
          >
            <span class="num muted">{first + i + 1}</span>
            <span class="time">{formatTime(cue.startMs)}</span>
            <span class="time">{formatTime(cue.endMs)}</span>
            <span class="text" title={plainText(cue.text)}>{plainText(cue.text)}</span>
            <span class="flag">
              {#if worst}
                <span class="{worst}-text" title={problems.map((p) => p.message).join('\n')}>
                  {SEVERITY_LABEL[worst]}{problems.length > 1 ? ` ×${problems.length}` : ''}
                </span>
              {/if}
            </span>
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .table {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
  }
  .header,
  .row {
    display: grid;
    grid-template-columns: 4.5rem 7.5rem 7.5rem 1fr 6.5rem;
    gap: 0.5rem;
    align-items: center;
    padding: 0 0.6rem;
  }
  .header {
    height: 2rem;
    border-left: 3px solid transparent; /* Lines columns up with the rows' selection bar. */
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .viewport {
    position: relative;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: var(--row-height);
    border-bottom: 1px solid var(--border);
    cursor: default;
    border-left: 3px solid transparent;
  }
  .row.selected {
    background: var(--selected);
    border-left-color: var(--accent);
  }
  /* In a multiple selection, the cue the editor shows. */
  .row.current {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .time {
    font-family: var(--mono);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .flag {
    font-size: 0.85rem;
  }
  .empty {
    padding: 1rem;
    margin: 0;
  }
</style>
