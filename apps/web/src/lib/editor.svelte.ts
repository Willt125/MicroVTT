/**
 * Editor state. The document is immutable: every edit produces a new `VttDocument` (core's edit
 * operations are pure), so undo/redo keeps references to earlier documents and never deep-copies.
 * `$state.raw` keeps Svelte from wrapping tens of thousands of cues in reactive proxies.
 */
import type {
  Cue,
  FileType,
  FileTypeGuess,
  LanguageGuess,
  LanguageHintSource,
  QualityFinding,
  QualityRuleId,
  SrtStyle,
  SubtitleFormat,
  VttDocument,
} from '@microvtt/core';
import {
  applyQualityFix as applyQualityFixTo,
  applyQualityFixes,
  applyQuickFix,
  RULES,
  createCue,
  createDocument,
  findQuickFixes,
  cuesStylesMiss,
  wrapAsStylesNeed,
  formatById,
  formatOf,
  WEBVTT,
  guessFileType,
  guessLanguage,
  isValidLanguageTag,
  languageHint,
  mergeCues,
  resyncCues,
  sampleText,
  shiftCues,
  sortCuesMapped,
  splitCue,
  updateCue,
  type SyncPoint,
} from '@microvtt/core';
import type {
  AutoCaptionInfo,
  AutosaveMeta,
  CleanupOptions,
  CleanupResult,
  ExportedFile,
  ExportRequest,
  ItemDiagnostic,
  ReviewMarker,
} from './worker/protocol.ts';
import { sliceDocument } from './media.ts';
import { checkFileName } from './filename.ts';
import {
  loadQualitySettings,
  saveQualitySettings,
  type QualitySettings,
} from './quality-settings.ts';
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
  also: ReadonlySet<number>;
  label: string;
}

/**
 * A set of body indices that is never changed once made (selections are replaced whole, in
 * `$state.raw`), so Svelte's reactive SvelteSet is not needed.
 */
const indexSet = (items: Iterable<number> = []): ReadonlySet<number> => new Set(items);

const NONE = indexSet();

/** Which cues a timing operation applies to. */
export type Scope = 'all' | 'selected';

/** A change of times from the timeline: one edge of one cue, or whole cues moved. */
export type TimeChange =
  | { kind: 'start' | 'end'; index: number; deltaMs: number }
  | { kind: 'move'; indices: readonly number[]; deltaMs: number };

export class Editor {
  doc = $state.raw<VttDocument>(createDocument());
  fileName = $state('untitled.vtt');
  /** The format the document is edited in (it decides the cue text markup and settings). */
  format = $state.raw<SubtitleFormat>(WEBVTT);
  /** How the opened file was written (line endings, byte order mark): saved the same way. */
  style = $state.raw<SrtStyle>({ lineEnding: '\n', byteOrderMark: false });
  fileType = $state<FileType>('captions');
  /** Body index of the selected cue (the one being edited), or -1. */
  #selected = $state(-1);
  /** Other selected cues (body indices), for operations on several cues. */
  #also = $state.raw<ReadonlySet<number>>(NONE);
  /** Where a Shift-click range starts. */
  #anchor = -1;
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
  /** Set when the open file looks like roll-up auto-captions (cleared by cleanup or "New"). */
  autoCaptions = $state.raw<AutoCaptionInfo | null>(null);
  /** Whether to show the offer to clean up (until used or dismissed). */
  cleanupOffered = $state(false);
  /**
   * The text's language (a BCP 47 tag), set on the text fields for spelling, fonts and line
   * breaking; null when unknown. Never changed by a guess without asking.
   */
  language = $state<string | null>(null);
  /** Where `language` came from: the file, or the user. */
  languageSource = $state<LanguageHintSource | 'user' | null>(null);
  /** A confident guess at the language when the file names none, offered until answered. */
  languageGuess = $state.raw<LanguageGuess | null>(null);
  /** A guess that the file holds chapters or metadata, offered until answered. */
  fileTypeGuess = $state.raw<FileTypeGuess | null>(null);
  /** The encoding the open file was read in; not "utf-8" only for files that are not UTF-8. */
  encoding = $state('utf-8');
  encodingGuessed = $state(false);
  /** The open file's bytes, to read them again in another encoding. */
  private sourceBytes: ArrayBuffer | null = null;
  /** Censored words and sound tags in the current document (found with validation). */
  review = $state.raw<ReviewMarker[]>([]);
  /** Style and accessibility findings for the current document (found with validation). */
  quality = $state.raw<QualityFinding[]>([]);
  /** The ruleset and the user's changes to it, kept in this browser. */
  qualitySettings = $state.raw<QualitySettings>(loadQualitySettings());
  /** The open video's frame rate (measured or chosen), for frame-based rules; null if none. */
  #mediaFps = $state<number | null>(null);
  /** The open video's shot changes (ms, sorted), for the shot-change rule. */
  #shotChanges: readonly number[] = [];
  /** Set to check uncleaned auto-captions anyway (they fail most rules until cleaned up). */
  qualityAnyway = $state(false);
  /** The document `quality` was found in; its fixes apply only to that one. */
  private qualityDoc: VttDocument | null = null;

