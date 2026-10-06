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

/** Runs the worker's logic in-process. */
function fakeWorker(): VttWorker {
  return {
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
