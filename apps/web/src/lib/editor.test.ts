import { describe, expect, it, vi } from 'vitest';
import type { VttDocument } from '@microvtt/core';
import {
  createCue,
  createDocument,
  exportDocument,
  importDocument,
  validate,
} from '@microvtt/core';
import { Editor } from './editor.svelte.ts';
import { locateInSerialized, locateInSource, serializeWithSpans } from './worker/locate.ts';
import type { VttWorker } from './worker/client.ts';
import type { Autosave } from './worker/protocol.ts';

/** Runs the worker's logic in-process; autosave goes to `store.save`. */
function fakeWorker(store: { save: Autosave | null } = { save: null }): VttWorker {
  return {
    preview: async (doc: VttDocument) => exportDocument(doc).text,
    autosave: async (save: Autosave) => {
      store.save = structuredClone(save);
      return true;
    },
    loadAutosave: async () => store.save,
    clearAutosave: async () => {
      store.save = null;
    },
    import: async (bytes: ArrayBuffer) => {
      const imported = importDocument(new TextDecoder().decode(bytes));
      return { ok: imported.ok, document: imported.document, diagnostics: [] };
    },
    validate: async (doc: VttDocument) => {
      const { text, spans } = serializeWithSpans(doc);
      return locateInSerialized(validate(text).diagnostics, spans);
    },
    export: async (doc: VttDocument) => ({ ...exportDocument(doc), diagnostics: [] }),
  } as unknown as VttWorker;
}

const file = (text: string, name = 'a.vtt'): File => new File([text], name, { type: 'text/vtt' });
const SAMPLE =
  'WEBVTT\n\n00:00.000 --> 00:01.000\none\n\nNOTE between\n\n00:01.000 --> 00:02.000\ntwo\n';

