/**
 * Editor state. The document is immutable: every edit produces a new `VttDocument` (core's edit
 * operations are pure), so undo/redo keeps references to earlier documents and never deep-copies.
 * `$state.raw` keeps Svelte from wrapping tens of thousands of cues in reactive proxies.
 */
import type { Cue, ExportOptions, FileType, VttDocument } from '@microvtt/core';
import { createCue, createDocument } from '@microvtt/core';
import type { ExportedFile, ItemDiagnostic } from './worker/protocol.ts';
import type { VttWorker } from './worker/client.ts';

const HISTORY_LIMIT = 500;
/** Successive edits with the same key within this window form one undo step (e.g. typing). */
const COALESCE_MS = 1000;
const VALIDATE_DELAY_MS = 250;

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
  }

  private syncHistory(): void {
    this.canUndo = this.past.length > 0;
    this.canRedo = this.future.length > 0;
  }

  /** Starts a new, empty document. */
  newDocument(): void {
    this.load(createDocument(), 'untitled.vtt', []);
  }

  private load(doc: VttDocument, name: string, importDiagnostics: ItemDiagnostic[]): void {
    this.doc = doc;
    this.fileName = name;
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
  }

  async open(file: File): Promise<void> {
    this.busy = `Opening ${file.name}…`;
    this.error = null;
    try {
      const imported = await this.worker.import(await file.arrayBuffer());
      if (!imported.ok) {
        this.error = `${file.name} is not a WebVTT file: it does not start with "WEBVTT".`;
        return;
      }
      this.load(imported.document, file.name, imported.diagnostics);
    } catch (error) {
      this.error = `Could not open ${file.name}: ${(error as Error).message}`;
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

  markSaved(): void {
    this.dirty = false;
  }

  setFileType(fileType: FileType): void {
    this.fileType = fileType;
    this.scheduleValidation(0);
  }

  /** Inserts a 2-second cue after the selected one (or at the end), and selects it. */
  addCue(): void {
    const at = this.selected >= 0 ? this.selected + 1 : this.doc.body.length;
    const before = this.doc.body
      .slice(0, at)
      .filter((i): i is Cue => i.type === 'cue')
      .pop();
    const start = before ? before.endMs : 0;
    const body = [...this.doc.body];
    body.splice(at, 0, createCue(start, start + 2000, ''));
    this.apply({ ...this.doc, body }, 'Add cue', { select: at });
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
