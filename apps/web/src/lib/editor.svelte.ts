/**
 * Editor state. The document is immutable: every edit produces a new `VttDocument` (core's edit
 * operations are pure), so undo/redo keeps references to earlier documents and never deep-copies.
 * `$state.raw` keeps Svelte from wrapping tens of thousands of cues in reactive proxies.
 */
import type { Cue, ExportOptions, FileType, VttDocument } from '@microvtt/core';
import { createCue, createDocument, mergeCues, splitCue, updateCue } from '@microvtt/core';
import type { AutosaveMeta, ExportedFile, ItemDiagnostic } from './worker/protocol.ts';
import { sliceDocument } from './media.ts';
import type { VttWorker } from './worker/client.ts';

const HISTORY_LIMIT = 500;
/** Successive edits with the same key within this window form one undo step (e.g. typing). */
const COALESCE_MS = 1000;
const VALIDATE_DELAY_MS = 250;
const AUTOSAVE_DELAY_MS = 1500;
const NEW_CUE_MS = 2000;

interface HistoryEntry {
  doc: VttDocument;
  selected: number;
  label: string;
}

export class Editor {
  doc = $state.raw<VttDocument>(createDocument());
  fileName = $state('untitled.vtt');
  fileType = $state<FileType>('captions');
  /** Body index of the selected cue, or -1. */
  selected = $state(-1);
  /** Problems in the current document (validated in the background after each edit). */
  diagnostics = $state.raw<ItemDiagnostic[]>([]);
  /** Problems in the file as imported (cleared by "New"). */
  importDiagnostics = $state.raw<ItemDiagnostic[]>([]);
  dirty = $state(false);
  /** True until the current document's first background validation has finished. */
  validating = $state(false);
  busy = $state<string | null>(null);
  error = $state<string | null>(null);
  hasDocument = $state(false);
  canUndo = $state(false);
  canRedo = $state(false);
  /** Where the open file came from, if it can be saved back in place (Chromium). */
  fileHandle = $state.raw<FileSystemFileHandle | null>(null);
  /** 'unsupported' where the browser has no OPFS (or it is unavailable, e.g. private mode). */
  autosaveStatus = $state<'idle' | 'saved' | 'unsupported' | 'failed'>('idle');
  /** Unsaved work from an earlier session, offered for restore on the start screen. */
  restorable = $state.raw<AutosaveMeta | null>(null);

  /** Body indices of cues, in order: row i of the cue table shows body[cueRows[i]]. */
  cueRows = $derived.by(() => {
    const rows: number[] = [];
    this.doc.body.forEach((item, i) => {
      if (item.type === 'cue') rows.push(i);
    });
    return rows;
  });

  /** Diagnostics per body index, for row badges. */
  diagnosticsByItem = $derived.by(() => {
    // Rebuilt from scratch on each change and never mutated afterwards, so a plain Map is right.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<number, ItemDiagnostic[]>();
    for (const d of this.diagnostics) {
      if (d.list !== 'body') continue;
      const list = map.get(d.index);
      if (list) list.push(d);
      else map.set(d.index, [d]);
    }
    return map;
  });

  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private lastKey: string | null = null;
  private lastTime = 0;
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private validateVersion = 0;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once this session has written an autosave (so it may also clear it). */
  private autosaved = false;
  /** The document the worker last received (for validation); autosave need not resend it. */
  private workerDoc: VttDocument | null = null;
  private readonly worker: VttWorker;

  constructor(worker: VttWorker) {
    this.worker = worker;
  }

  get selectedCue(): Cue | null {
    const item = this.doc.body[this.selected];
    return item?.type === 'cue' ? item : null;
  }

