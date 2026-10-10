<script lang="ts">
  import { tick } from 'svelte';
  import { FILE_ENCODINGS } from '@microvtt/core';
  import CleanupDialog from './lib/components/CleanupDialog.svelte';
  import CueEditor from './lib/components/CueEditor.svelte';
  import CueTable from './lib/components/CueTable.svelte';
  import DiagnosticsPanel from './lib/components/DiagnosticsPanel.svelte';
  import ExportDialog from './lib/components/ExportDialog.svelte';
  import FindBar from './lib/components/FindBar.svelte';
  import GlossaryDialog from './lib/components/GlossaryDialog.svelte';
  import HelpDialog from './lib/components/HelpDialog.svelte';
  import MediaPanel from './lib/components/MediaPanel.svelte';
  import QualityPanel from './lib/components/QualityPanel.svelte';
  import RulesDialog from './lib/components/RulesDialog.svelte';
  import Timeline from './lib/components/Timeline.svelte';
  import TimingDialog from './lib/components/TimingDialog.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import { Editor } from './lib/editor.svelte.ts';
  import { canSaveInPlace, droppedHandle, pickVttFile } from './lib/files.ts';
  import { standardRate, stepFrame } from './lib/frames.ts';
  import { isMediaFile, splitOffset, splitTime } from './lib/media.ts';
  import { Player } from './lib/player.svelte.ts';
  import { actionFor, type Action } from './lib/shortcuts.ts';
  import { loadThemeChoice, resolveTheme, saveThemeChoice } from './lib/themes.ts';
  import { VttWorker } from './lib/worker/client.ts';
  import { Waveform } from './lib/waveform/waveform.svelte.ts';

  const editor = new Editor(new VttWorker());
  const player = new Player();
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  void editor.checkAutosave();

  let theme = $state(loadThemeChoice());
  let prefersDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);
  let exportOpen = $state(false);
  let helpOpen = $state(false);
  let findOpen = $state(false);
  let cleanupOpen = $state(false);
  let glossaryOpen = $state(false);
  let timingOpen = $state(false);
  let rulesOpen = $state(false);
  const waveform = new Waveform();
  /** The frame rate frame stepping uses: chosen, or measured from the video. */
  const fps = $derived(
    player.fpsChoice === 'auto' ? standardRate(waveform.fps ?? Number.NaN) : player.fpsChoice,
  );
  // Frame-based style rules (Netflix's frame gaps) use the video's rate.
  $effect(() => {
    editor.mediaFps = player.hasMedia ? fps : null;
  });
  // The waveform follows the loaded media.
  $effect(() => {
    const file = player.file;
    if (file) waveform.open(file, () => player.durationMs);
    else waveform.close();
  });

  // The waveform worker holds its OPFS peak file open (exclusively): let it go when the page
  // goes away, so a reload or another tab can use the cache, and pick it up again if the page
  // comes back from the back/forward cache.
  function onpagehide(): void {
    waveform.close();
  }
  function onpageshow(event: PageTransitionEvent): void {
    if (event.persisted && player.file) waveform.open(player.file, () => player.durationMs);
  }
  // The "not UTF-8" notice, dismissed for the file open now (it comes back for the next one).
  let encodingNoticeDismissed = $state(false);
  $effect(() => {
    void editor.fileName;
    encodingNoticeDismissed = false;
  });
  let mediaInput: HTMLInputElement | undefined = $state();
  let dragging = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let textarea: HTMLTextAreaElement | undefined = $state();

  $effect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent): void => {
      prefersDark = e.matches;
    };
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  });

  $effect(() => {
    document.documentElement.dataset['theme'] = resolveTheme(theme, prefersDark).id;
    saveThemeChoice(theme);
  });

  $effect(() => {
    document.title = editor.hasDocument
      ? `${editor.dirty ? '• ' : ''}${editor.fileName} — MicroVTT`
      : 'MicroVTT';
  });

  // Warn before leaving with unsaved edits.
  $effect(() => {
    const listener = (e: BeforeUnloadEvent): void => {
      if (editor.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  });

  async function openPicker(): Promise<void> {
    if (!canSaveInPlace()) return fileInput?.click();
    try {
      const picked = await pickVttFile();
      if (picked) await openFile(picked.file, picked.handle);
    } catch (error) {
      editor.error = `Could not open the file: ${(error as Error).message}`;
    }
  }

  function openMedia(file: File): void {
    if (!editor.hasDocument) editor.newDocument();
    player.load(file);
  }

  function openExport(): void {
    if (editor.hasDocument) exportOpen = true;
  }

  async function openFile(
    file: File | undefined,
    handle: FileSystemFileHandle | Promise<FileSystemFileHandle | null> | null = null,
  ): Promise<void> {
    if (!file) return;
    if (editor.dirty && !confirm('Discard your unsaved edits and open another file?')) return;
    await editor.open(file, await handle);
  }

  function onpaste(event: ClipboardEvent): void {
    if (
      isTyping(event.target) ||
      exportOpen ||
      helpOpen ||
      cleanupOpen ||
      glossaryOpen ||
      timingOpen ||
      rulesOpen
    )
      return;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!/^\uFEFF?WEBVTT(?:[ \t\r\n]|$)/.test(text)) {
      if (!editor.hasDocument && text.trim() !== '')
        editor.error = 'The pasted text is not WebVTT: it does not start with "WEBVTT".';
      return;
    }
    event.preventDefault();
    if (editor.dirty && !confirm('Discard your unsaved edits and open the pasted text?')) return;
    void editor.openText(text);
  }

  const isEditingCue = (): boolean =>
    document.activeElement?.closest('[aria-label="Selected cue"]') != null;

  /** Runs `change`, keeping focus in the cue text if it was there (the editor is rebuilt). */
  async function keepTextFocus(change: () => void): Promise<void> {
    const refocus = document.activeElement === textarea;
    change();
    if (!refocus) return;
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(0, 0);
  }

  function split(): void {
    const cue = editor.selectedCue;
    if (!cue) return;
    const caret = document.activeElement === textarea ? (textarea?.selectionStart ?? null) : null;
    const playhead = player.hasMedia ? player.currentMs : null;
    const ratio = (ms: number): number => (ms - cue.startMs) / (cue.endMs - cue.startMs);
    const at = splitTime(cue, playhead, caret ?? cue.text.length / 2);
    if (at === null) {
      editor.error = 'Cannot split: the cue is too short.';
      return;
    }
    void keepTextFocus(() => editor.splitSelected(at, caret ?? splitOffset(cue.text, ratio(at))));
  }

  function run(action: Action): void {
    const media = player.hasMedia;
    switch (action) {
      case 'play':
        return player.toggle();
      case 'back':
      case 'forward':
      case 'back-long':
      case 'forward-long':
        if (media)
          player.skip(
            { back: -1000, forward: 1000, 'back-long': -5000, 'forward-long': 5000 }[action],
          );
        return;
      case 'frame-back':
      case 'frame-forward':
        if (media && fps) {
          player.pause();
          player.seek(stepFrame(player.currentMs, fps, action === 'frame-back' ? -1 : 1));
        }
        return;
      case 'set-start':
        if (media) editor.setTime('startMs', player.currentMs);
        return;
      case 'set-end':
        if (media) editor.setTime('endMs', player.currentMs);
        return;
      case 'loop':
        if (media) player.loop = !player.loop;
        return;
      case 'add':
        return editor.addCue(media ? player.currentMs : undefined);
      case 'split':
        return split();
      case 'merge':
        return void keepTextFocus(() => editor.mergeWithNext());
      case 'previous':
        return void keepTextFocus(() => editor.moveSelection(-1));
      case 'next':
        return void keepTextFocus(() => editor.moveSelection(1));
      case 'help':
        helpOpen = true;
        return;
    }
  }

  /** Elements where Space has its own meaning. */
  const ownsSpace = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('button, a, summary, video, audio') !== null;

  function focusText(): void {
    textarea?.focus();
  }

  function jumpTo(bodyIndex: number): void {
    editor.selected = bodyIndex;
    document.querySelector<HTMLElement>('[aria-label="Cues"]')?.focus();
  }

  const isTyping = (target: EventTarget | null): boolean =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement;

  function onkeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) {
      if (
        event.defaultPrevented ||
        !editor.hasDocument ||
        exportOpen ||
        helpOpen ||
        cleanupOpen ||
        glossaryOpen ||
        timingOpen ||
        rulesOpen
      )
        return;
      if (event.key === ' ' && ownsSpace(event.target)) return;
      const action = actionFor(event, isTyping(event.target));
      if (action) {
        event.preventDefault();
        run(action);
      }
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'o') {
      event.preventDefault();
      void openPicker();
    } else if (key === 'f' && editor.hasDocument) {
      event.preventDefault();
      findOpen = true;
    } else if (key === 's') {
      event.preventDefault();
      openExport();
    } else if (key === 'a' && editor.hasDocument && !isTyping(event.target)) {
      event.preventDefault();
      editor.selectAll();
    } else if (!isTyping(event.target) && (key === 'z' || key === 'y')) {
      // Inside text fields the browser's own undo applies.
      event.preventDefault();
      if (key === 'y' || event.shiftKey) editor.redo();
      else editor.undo();
    }
  }
