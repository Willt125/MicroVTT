/**
 * Export: repair, serialize, then re-validate. The result's `diagnostics` must have no errors;
 * tests enforce that invariant for arbitrary input.
 */
import type { Diagnostic } from './diagnostics.ts';
import type { VttDocument } from './document.ts';
import type { RepairEntry, RepairOptions } from './repair.ts';
import { repair } from './repair.ts';
import type { SerializeOptions } from './serialize.ts';
import { serialize } from './serialize.ts';
import { validate } from './validate.ts';

export interface ExportOptions extends RepairOptions, SerializeOptions {}

export interface ExportResult {
  text: string;
  /** Everything repair changed. */
  report: RepairEntry[];
  /** Validation of the exported text. Contains no errors (warnings are possible). */
  diagnostics: Diagnostic[];
  document: VttDocument;
}

export function exportDocument(doc: VttDocument, options: ExportOptions = {}): ExportResult {
  const { document, report } = repair(doc, options);
  const text = serialize(document, options);
  const check = validate(
    text,
    options.fileType === undefined ? {} : { fileType: options.fileType },
  );
  return { text, report, diagnostics: check.diagnostics, document };
}