  /** Replaces the document as one undoable step. Edits sharing `coalesce` within 1 s merge. */
  apply(
    next: VttDocument,
    label: string,
    options: { coalesce?: string; select?: number } = {},
  ): void {
    const now = Date.now();
    const merge =
      options.coalesce !== undefined &&
      options.coalesce === this.lastKey &&
      now - this.lastTime < COALESCE_MS;
    if (!merge) {
      this.past.push({ doc: this.doc, selected: this.selected, label });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastKey = options.coalesce ?? null;
    this.lastTime = now;
    this.future = [];
    this.doc = next;
    if (options.select !== undefined) this.selected = options.select;
    this.selected = Math.min(this.selected, next.body.length - 1);
    this.dirty = true;
    this.syncHistory();
    this.scheduleValidation();
    this.scheduleAutosave();
  }

  /** Applies a change to the selected cue. */
  updateSelected(change: (cue: Cue) => Cue, label: string, coalesce?: string): void {
    const cue = this.selectedCue;
    if (!cue) return;
    const body = [...this.doc.body];
    body[this.selected] = change(cue);
    this.apply(
      { ...this.doc, body },
      label,
      coalesce === undefined ? {} : { coalesce: `${coalesce}:${this.selected}` },
    );
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push({ doc: this.doc, selected: this.selected, label: entry.label });
    this.restore(entry);
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push({ doc: this.doc, selected: this.selected, label: entry.label });
    this.restore(entry);
  }

  private restore(entry: HistoryEntry): void {
    this.doc = entry.doc;
    this.selected = Math.min(entry.selected, entry.doc.body.length - 1);
    this.lastKey = null;
    this.dirty = true;
    this.syncHistory();
    this.scheduleValidation();
    this.scheduleAutosave();
  }

  private syncHistory(): void {
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
  }

  /** Starts a new, empty document. */
  newDocument(): void {
    this.load(createDocument(), 'untitled.vtt', []);
  }

  private load(
    doc: VttDocument,
    name: string,
    importDiagnostics: ItemDiagnostic[],
    handle: FileSystemFileHandle | null = null,
  ): void {
    this.doc = doc;
    this.fileName = name;
    this.fileHandle = handle;
    this.importDiagnostics = importDiagnostics;
    this.diagnostics = [];
    this.validating = true;
    this.selected = doc.body.findIndex((item) => item.type === 'cue');
    this.past = [];
    this.future = [];
    this.lastKey = null;
    this.dirty = false;
    this.hasDocument = true;
    this.error = null;
    this.syncHistory();
    this.scheduleValidation(0);
    // This session's earlier autosave belonged to the document just replaced.
    if (this.autosaved) this.discardAutosave();
  }

  /** Opens a file; `handle` (where available) lets it be saved back in place. */
  async open(file: File, handle: FileSystemFileHandle | null = null): Promise<void> {
    await this.openBytes(await file.arrayBuffer(), file.name, handle);
  }

  /** Opens pasted WebVTT text. */
  async openText(text: string, name = 'pasted.vtt'): Promise<void> {
    await this.openBytes(new TextEncoder().encode(text).buffer as ArrayBuffer, name, null);
  }

  private async openBytes(
    bytes: ArrayBuffer,
    name: string,
    handle: FileSystemFileHandle | null,
  ): Promise<void> {
    this.busy = `Opening ${name}…`;
    this.error = null;
    try {
      const imported = await this.worker.import(bytes);
      if (!imported.ok) {
        this.error = `${name} is not a WebVTT file: it does not start with "WEBVTT".`;
        return;
      }
      this.load(imported.document, name, imported.diagnostics, handle);
    } catch (error) {
      this.error = `Could not open ${name}: ${(error as Error).message}`;
    } finally {
      this.busy = null;
    }
  }

  /** Repairs, serializes and re-validates; does not save anything by itself. */
  async export(options: ExportOptions): Promise<ExportedFile> {
    this.busy = 'Preparing export…';
    try {
      return await this.worker.export(this.doc, { ...options, fileType: this.fileType });
    } finally {
      this.busy = null;
    }
  }

  /** The document as exported, for the player's caption preview; optionally only some cues. */
  preview(window?: { fromMs: number; toMs: number }): Promise<string> {
    return this.worker.preview(
      window ? sliceDocument(this.doc, window.fromMs, window.toMs) : this.doc,
    );
  }

  /** Records a save; `handle` and `name` are where it went, when saved through a picker. */
  markSaved(handle?: FileSystemFileHandle): void {
    this.dirty = false;
    if (handle) {
      this.fileHandle = handle;
      this.fileName = handle.name;
    }
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.discardAutosave();
  }

  setFileType(fileType: FileType): void {
    this.fileType = fileType;
    this.scheduleValidation(0);
  }

  /**
   * Inserts a 2-second cue and selects it. With `atMs` (the playhead), it starts there and goes
   * after the last cue starting no later; otherwise it follows the selected cue (or the end).
   */
  addCue(atMs?: number): void {
    let at: number;
    let start: number;
    if (atMs === undefined) {
      at = this.selected >= 0 ? this.selected + 1 : this.doc.body.length;
      const before = this.doc.body
        .slice(0, at)
        .filter((i): i is Cue => i.type === 'cue')
        .pop();
      start = before ? before.endMs : 0;
    } else {
      start = Math.max(0, Math.round(atMs));
      let last = -1;
      for (const i of this.cueRows) if ((this.doc.body[i] as Cue).startMs <= start) last = i;
      at = last === -1 ? (this.cueRows[0] ?? this.doc.body.length) : last + 1;
    }
    const body = [...this.doc.body];
    body.splice(at, 0, createCue(start, start + NEW_CUE_MS, ''));
    this.apply({ ...this.doc, body }, 'Add cue', { select: at });
  }

  /** Sets the selected cue's start or end (e.g. to the playhead). */
  setTime(field: 'startMs' | 'endMs', ms: number, coalesce?: string): void {
    const value = Math.max(0, Math.round(ms));
    if (!this.selectedCue || this.selectedCue[field] === value) return;
    this.updateSelected(
      (c) => updateCue(c, { [field]: value }),
      field === 'startMs' ? 'Set start time' : 'Set end time',
      coalesce,
    );
  }

  /** Moves the selected cue's start or end by `deltaMs`. Repeated nudges are one undo step. */
  nudge(field: 'startMs' | 'endMs', deltaMs: number): void {
    const cue = this.selectedCue;
    if (cue) this.setTime(field, cue[field] + deltaMs, `nudge-${field}`);
  }

  /** Splits the selected cue at `atMs`, dividing its text at `textOffset`; selects the second. */
  splitSelected(atMs: number, textOffset: number): void {
    if (!this.selectedCue) return;
    try {
      const next = splitCue(this.doc, this.selected, Math.round(atMs), textOffset);
      this.apply(next, 'Split cue', { select: this.selected + 1 });
    } catch (error) {
      this.error = `Cannot split: ${(error as Error).message}.`;
    }
  }

  /** The next cue row's body index after the selected cue, or -1. */
  private nextCueIndex(): number {
    const row = this.cueRows.indexOf(this.selected);
    return row === -1 ? -1 : (this.cueRows[row + 1] ?? -1);
  }

  /** Merges the selected cue with the next one (notes between them are kept after it). */
  mergeWithNext(): void {
    const next = this.nextCueIndex();
    if (!this.selectedCue || next === -1) return;
    this.apply(mergeCues(this.doc, this.selected, next), 'Merge cues', { select: this.selected });
  }

  get canMerge(): boolean {
    return this.selectedCue !== null && this.nextCueIndex() !== -1;
  }

  /** Looks for unsaved work from an earlier session. */
  async checkAutosave(): Promise<void> {
    try {
      const save = await this.worker.loadAutosave();
      this.restorable = save?.meta ?? null;
    } catch {
      this.restorable = null;
    }
  }

  async restoreAutosave(): Promise<void> {
    const save = await this.worker.loadAutosave();
    if (!save) {
      this.restorable = null;
      this.error = 'The unsaved work could not be read.';
      return;
    }
    this.load(save.document, save.meta.fileName, []);
    this.fileType = save.meta.fileType;
    this.dirty = true;
    this.autosaved = true; // It is this session's work now.
    this.restorable = null;
  }

  discardAutosave(): void {
    this.restorable = null;
    this.autosaved = false;
    void this.worker.clearAutosave().catch(() => {});
  }

  private scheduleAutosave(): void {
    if (this.autosaveStatus === 'unsupported') return;
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.autosaveNow(), AUTOSAVE_DELAY_MS);
  }

