/**
 * Export: repair, apply any player-compatibility fixes, serialize, then re-validate. The result's `diagnostics` must have no errors;
 * tests enforce that invariant for arbitrary input.
 */
import type { CompatibilityId } from './compat.ts';
import { applyCompatibility } from './compat.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { VttDocument } from './document.ts';
import type { RepairEntry, RepairOptions } from './repair.ts';
import { repair } from './repair.ts';
import type { SerializeOptions } from './serialize.ts';
import { serialize } from './serialize.ts';
import { validate } from './validate.ts';

export interface ExportOptions extends RepairOptions, SerializeOptions {
  /** Workarounds for players that misread valid files (see `COMPATIBILITY_FIXES`). */
  compatibility?: readonly CompatibilityId[];
}

export interface ExportResult {
  text: string;
  /** Everything repair changed. */
  report: RepairEntry[];
  /** Validation of the exported text. Contains no errors (warnings are possible). */
  diagnostics: Diagnostic[];
  document: VttDocument;
}

export function exportDocument(doc: VttDocument, options: ExportOptions = {}): ExportResult {
  const repaired = repair(doc, options);
  const { report } = repaired;
  // After repair, which may add comments to the head and leaves cue text valid to re-serialize.
  const document = options.compatibility?.length
    ? applyCompatibility(repaired.document, options.compatibility)
    : repaired.document;
  const text = serialize(document, options);
  const check = validate(
    text,
    options.fileType === undefined ? {} : { fileType: options.fileType },
  );
  return { text, report, diagnostics: check.diagnostics, document };
}
