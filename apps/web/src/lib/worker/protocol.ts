/** Messages between the editor and the worker. */
import type {
  AutoCaptionInfo,
  CleanupOptions,
  CleanupResult,
  CompatibilityId,
  ConversionLoss,
  FeatureId,
  ReviewMarker,
  ExportOptions,
  FileType,
  FormatId,
  ItemDiagnostic,
  LanguageHintSource,
  QualityFinding,
  RepairEntry,
  RuleOverrides,
  SrtStyle,
  VttDocument,
} from '@microvtt/core';

export type { ItemDiagnostic };

export interface ImportedFile {
  /** False when the file is not WebVTT (bad signature). */
  ok: boolean;
  document: VttDocument;
  /** Problems in the file as it was imported. */
  diagnostics: ItemDiagnostic[];
  /** Whether it looks like YouTube auto-captions. */
  autoCaptions: AutoCaptionInfo;
  /** The encoding it was read in ("utf-8" unless it is not valid UTF-8, or one was chosen). */
  encoding: string;
  /** True when a non-UTF-8 encoding was guessed rather than chosen. */
  encodingGuessed: boolean;
  /** How the file was written (line endings, byte order mark), to save it the same way. */
  style: SrtStyle;
}

/** Background checks of the current document. */
export interface Checked {
  diagnostics: ItemDiagnostic[];
  /** Censored words and sound tags to look at. */
  review: ReviewMarker[];
  /** Style and accessibility findings (empty when no ruleset was asked for). */
  quality: QualityFinding[];
}

/** Which style and accessibility rules to check, as the user has set them. */
export interface QualityRequest {
  ruleset: string;
  overrides: RuleOverrides;
  /** The video's frame rate, for frame-based rules, when known. */
  fps?: number;
}

export type { AutoCaptionInfo, CleanupOptions, CleanupResult, ReviewMarker };

/** What to write: the format, and its options (WebVTT's, or line endings, BOM, encoding). */
export interface ExportRequest extends ExportOptions {
  /** The format to write; another than the document's is a conversion. */
  to: FormatId;
  /** The encoding to write; UTF-8 when absent or when the text does not fit in it. */
  encoding?: string;
}

export interface ExportedFile {
  text: string;
  /** The text encoded, when not UTF-8. */
  bytes: Uint8Array | null;
  /** The encoding written. */
  encoding: string;
  /** What a conversion to another format could not carry over (empty when none was made). */
  lost: ConversionLoss[];
  report: RepairEntry[];
  /** Validation of the exported text: no errors by construction. */
  diagnostics: ItemDiagnostic[];
  /** Player-compatibility fixes that would change the document, and how much. */
  compatibility: { id: CompatibilityId; count: number }[];
  /** Whether the source had text under the "WEBVTT" line (`X-TIMESTAMP-MAP`, `Kind:`, …). */
  headerLines: boolean;
  /** Features YouTube does not keep or reports on upload, and how many cues or blocks use them. */
  youtube: { id: FeatureId; count: number }[];
}

/** What an autosave records besides the document. */
export interface AutosaveMeta {
  fileName: string;
  /** The document's format (absent in older saves, which are WebVTT). */
  format?: FormatId;
  /** How the opened file was written (absent in older saves). */
  style?: SrtStyle;
  fileType: FileType;
  /** `Date.now()` when saved. */
  savedAt: number;
  cues: number;
  /** The editor's language and where it came from (absent in older saves). */
  language?: string | null;
  languageSource?: LanguageHintSource | 'user' | null;
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
  | { id: number; type: 'import'; bytes: ArrayBuffer; format: FormatId; encoding?: string }
  | {
      id: number;
      type: 'validate';
      document: VttDocument;
      format: FormatId;
      fileType: FileType;
      quality: QualityRequest | null;
    }
  | {
      id: number;
      type: 'export';
      document: VttDocument;
      format: FormatId;
      options: ExportRequest;
    }
  | { id: number; type: 'preview'; document: VttDocument; format: FormatId }
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