describe('Editor', () => {
  it('opens a file and selects its first cue', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file(SAMPLE));
    expect(editor.hasDocument).toBe(true);
    expect(editor.cueRows).toEqual([0, 2]);
    expect(editor.selectedCue?.text).toBe('one');
    expect(editor.dirty).toBe(false);
  });

  it('refuses files that are not WebVTT', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file('1\n00:00:00,000 --> 00:00:01,000\nhi\n', 'a.srt'));
    expect(editor.hasDocument).toBe(false);
    expect(editor.error).toMatch(/not a WebVTT file/);
  });

  it('undoes and redoes, coalescing typing into one step', async () => {
    vi.useFakeTimers();
    const editor = new Editor(fakeWorker());
    await editor.open(file(SAMPLE));
    for (const text of ['o', 'on', 'one!'])
      editor.updateSelected((c) => ({ ...c, text }), 'Edit text', 'text');
    expect(editor.selectedCue?.text).toBe('one!');
    editor.undo();
    expect(editor.selectedCue?.text).toBe('one');
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(editor.selectedCue?.text).toBe('one!');
    vi.advanceTimersByTime(1500);
    editor.updateSelected((c) => ({ ...c, text: 'later' }), 'Edit text', 'text');
    editor.undo();
    expect(editor.selectedCue?.text).toBe('one!'); // A pause starts a new undo step.
    vi.useRealTimers();
  });

  it('adds after the selection and deletes, keeping a sensible selection', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file(SAMPLE));
    editor.addCue();
    expect(editor.selectedCue).toMatchObject({ startMs: 1000, endMs: 3000, text: '' });
    editor.deleteSelected();
    expect(editor.selectedCue?.text).toBe('two'); // The next cue, as in most list editors.
    editor.deleteSelected();
    expect(editor.selectedCue?.text).toBe('one'); // No next cue: the previous one.
    expect(editor.cueRows).toHaveLength(1);
  });

  it('adds a cue at the playhead in time order', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file(SAMPLE));
    editor.addCue(1500);
    expect(editor.cueRows.map((i) => (editor.doc.body[i] as { startMs: number }).startMs)).toEqual([
      0, 1000, 1500,
    ]);
    expect(editor.selectedCue).toMatchObject({ startMs: 1500, endMs: 3500 });
    editor.addCue(0);
    expect(editor.selected).toBe(1); // After the cue that also starts at 0.
  });

  it('sets times, coalescing repeated nudges into one undo step', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file(SAMPLE));
    editor.setTime('endMs', 1234.4);
    expect(editor.selectedCue?.endMs).toBe(1234);
    editor.nudge('startMs', 100);
    editor.nudge('startMs', 100);
    expect(editor.selectedCue?.startMs).toBe(200);
    editor.undo();
    expect(editor.selectedCue).toMatchObject({ startMs: 0, endMs: 1234 });
  });

  it('splits and merges the selected cue', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file('WEBVTT\n\n00:00.000 --> 00:02.000\n<i>one two</i>\n'));
    editor.splitSelected(1000, 7);
    expect(editor.cueRows).toHaveLength(2);
    expect(editor.selectedCue).toMatchObject({ startMs: 1000, text: '<i>two</i>' });
    editor.moveSelection(-1);
    expect(editor.canMerge).toBe(true);
    editor.mergeWithNext();
    expect(editor.selectedCue).toMatchObject({
      startMs: 0,
      endMs: 2000,
      text: '<i>one</i>\n<00:00:01.000><i>two</i>',
    });
    expect(editor.canMerge).toBe(false);
    editor.splitSelected(5000, 0);
    expect(editor.error).toMatch(/Cannot split/);
  });

  it('opens pasted text', async () => {
    const editor = new Editor(fakeWorker());
    await editor.openText('WEBVTT\n\n00:01.000 --> 00:02.000\npasted\n');
    expect(editor.fileName).toBe('pasted.vtt');
    expect(editor.selectedCue?.text).toBe('pasted');
  });

  it('autosaves edits, restores them, and clears the save once saved', async () => {
    vi.useFakeTimers();
    const store: { save: Autosave | null } = { save: null };
    const editor = new Editor(fakeWorker(store));
    await editor.open(file(SAMPLE));
    editor.updateSelected((c) => ({ ...c, text: 'edited' }), 'Edit text');
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.save?.meta).toMatchObject({ fileName: 'a.vtt', cues: 2 });
    expect(editor.autosaveStatus).toBe('saved');

    const later = new Editor(fakeWorker(store));
    await later.checkAutosave();
    expect(later.restorable?.fileName).toBe('a.vtt');
    await later.restoreAutosave();
    expect(later.selectedCue?.text).toBe('edited');
    expect(later.dirty).toBe(true);

    later.markSaved();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.save).toBeNull();
    vi.useRealTimers();
  });

  it('validates in the background and attaches problems to cues', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file(SAMPLE));
    editor.updateSelected((c) => ({ ...c, text: 'AT&T' }), 'Edit text');
    await vi.waitFor(() =>
      expect(editor.diagnosticsByItem.get(0)?.[0]?.code).toBe('cue-text-character-reference'),
    );
    expect(editor.validating).toBe(false);
  });
});

describe('locating diagnostics', () => {
  it('maps source diagnostics to the items they came from', () => {
    const imported = importDocument('WEBVTT\nKind: captions\n\n00:00.000 --> 00:01.000\nAT&T\n');
    const located = locateInSource(
      validate('WEBVTT\nKind: captions\n\n00:00.000 --> 00:01.000\nAT&T\n').diagnostics,
      imported.document,
    );
    expect(located.map((d) => [d.code, d.list, d.index])).toEqual([
      ['header-text', 'head', 0],
      ['cue-text-character-reference', 'body', 0],
    ]);
  });

  it('maps diagnostics of the serialized document to items', () => {
    const doc: VttDocument = {
      ...createDocument(),
      body: [
        createCue(0, 1000, 'ok'),
        { type: 'note', text: ' x' },
        createCue(500, 400, 'bad <x>'),
      ],
    };
    const { text, spans } = serializeWithSpans(doc);
    const located = locateInSerialized(validate(text).diagnostics, spans);
    expect(new Set(located.map((d) => `${d.list}:${d.index}`))).toEqual(new Set(['body:2']));
  });
});
