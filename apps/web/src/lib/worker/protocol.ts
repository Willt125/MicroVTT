/** Messages between the editor and the WebVTT worker. */
import type {
  AutoCaptionInfo,
  CleanupOptions,
  CleanupResult,
  CompatibilityId,
  DiagnosticCode,
  FeatureId,
  ReviewMarker,
  ExportOptions,
  FileType,
  RepairEntry,
  Severity,
  VttDocument,
} from '@microvtt/core';

/** A diagnostic attached to a document item rather than a text offset. */
export interface ItemDiagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Where it applies: an index into `head` or `body`, or the file as a whole. */
  list: 'head' | 'body' | 'file';
  index: number;
}

export interface ImportedFile {
  /** False when the file is not WebVTT (bad signature). */
  ok: boolean;
  document: VttDocument;
  /** Problems in the file as it was imported. */
  diagnostics: ItemDiagnostic[];
  /** Whether it looks like YouTube auto-captions. */
  autoCaptions: AutoCaptionInfo;
}

/** Background checks of the current document. */
export interface Checked {
  diagnostics: ItemDiagnostic[];
  /** Censored words and sound tags to look at. */
  review: ReviewMarker[];
}

export type { AutoCaptionInfo, CleanupOptions, CleanupResult, ReviewMarker };

export interface ExportedFile {
  text: string;
  report: RepairEntry[];
  /** Validation of the exported text: no errors by construction. */
  diagnostics: ItemDiagnostic[];
  /** Player-compatibility fixes that would change the document, and how much. */
  compatibility: { id: CompatibilityId; count: number }[];
  /** Features YouTube is not known to keep, and how many cues or blocks use them. */
  youtube: { id: FeatureId; count: number }[];
}

/** What an autosave records besides the document. */
export interface AutosaveMeta {
  fileName: string;
  fileType: FileType;
  /** `Date.now()` when saved. */
  savedAt: number;
  cues: number;
}

export interface Autosave {
  meta: AutosaveMeta;
  document: VttDocument;
}

/** An autosave request; without a document, the one last sent for validation is saved. */
export interface AutosaveRequest {
  meta: AutosaveMeta;
  document?: VttDocument;
}

export type WorkerRequest =
  | { id: number; type: 'import'; bytes: ArrayBuffer }
  | { id: number; type: 'validate'; document: VttDocument; fileType: FileType }
  | { id: number; type: 'export'; document: VttDocument; options: ExportOptions }
  | { id: number; type: 'preview'; document: VttDocument }
  | { id: number; type: 'detect'; document: VttDocument }
  | {
      id: number;
      type: 'cleanup';
      document: VttDocument;
      options: Partial<CleanupOptions>;
    }
  | { id: number; type: 'autosave'; save: AutosaveRequest }
  | { id: number; type: 'load-autosave' }
  | { id: number; type: 'clear-autosave' };

export type WorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