  private async autosaveNow(): Promise<void> {
    this.autosaveTimer = null;
    if (!this.dirty) return;
    const meta: AutosaveMeta = {
      fileName: this.fileName,
      fileType: this.fileType,
      savedAt: Date.now(),
      cues: this.cueRows.length,
    };
    try {
      // The worker handles requests in order, so it still holds `workerDoc` when this arrives.
      const ok = await this.worker.autosave(
        this.doc === this.workerDoc ? { meta } : { meta, document: this.doc },
      );
      this.autosaveStatus = ok ? 'saved' : 'unsupported';
      if (ok) this.autosaved = true;
    } catch {
      this.autosaveStatus = 'failed';
    }
  }

  deleteSelected(): void {
    if (!this.selectedCue) return;
    const body = this.doc.body.filter((_, i) => i !== this.selected);
    const next = body.findIndex((item, i) => i >= this.selected && item.type === 'cue');
    const prev = body
      .map((item, i) => (item.type === 'cue' ? i : -1))
      .filter((i) => i >= 0 && i < this.selected)
      .pop();
    this.apply({ ...this.doc, body }, 'Delete cue', { select: next !== -1 ? next : (prev ?? -1) });
  }

  /** Moves the selection by `delta` cue rows. */
  moveSelection(delta: number): void {
    const rows = this.cueRows;
    if (rows.length === 0) return;
    const current = rows.indexOf(this.selected);
    const target = current === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, current + delta));
    this.selected = rows[target] as number;
  }

  private scheduleValidation(delay = VALIDATE_DELAY_MS): void {
    if (this.validateTimer !== null) clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => void this.validateNow(), delay);
  }

  private async validateNow(): Promise<void> {
    const version = ++this.validateVersion;
    this.validating = true;
    const doc = this.doc;
    this.workerDoc = doc;
    try {
      const diagnostics = await this.worker.validate(doc, this.fileType);
      // Ignore results for documents that have since changed.
      if (version === this.validateVersion) this.diagnostics = diagnostics;
    } catch (error) {
      if (version === this.validateVersion)
        this.error = `Validation failed: ${(error as Error).message}`;
    } finally {
      if (version === this.validateVersion) this.validating = false;
    }
  }
}
