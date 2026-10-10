import { describe, expect, it, vi } from 'vitest';
import type { VttDocument } from '@microvtt/core';
import { readFileSync } from 'node:fs';
import {
  checkQuality,
  cleanupAutoCaptions,
  createCue,
  createDocument,
  detectAutoCaptions,
  exportDocument,
  findReviewMarkers,
  importDocument,
  rulesetById,
  validate,
} from '@microvtt/core';
import { Editor } from './editor.svelte.ts';
import { locateInSerialized, locateInSource, serializeWithSpans } from './worker/locate.ts';
import type { VttWorker } from './worker/client.ts';
import type { Autosave, AutosaveRequest } from './worker/protocol.ts';

/** Runs the worker's logic in-process; autosave goes to `store.save`. */
function fakeWorker(store: { save: Autosave | null } = { save: null }): VttWorker {
  let validated: VttDocument | null = null;
  return {
    preview: async (doc: VttDocument) => exportDocument(doc).text,
    autosave: async (save: AutosaveRequest) => {
      store.save = structuredClone({ meta: save.meta, document: save.document ?? validated! });
      return true;
    },
    loadAutosave: async () => store.save,
    clearAutosave: async () => {
      store.save = null;
    },
    import: async (bytes: ArrayBuffer) => {
      const imported = importDocument(new TextDecoder().decode(bytes));
      return {
        ok: imported.ok,
        document: imported.document,
        diagnostics: [],
        autoCaptions: detectAutoCaptions(imported.document),
      };
    },
    validate: async (
      doc: VttDocument,
      _fileType: unknown,
      quality: { ruleset: string; overrides: object } | null = null,
    ) => {
      validated = doc;
      const { text, spans } = serializeWithSpans(doc);
      const ruleset = quality && rulesetById(quality.ruleset);
      return {
        diagnostics: locateInSerialized(validate(text).diagnostics, spans),
        review: findReviewMarkers(doc),
        quality: ruleset ? checkQuality(doc, ruleset, quality.overrides) : [],
      };
    },
    detect: async (doc: VttDocument) => detectAutoCaptions(doc),
    cleanup: async (doc: VttDocument, options: object) => cleanupAutoCaptions(doc, options),
    export: async (doc: VttDocument) => ({
      ...exportDocument(doc),
      diagnostics: [],
      compatibility: [],
      youtube: [],
      headerLines: false,
    }),
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
    editor.splitSelected(1000.0000000000002, 7); // Playhead times are floats.
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

  it('offers cleanup for auto-captions and applies it as one undo step', async () => {
    const sample = readFileSync(
      new URL('../../../../packages/core/test/fixtures/autocaption-sample.vtt', import.meta.url),
      'utf8',
    );
    const editor = new Editor(fakeWorker());
    await editor.open(file(sample, 'auto.vtt'));
    expect(editor.cleanupOffered).toBe(true);
    expect(editor.autoCaptions?.language).toBe('en');
    const before = editor.cueRows.length;
    const result = await editor.previewCleanup({ keepWordTimings: false });
    expect(editor.cueRows).toHaveLength(before); // A preview changes nothing.
    editor.applyCleanup(result);
    expect(editor.cueRows.length).toBeLessThan(before);
    expect(editor.selectedCue?.text).toMatch(/^Welcome back to the workshop\./);
    expect(editor.cleanupOffered).toBe(false);
    editor.undo();
    expect(editor.cueRows).toHaveLength(before);
  });

  it('does not offer cleanup for ordinary files, and finds review markers', async () => {
    const editor = new Editor(fakeWorker());
    await editor.open(file('WEBVTT\n\n00:00.000 --> 00:01.000\nwhat the [&nbsp;__&nbsp;]\n'));
    expect(editor.cleanupOffered).toBe(false);
    await vi.waitFor(() => expect(editor.review.map((m) => m.kind)).toEqual(['censored']));
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

describe('selection and timing', () => {
  const FOUR =
    'WEBVTT\n\n00:01.000 --> 00:02.000\na\n\n00:03.000 --> 00:04.000\nb\n\nNOTE c is next\n\n' +
    '00:05.000 --> 00:06.000\nc\n\n00:07.000 --> 00:08.000\nd\n';
  const texts = (editor: Editor): string[] =>
    editor.cueRows.map((i) => (editor.doc.body[i] as { text: string }).text);
  const selectedTexts = (editor: Editor): string[] =>
    editor.selection.map((i) => (editor.doc.body[i] as { text: string }).text);

  async function open(): Promise<Editor> {
    const editor = new Editor(fakeWorker());
    await editor.open(file(FOUR));
    return editor;
  }

  it('selects with toggles and ranges; a plain selection replaces them', async () => {
    const editor = await open();
    editor.toggleSelected(3);
    expect(selectedTexts(editor)).toEqual(['a', 'c']);
    expect(editor.selected).toBe(3);
    editor.selectRange(4);
    expect(selectedTexts(editor)).toEqual(['c', 'd']);
    editor.toggleSelected(4);
    expect(selectedTexts(editor)).toEqual(['c']);
    editor.toggleSelected(3); // The last one stays.
    expect(selectedTexts(editor)).toEqual(['c']);
    editor.selectAll();
    expect(selectedTexts(editor)).toEqual(['a', 'b', 'c', 'd']);
    editor.selected = 1;
    expect(selectedTexts(editor)).toEqual(['b']);
  });

  it('deletes and merges the selection, and undo brings the selection back', async () => {
    const editor = await open();
    editor.selected = 1;
    editor.selectRange(3);
    expect(editor.canMerge).toBe(true);
    editor.mergeWithNext();
    expect(texts(editor)).toEqual(['a', 'b\n<00:00:05.000>c', 'd']);
    editor.undo();
    expect(selectedTexts(editor)).toEqual(['b', 'c']);
    editor.toggleSelected(0);
    editor.toggleSelected(1); // a and c: not consecutive.
    expect(editor.canMerge).toBe(false);
    editor.deleteSelected();
    expect(texts(editor)).toEqual(['b', 'd']);
    expect(editor.doc.body.some((i) => i.type === 'note')).toBe(true);
  });

  it('moves cues from the timeline, keeping start order and the selection', async () => {
    const editor = await open();
    editor.selected = 0;
    editor.toggleSelected(1);
    editor.changeTimes({ kind: 'move', indices: editor.selection, deltaMs: 5500 });
    // a and b now start at 6.5 s and 8.5 s: after c (5 s), around d (7 s).
    expect(texts(editor)).toEqual(['c', 'a', 'd', 'b']);
    expect(selectedTexts(editor)).toEqual(['a', 'b']);
    expect(editor.selectedCue?.text).toBe('b');
    editor.undo();
    expect(texts(editor)).toEqual(['a', 'b', 'c', 'd']);
    editor.selected = 4;
    editor.changeTimes({ kind: 'start', index: 4, deltaMs: -500 });
    expect(editor.selectedCue).toMatchObject({ text: 'd', startMs: 6500, endMs: 8000 });
  });

  it('shifts and resyncs a scope as one undo step each', async () => {
    const editor = await open();
    editor.selected = 3;
    editor.toggleSelected(4);
    expect(editor.shift(-10_000, 'selected')).toBe(-5000); // c reaches 0, no further.
    expect(editor.cueRows.map((i) => (editor.doc.body[i] as { startMs: number }).startMs)).toEqual([
      0, 1000, 2000, 3000,
    ]);
    editor.undo();
    editor.resync({ fromMs: 1000, toMs: 2000 }, { fromMs: 7000, toMs: 14_000 }, 'all');
    expect(editor.cueRows.map((i) => (editor.doc.body[i] as { startMs: number }).startMs)).toEqual([
      2000, 6000, 10_000, 14_000,
    ]);
    editor.undo();
    expect(editor.canUndo).toBe(false);
  });
});

describe('style and accessibility checks', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('checks with the chosen ruleset and applies fixes as undo steps', async () => {
    const editor = new Editor(fakeWorker());
    editor.setQualitySettings({ ruleset: 'netflix-en-us', overrides: {} });
    await editor.open(file('WEBVTT\n\n00:00.000 --> 00:03.000\nWait...  what?\n'));
    await vi.waitFor(() => expect(editor.validating).toBe(false));
    expect(editor.quality.map((f) => f.rule)).toEqual(['ellipsis-character', 'double-space']);
    editor.applyQualityFix(editor.quality[0]!);
    expect(editor.selectedCue?.text).toBe('Wait…  what?');
    await vi.waitFor(() => expect(editor.quality.map((f) => f.rule)).toEqual(['double-space']));
    editor.applyRuleFixes('double-space');
    expect(editor.selectedCue?.text).toBe('Wait… what?');
    editor.undo();
    expect(editor.selectedCue?.text).toBe('Wait…  what?');
  });

  it('ignores a fix found in a document that has since changed', async () => {
    const editor = new Editor(fakeWorker());
    editor.setQualitySettings({ ruleset: 'netflix-en-us', overrides: {} });
    await editor.open(file('WEBVTT\n\n00:00.000 --> 00:03.000\nWait...\n'));
    await vi.waitFor(() => expect(editor.quality).toHaveLength(1));
    const stale = editor.quality[0]!;
    editor.updateSelected((c) => ({ ...c, text: 'Something else' }), 'Edit');
    editor.applyQualityFix(stale);
    expect(editor.selectedCue?.text).toBe('Something else');
    await settle();
  });

  it('waits for auto-captions to be cleaned up, unless asked', async () => {
    const editor = new Editor(fakeWorker());
    editor.setQualitySettings({ ruleset: 'lite', overrides: {} });
    await editor.open(
      file(
        readFileSync(
          new URL(
            '../../../../packages/core/test/fixtures/autocaption-sample.vtt',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    );
    await vi.waitFor(() => expect(editor.validating).toBe(false));
    expect(editor.qualityPaused).toBe(true);
    expect(editor.quality).toEqual([]);
    editor.checkQualityAnyway();
    await vi.waitFor(() => expect(editor.quality.length).toBeGreaterThan(0));
    expect(editor.qualityPaused).toBe(false);
  });
});