  /** True while checks wait for auto-captions to be cleaned up. */
  get qualityPaused(): boolean {
    return this.autoCaptions !== null && !this.qualityAnyway && this.qualitySettings.ruleset !== '';
  }

  /** Changes the ruleset or its rules, and checks again. */
  setQualitySettings(settings: QualitySettings): void {
    this.qualitySettings = settings;
    saveQualitySettings(settings);
    this.scheduleValidation(0);
  }

  get mediaFps(): number | null {
    return this.#mediaFps;
  }

  /** Sets the video's frame rate; frame-based rules are checked again. */
  set mediaFps(fps: number | null) {
    if (fps === this.#mediaFps) return;
    this.#mediaFps = fps;
    if (this.hasDocument) this.scheduleValidation(0);
  }

  /** Sets the video's shot changes; the shot-change rule is checked again. */
  set shotChanges(times: readonly number[]) {
    if (times === this.#shotChanges) return;
    this.#shotChanges = times;
    if (this.hasDocument) this.scheduleValidation(0);
  }

  /** Checks uncleaned auto-captions anyway. */
  checkQualityAnyway(): void {
    this.qualityAnyway = true;
    this.scheduleValidation(0);
  }

  /** Applies one finding's fix, as one undo step; nothing if the document has changed since. */
  applyQualityFix(finding: QualityFinding): void {
    if (!finding.fix || this.qualityDoc !== this.doc) return;
    this.apply(applyQualityFixTo(this.doc, finding), finding.fix.label);
  }

  /** Applies every fix offered for one rule, as one undo step. */
  applyRuleFixes(rule: QualityRuleId): void {
    if (this.qualityDoc !== this.doc) return;
    const findings = this.quality.filter((f) => f.rule === rule && f.fix);
    if (findings.length === 0) return;
    this.apply(applyQualityFixes(this.doc, findings), `${RULES[rule].title}: fix all`);
  }

  /** Text kept as a comment that was probably meant otherwise (see core's quickfix.ts). */
  quickFixes = $derived(findQuickFixes(this.doc));

  /**
   * Cues the file's own style sheets cannot reach (core's `cuesStylesMiss`): text outside a <c>
   * when a sheet backs <c> spans, timed text outside a tag for :past/:future rules. Captions
   * only: chapter titles and metadata payloads are never wrapped.
   */
  stylesMiss = $derived(
    this.format.id === 'webvtt' && (this.fileType === 'captions' || this.fileType === 'any')
      ? cuesStylesMiss(this.doc)
      : { wrap: 'none' as const, cues: [] },
  );

  /** Wraps the text of every cue the file's styles cannot reach, as one undo step. */
  wrapForFileStyles(): void {
    if (this.stylesMiss.cues.length === 0) return;
    this.apply(wrapAsStylesNeed(this.doc), 'Wrap cue text in <c>');
  }

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

  /** The selected cue's body index. Setting it selects that cue alone. */
  get selected(): number {
    return this.#selected;
  }

  set selected(index: number) {
    this.#selected = index;
    this.#also = NONE;
    this.#anchor = index;
  }

  /** Body indices of every selected cue, in order. */
  selection = $derived.by(() => {
    const all = this.#selected >= 0 ? [this.#selected, ...this.#also] : [...this.#also];
    return all.sort((a, b) => a - b);
  });

  /** True when more than one cue is selected. */
  get multiple(): boolean {
    return this.#also.size > 0;
  }

  isSelected(index: number): boolean {
    return index === this.#selected || this.#also.has(index);
  }

  /** Adds a cue to the selection, or removes it (Ctrl/⌘-click). It becomes the edited cue. */
  toggleSelected(index: number): void {
    let also = [...this.#also];
    if (this.isSelected(index)) {
      if (also.length === 0) return; // The last selected cue stays selected.
      if (index === this.#selected) {
        const next = Math.min(...also);
        also = also.filter((i) => i !== next);
        this.#selected = next;
      } else {
        also = also.filter((i) => i !== index);
      }
    } else {
      if (this.#selected >= 0) also.push(this.#selected);
      this.#selected = index;
    }
    this.#also = indexSet(also);
    this.#anchor = index;
  }

  /** Selects the cues from the last clicked one to `index` (Shift-click). */
  selectRange(index: number): void {
    const rows = this.cueRows;
    const from = rows.indexOf(this.#anchor === -1 ? this.#selected : this.#anchor);
    const to = rows.indexOf(index);
    if (from === -1 || to === -1) {
      this.selected = index;
      return;
    }
    const [a, b] = from < to ? [from, to] : [to, from];
    this.#selected = index;
    this.#also = indexSet(rows.slice(a, b + 1).filter((i) => i !== index));
  }

  selectAll(): void {
    const rows = this.cueRows;
    if (rows.length === 0) return;
    const primary = this.#selected >= 0 ? this.#selected : (rows[0] as number);
    this.#selected = primary;
    this.#also = indexSet(rows.filter((i) => i !== primary));
  }

  get selectedCue(): Cue | null {
    const item = this.doc.body[this.selected];
    return item?.type === 'cue' ? item : null;
  }

  /** Replaces the document as one undoable step. Edits sharing `coalesce` within 1 s merge. */
  apply(
    next: VttDocument,
    label: string,
    options: { coalesce?: string; select?: number; also?: Iterable<number> } = {},
  ): void {
    const now = Date.now();
    const merge =
      options.coalesce !== undefined &&
      options.coalesce === this.lastKey &&
      now - this.lastTime < COALESCE_MS;
    if (!merge) {
      this.past.push({ doc: this.doc, selected: this.#selected, also: this.#also, label });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastKey = options.coalesce ?? null;
    this.lastTime = now;
    this.future = [];
    const sameShape = next.body.length === this.doc.body.length;
    this.doc = next;
    const also = this.#also;
    if (options.select !== undefined) this.selected = options.select;
    if (options.also) this.#also = indexSet(options.also);
    else if (options.select === undefined && sameShape) this.#also = also;
    this.#selected = Math.min(this.#selected, next.body.length - 1);
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

  /** Applies `change` to every selected cue, as one undo step. */
  updateSelection(change: (cue: Cue) => Cue, label: string): void {
    const indices = this.selection;
    if (indices.length === 0) return;
    const body = [...this.doc.body];
    for (const i of indices) {
      const item = body[i];
      if (item?.type === 'cue') body[i] = change(item);
    }
    this.apply(
      { ...this.doc, body },
      indices.length > 1 ? `${label} (${indices.length} cues)` : label,
    );
  }

  /** Applies a change to the whole document (regions, for example), as one undo step. */
  change(change: (doc: VttDocument) => VttDocument, label: string): void {
    this.apply(change(this.doc), label);
  }

  undo(): void {
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push(this.current(entry.label));
    this.restore(entry);
  }

  redo(): void {
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push(this.current(entry.label));
    this.restore(entry);
  }

  private current(label: string): HistoryEntry {
    return { doc: this.doc, selected: this.#selected, also: this.#also, label };
  }

  private restore(entry: HistoryEntry): void {
    this.doc = entry.doc;
    this.selected = Math.min(entry.selected, entry.doc.body.length - 1);
    this.#also = entry.also;
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

  /** Sets the text's language (null for none); a tag that is not valid BCP 47 is refused. */
  setLanguage(tag: string | null): void {
    const value = tag?.trim() || null;
    if (value !== null && !isValidLanguageTag(value))
      throw new Error(`"${value}" is not a language tag (e.g. fi, en-GB, zh-Hant).`);
    this.language = value;
    this.languageSource = value === null ? null : 'user';
    this.languageGuess = null;
  }

  /** Starts a new, empty document. */
  newDocument(): void {
    this.load(createDocument(), 'untitled.vtt', [], null, WEBVTT);
  }

  private load(
    doc: VttDocument,
    name: string,
    importDiagnostics: ItemDiagnostic[],
    autoCaptions: AutoCaptionInfo | null,
    format: SubtitleFormat,
    handle: FileSystemFileHandle | null = null,
  ): void {
    this.doc = doc;
    this.format = format;
    this.fileName = name;
    this.fileHandle = handle;
    this.importDiagnostics = importDiagnostics;
    // Cleanup writes WebVTT word timings: offered for WebVTT documents only.
    this.autoCaptions = autoCaptions?.detected && format.id === 'webvtt' ? autoCaptions : null;
    this.cleanupOffered = this.autoCaptions !== null;
    const hint = languageHint(doc, name);
    this.language = hint?.tag ?? null;
    this.languageSource = hint?.source ?? null;
    this.languageGuess = hint ? null : guessLanguage(sampleText(doc));
    // Every file opens as captions; chapters and metadata are offered when it looks like one.
    this.fileType = 'captions';
    this.fileTypeGuess = format.id === 'webvtt' ? guessFileType(doc, name) : null;
    this.encoding = 'utf-8';
    this.encodingGuessed = false;
    this.style = { lineEnding: '\n', byteOrderMark: false };
    this.sourceBytes = null;
    this.review = [];
    this.quality = [];
    this.qualityDoc = null;
    this.qualityAnyway = false;
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

  /** Opens pasted WebVTT or SubRip text. */
  async openText(text: string, name = `pasted${formatOf('', text).extensions[0]}`): Promise<void> {
    await this.openBytes(new TextEncoder().encode(text).buffer as ArrayBuffer, name, null);
  }

  private async openBytes(
    bytes: ArrayBuffer,
    name: string,
    handle: FileSystemFileHandle | null,
    encoding?: string,
  ): Promise<void> {
    this.busy = `Opening ${name}…`;
    this.error = null;
    // The worker takes the buffer; keep a copy to reread it in another encoding.
    const copy = bytes.slice(0);
    const format = formatOf(
      name,
      new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(512, bytes.byteLength))),
    );
    try {
      const imported = await this.worker.import(bytes, format.id, encoding);
      if (!imported.ok) {
        this.error = `${name} is not a WebVTT or SubRip file: it does not start with "WEBVTT" or a cue's times.`;
        return;
      }
      this.load(
        imported.document,
        name,
        imported.diagnostics,
        imported.autoCaptions,
        format,
        handle,
      );
      this.encoding = imported.encoding;
      this.encodingGuessed = imported.encodingGuessed;
      this.style = imported.style;
      this.sourceBytes = copy;
    } catch (error) {
      this.error = `Could not open ${name}: ${(error as Error).message}`;
    } finally {
      this.busy = null;
    }
  }

  /** Applies the fix offered for `body[index]`, as one undo step. */
  applyQuickFix(index: number): void {
    const fix = this.quickFixes.find((f) => f.index === index);
    if (!fix) return;
    this.apply(applyQuickFix(this.doc, index), fix.label);
  }

  /** Applies every offered fix, as one undo step. */
  applyAllQuickFixes(): void {
    const fixes = this.quickFixes;
    if (fixes.length === 0) return;
    // Last first, so earlier indices stay valid.
    const next = [...fixes].reverse().reduce((doc, f) => applyQuickFix(doc, f.index), this.doc);
    this.apply(next, `Apply ${fixes.length} ${fixes.length === 1 ? 'fix' : 'fixes'}`);
  }

  /** Rereads the open file in another encoding. Only before it is edited (it starts afresh). */
  async reopenWithEncoding(encoding: string): Promise<void> {
    if (!this.sourceBytes || this.dirty) return;
    await this.openBytes(this.sourceBytes.slice(0), this.fileName, this.fileHandle, encoding);
  }

  /** Repairs, serializes and re-validates; does not save anything by itself. */
  async export(options: ExportRequest): Promise<ExportedFile> {
    this.busy = 'Preparing export…';
    try {
      return await this.worker.export(this.doc, this.format.id, {
        ...options,
        fileType: this.fileType,
      });
    } finally {
      this.busy = null;
    }
  }

  /** The document as exported, for the player's caption preview; optionally only some cues. */
  preview(window?: { fromMs: number; toMs: number }): Promise<string> {
    return this.worker.preview(
      window ? sliceDocument(this.doc, window.fromMs, window.toMs) : this.doc,
      this.format.id,
    );
  }

  /**
   * Renames the document (not the file on disk): the new name is what it is saved as. A file
   * opened in place is then no longer saved back to it, only through Save as…. Returns why the
   * name cannot be used, or null.
   */
  rename(input: string): string | null {
    const checked = checkFileName(input, this.format);
    if ('error' in checked) return checked.error;
    if (checked.name === this.fileName) return null;
    this.fileName = checked.name;
    this.fileHandle = null;
    // Not saved under the new name yet.
    this.dirty = true;
    this.scheduleAutosave();
    return null;
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
    this.fileTypeGuess = null;
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
      const next = splitCue(
        this.doc,
        this.selected,
        Math.round(atMs),
        textOffset,
        this.format.text,
      );
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

  /**
   * Merges the selected cues when several consecutive ones are selected, else the selected cue
   * with the next one (notes between them are kept after the merged cue).
   */
  mergeWithNext(): void {
    const range = this.mergeRange();
    if (!range) return;
    const [from, to] = range;
    this.apply(mergeCues(this.doc, from, to, this.format.text), 'Merge cues', { select: from });
  }

  get canMerge(): boolean {
    return this.mergeRange() !== null;
  }

  /** The body indices to merge, or null (a selection with gaps cannot be merged). */
  private mergeRange(): [number, number] | null {
    if (!this.selectedCue) return null;
    if (!this.multiple) {
      const next = this.nextCueIndex();
      return next === -1 ? null : [this.#selected, next];
    }
    const rows = this.cueRows;
    const selected = this.selection.map((i) => rows.indexOf(i));
    const contiguous = selected.every(
      (row, k) => k === 0 || row === (selected[k - 1] as number) + 1,
    );
    return contiguous ? [this.selection[0] as number, this.selection.at(-1) as number] : null;
  }

  /** Checks the current document for auto-caption structure (e.g. before offering cleanup). */
  async detectAutoCaptions(): Promise<AutoCaptionInfo> {
    const info = await this.worker.detect(this.doc);
    this.autoCaptions = info.detected && this.format.id === 'webvtt' ? info : null;
    return info;
  }

  /** Runs cleanup without applying it (for the preview). */
  previewCleanup(options: Partial<CleanupOptions>): Promise<CleanupResult> {
    return this.worker.cleanup(this.doc, options);
  }

  /** Replaces the document with a cleanup result, as one undo step. */
  applyCleanup(result: CleanupResult): void {
    const first = result.document.body.findIndex((item) => item.type === 'cue');
    this.apply(result.document, 'Clean up auto-captions', { select: first });
    this.autoCaptions = null;
    this.cleanupOffered = false;
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
    this.load(
      save.document,
      save.meta.fileName,
      [],
      null,
      formatById(save.meta.format ?? 'webvtt'),
    );
    this.fileType = save.meta.fileType;
    this.fileTypeGuess = null;
    if (save.meta.style) this.style = save.meta.style;
    if (save.meta.language !== undefined) {
      this.language = save.meta.language;
      this.languageSource = save.meta.languageSource ?? null;
      if (this.language !== null) this.languageGuess = null;
    }
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
      format: this.format.id,
      style: this.style,
      fileType: this.fileType,
      savedAt: Date.now(),
      cues: this.cueRows.length,
      language: this.language,
      languageSource: this.languageSource,
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

  /** Deletes the selected cues. */
  deleteSelected(): void {
    const doomed = indexSet(this.selection);
    if (doomed.size === 0 || !this.selectedCue) return;
    const first = Math.min(...doomed);
    const body = this.doc.body.filter((_, i) => !doomed.has(i));
    const next = body.findIndex((item, i) => i >= first && item.type === 'cue');
    const prev = body
      .map((item, i) => (item.type === 'cue' ? i : -1))
      .filter((i) => i >= 0 && i < first)
      .pop();
    this.apply(
      { ...this.doc, body },
      doomed.size === 1 ? 'Delete cue' : `Delete ${doomed.size} cues`,
      {
        select: next !== -1 ? next : (prev ?? -1),
      },
    );
  }

  /** Applies a timing change, then keeps cues in start order, the selection following them. */
  private applyTimes(next: VttDocument, label: string): void {
    const { document, moved } = sortCuesMapped(next);
    const at = (i: number): number => (i >= 0 ? (moved[i] as number) : i);
    this.apply(document, label, {
      select: at(this.#selected),
      also: [...this.#also].map(at),
    });
  }

  /** A change from dragging on the timeline, as one undo step. */
  changeTimes(change: TimeChange): void {
    if (change.deltaMs === 0) return;
    if (change.kind === 'move') {
      const moving = indexSet(change.indices);
      if (moving.size === 0) return;
      this.applyTimes(
        shiftCues(this.doc, change.deltaMs, (_, i) => moving.has(i), this.format.text),
        moving.size === 1 ? 'Move cue' : `Move ${moving.size} cues`,
      );
      return;
    }
    const cue = this.doc.body[change.index];
    if (cue?.type !== 'cue') return;
    const field = change.kind === 'start' ? 'startMs' : 'endMs';
    const body = [...this.doc.body];
    body[change.index] = updateCue(cue, { [field]: Math.max(0, cue[field] + change.deltaMs) });
    this.applyTimes(
      { ...this.doc, body },
      change.kind === 'start' ? 'Change start time' : 'Change end time',
    );
  }

  /** Cues a scope covers. */
  private inScope(scope: Scope): (cue: Cue, index: number) => boolean {
    if (scope === 'all') return () => true;
    const chosen = indexSet(this.selection);
    return (_, i) => chosen.has(i);
  }

  /**
   * Moves the cues in `scope` by `deltaMs`, as one undo step. A shift that would move a cue
   * before 0 is reduced so the earliest one starts at 0. Returns the shift applied.
   */
  shift(deltaMs: number, scope: Scope): number {
    const filter = this.inScope(scope);
    let earliest = Infinity;
    this.doc.body.forEach((item, i) => {
      if (item.type === 'cue' && filter(item, i)) earliest = Math.min(earliest, item.startMs);
    });
    if (earliest === Infinity) return 0;
    const delta = Math.round(Math.max(deltaMs, -earliest));
    if (delta !== 0)
      this.applyTimes(shiftCues(this.doc, delta, filter, this.format.text), 'Shift times');
    return delta;
  }

  /** Two-point resync of the cues in `scope` (see core's `resyncCues`), as one undo step. */
  resync(a: SyncPoint, b: SyncPoint, scope: Scope): void {
    this.applyTimes(
      resyncCues(this.doc, a, b, this.inScope(scope), this.format.text),
      'Resync times',
    );
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
      const { ruleset, overrides } = this.qualitySettings;
      const quality =
        // The style rules (reading speed, line length…) are for text people read as captions.
        ruleset === '' || this.qualityPaused || this.fileType !== 'captions'
          ? null
          : {
              ruleset,
              overrides: overrides[ruleset] ?? {},
              ...(this.#mediaFps ? { fps: this.#mediaFps } : {}),
              ...(this.#shotChanges.length > 0 ? { shotChanges: [...this.#shotChanges] } : {}),
            };
      const checked = await this.worker.validate(doc, this.format.id, this.fileType, quality);
      // Ignore results for documents that have since changed.
      if (version === this.validateVersion) {
        this.diagnostics = checked.diagnostics;
        this.review = checked.review;
        this.quality = checked.quality;
        this.qualityDoc = doc;
      }
    } catch (error) {
      if (version === this.validateVersion)
        this.error = `Validation failed: ${(error as Error).message}`;
    } finally {
      if (version === this.validateVersion) this.validating = false;
    }
  }
}