</script>

<svelte:window
  {onpagehide}
  {onpageshow}
  {onkeydown}
  {onpaste}
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (e.relatedTarget === null) dragging = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file && isMediaFile(file)) return openMedia(file);
    // The handle must be requested before the drop event ends.
    void openFile(file, droppedHandle(e.dataTransfer?.items[0]));
  }}
/>

<input
  class="visually-hidden"
  type="file"
  accept=".vtt,text/vtt"
  bind:this={fileInput}
  onchange={(e) => {
    void openFile(e.currentTarget.files?.[0]);
    e.currentTarget.value = '';
  }}
  tabindex="-1"
  aria-hidden="true"
/>
<input
  class="visually-hidden"
  type="file"
  accept="audio/*,video/*"
  bind:this={mediaInput}
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    if (file) openMedia(file);
    e.currentTarget.value = '';
  }}
  tabindex="-1"
  aria-hidden="true"
/>

<div class="app">
  <Toolbar
    {editor}
    bind:theme
    {mod}
    onopen={openPicker}
    onmedia={() => mediaInput?.click()}
    onexport={openExport}
    onsplit={split}
    onfind={() => (findOpen = true)}
    ontiming={() => (timingOpen = true)}
    oncleanup={() => (cleanupOpen = true)}
    onglossary={() => (glossaryOpen = true)}
    onhelp={() => (helpOpen = true)}
  />

  {#if editor.error}
    <p class="banner error-text" role="alert">
      {editor.error}
      <button onclick={() => (editor.error = null)}>Dismiss</button>
    </p>
  {/if}

  {#if editor.hasDocument && editor.encoding !== 'utf-8' && !encodingNoticeDismissed}
    <p class="banner offer" role="status">
      This file is not UTF-8. It was read as
      <select
        aria-label="Read the file as"
        value={editor.encoding}
        disabled={editor.dirty}
        title={editor.dirty ? 'Undo your edits to read the file again' : undefined}
        onchange={(e) => void editor.reopenWithEncoding(e.currentTarget.value)}
      >
        {#each FILE_ENCODINGS as e (e.label)}<option value={e.label}>{e.name}</option>{/each}
      </select>{editor.encodingGuessed ? ' (a guess: check the accented letters)' : ''}. Export
      writes UTF-8.
      <button onclick={() => (encodingNoticeDismissed = true)}>Dismiss</button>
    </p>
  {/if}

  {#if editor.hasDocument && editor.cleanupOffered && editor.autoCaptions}
    <p class="banner offer" role="status">
      This looks like YouTube auto-captions ({editor.autoCaptions.lines.toLocaleString()} caption lines
      in {editor.autoCaptions.cues.toLocaleString()} rolling cues).
      <button class="primary" onclick={() => (cleanupOpen = true)}>Clean up…</button>
      <button onclick={() => (editor.cleanupOffered = false)}>Not now</button>
    </p>
  {/if}

  {#if editor.hasDocument}
    <main class="workspace" class:with-media={player.hasMedia}>
      <section class="cues" aria-label="Cue list and editor">
        <FindBar {editor} bind:open={findOpen} />
        <CueTable {editor} onedit={focusText} />
        <CueEditor {editor} bind:textarea />
      </section>
      <div class="side">
        {#if player.hasMedia}
          <MediaPanel
            {editor}
            {player}
            {fps}
            measuredFps={waveform.fps}
            isEditing={isEditingCue}
            onframe={(delta) => run(delta < 0 ? 'frame-back' : 'frame-forward')}
          />
        {/if}
        <DiagnosticsPanel {editor} onjump={jumpTo} />
        <QualityPanel {editor} onjump={jumpTo} onrules={() => (rulesOpen = true)} />
      </div>
    </main>
    {#if player.hasMedia}
      <Timeline {editor} {player} {waveform} />
    {/if}
  {:else}
    <main class="start">
      <h1>MicroVTT</h1>
      {#if editor.restorable}
        <div class="restore" role="region" aria-label="Unsaved work">
          <p>
            <strong>Unsaved work found:</strong>
            {editor.restorable.fileName}, {editor.restorable.cues.toLocaleString()}
            {editor.restorable.cues === 1 ? 'cue' : 'cues'}, last edited
            {new Date(editor.restorable.savedAt).toLocaleString()}.
          </p>
          <p class="actions">
            <button class="primary" onclick={() => void editor.restoreAutosave()}>Restore</button>
            <button onclick={() => editor.discardAutosave()}>Discard</button>
          </p>
        </div>
      {/if}
      <p>
        Open a WebVTT (.vtt) file, drop one anywhere on this page, paste WebVTT text, or start a new
        one.
      </p>
      <p class="actions">
        <button class="primary" onclick={openPicker}>Open a file…</button>
        <button onclick={() => editor.newDocument()}>New file</button>
      </p>
      <p class="muted">Everything stays on your device: files are never uploaded.</p>
    </main>
  {/if}

  {#if dragging}
    <div class="drop" aria-hidden="true">Drop a .vtt file to open it, or media to play</div>
  {/if}

  <ExportDialog {editor} bind:open={exportOpen} />
  <HelpDialog bind:open={helpOpen} {mod} />
  <CleanupDialog {editor} bind:open={cleanupOpen} />
  <GlossaryDialog {editor} bind:open={glossaryOpen} />
  <TimingDialog {editor} {player} bind:open={timingOpen} />
  <RulesDialog {editor} bind:open={rulesOpen} />
</div>

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
  }
  .workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
    gap: 0.75rem;
    padding: 0.75rem;
  }
  .workspace.with-media {
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 32rem);
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }
  .side > :global(.panel) {
    flex: 1;
  }
  .cues {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }
  @media (max-width: 52rem) {
    .workspace,
    .workspace.with-media {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }
  }
  .start {
    margin: auto;
    max-width: 32rem;
    padding: 2rem 1rem;
    text-align: center;
  }
  .restore {
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    padding: 0.5rem 1rem;
    margin-bottom: 1.5rem;
  }
  .start .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
  .banner {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
  .drop {
    position: fixed;
    inset: 0.75rem;
    display: grid;
    place-items: center;
    border: 3px dashed var(--accent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    font-size: 1.3rem;
    pointer-events: none;
  }
</style>
