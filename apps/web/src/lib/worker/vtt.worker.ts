/**
 * Parsing, validation and export run here, off the main thread, so a 12-hour file never
 * blocks typing or scrolling.
 */
import {
  checkQuality,
  cleanupAutoCaptions,
  decodeFile,
  hasHeaderLines,
  compatibilityIssues,
  detectAutoCaptions,
  exportDocument,
  encodeText,
  findReviewMarkers,
  formatById,
  importDocument,
  parseSrt,
  rulesetById,
  srtToVtt,
  validate,
  validateImport,
  validateSrt,
  vttToSrt,
  writeSrt,
  youtubeCheck,
  type ConversionLoss,
  type FormatId,
} from '@microvtt/core';
import { clearAutosave, readAutosave, writeAutosave } from './autosave.ts';
import { locateInSerialized, locateInSource, serializeWithSpans } from './locate.ts';
import type { FileType, VttDocument } from '@microvtt/core';
import type {
  Checked,
  ExportedFile,
  ExportRequest,
  ImportedFile,
  ItemDiagnostic,
  WorkerRequest,
  WorkerResponse,
} from './protocol.ts';

// The app's TypeScript config uses the DOM library; describe just the worker scope we use.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

/** The document last sent for validation: autosave reuses it rather than copying it again. */
let current: VttDocument | null = null;

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.type) {
    case 'import': {
      const bytes = new Uint8Array(request.bytes);
      // WebVTT is UTF-8 (spec §6.1); a file that is not is read in the encoding it was saved in.
      // SubRip has no rule, and is often in a legacy encoding.
      const decoded = decodeFile(bytes, request.encoding);
      const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      const srt = request.format === 'srt';
      const encodingDiagnostic = (): ItemDiagnostic[] =>
        decoded.encoding === 'utf-8'
          ? []
          : [
              {
                code: srt ? 'srt-encoding' : 'file-encoding',
                severity: srt ? 'info' : 'error',
                message: `The file is not UTF-8; it was read as ${decoded.encoding}${decoded.guessed ? ' (a guess)' : ''}. ${srt ? 'Export writes UTF-8 unless you choose this encoding.' : 'Export writes UTF-8.'}`,
                list: 'file',
                index: 0,
              },
            ];
      if (srt) {
        const imported = parseSrt((bom ? '\uFEFF' : '') + decoded.text);
        return {
          ok: true,
          document: imported.document,
          diagnostics: [...encodingDiagnostic(), ...imported.diagnostics],
          autoCaptions: detectAutoCaptions(imported.document),
          encoding: decoded.encoding,
          encodingGuessed: decoded.guessed,
          style: imported.style,
        } satisfies ImportedFile;
      }
      const imported = importDocument(decoded.text);
      const diagnostics = [
        ...encodingDiagnostic(),
        ...locateInSource(validateImport(imported), imported.document),
      ];
      return {
        ok: imported.ok,
        document: imported.document,
        diagnostics,
        autoCaptions: detectAutoCaptions(imported.document),
        encoding: decoded.encoding,
        encodingGuessed: decoded.guessed,
        style: { lineEnding: /\r\n/.test(decoded.text) ? '\r\n' : '\n', byteOrderMark: bom },
      } satisfies ImportedFile;
    }
    case 'validate': {
      current = request.document;
      const ruleset = request.quality && rulesetById(request.quality.ruleset);
      return {
        diagnostics: diagnose(request.document, request.format, request.fileType),
        review: findReviewMarkers(request.document),
        quality: ruleset
          ? checkQuality(request.document, ruleset, request.quality?.overrides, {
              dialect: formatById(request.format).text,
              ...(request.quality?.fps ? { fps: request.quality.fps } : {}),
            })
          : [],
      } satisfies Checked;
    }
    case 'detect':
      return detectAutoCaptions(request.document);
    case 'cleanup':
      return cleanupAutoCaptions(request.document, request.options);
    case 'export':
      return exportAs(request.document, request.format, request.options);
    case 'preview':
      return exportDocument(asVtt(request.document, request.format).document).text;
    case 'autosave': {
      const document = request.save.document ?? current;
      if (!document) throw new Error('Nothing to autosave');
      return writeAutosave({ meta: request.save.meta, document });
    }
    case 'load-autosave':
      return readAutosave();
    case 'clear-autosave':
      return clearAutosave();
  }
}

/** Problems in a document, in its own format's terms. */
function diagnose(doc: VttDocument, format: FormatId, fileType: FileType): ItemDiagnostic[] {
  if (format === 'srt') return validateSrt(doc);
  const { text, spans } = serializeWithSpans(doc);
  return locateInSerialized(validate(text, { fileType }).diagnostics, spans);
}

/** The document as WebVTT: itself, or converted. */
function asVtt(
  doc: VttDocument,
  format: FormatId,
): { document: VttDocument; lost: ConversionLoss[] } {
  return format === 'srt' ? srtToVtt(doc) : { document: doc, lost: [] };
}

/** Writes the document in `options.to`, converting it first when that is another format. */
function exportAs(doc: VttDocument, format: FormatId, options: ExportRequest): ExportedFile {
  const { to, encoding = 'utf-8', ...rest } = options;
  const converted =
    format === to ? { document: doc, lost: [] } : to === 'srt' ? vttToSrt(doc) : asVtt(doc, format);
  const encoded = (text: string): Pick<ExportedFile, 'bytes' | 'encoding'> => {
    const bytes = encoding === 'utf-8' ? null : encodeText(text, encoding);
    return bytes ? { bytes, encoding } : { bytes: null, encoding: 'utf-8' };
  };
  if (to === 'srt') {
    const written = writeSrt(converted.document, {
      lineEnding: rest.lineEnding ?? '\n',
      byteOrderMark: rest.byteOrderMark ?? false,
    });
    return {
      text: written.text,
      ...encoded(written.text),
      lost: converted.lost,
      report: written.report,
      diagnostics: validateSrt(converted.document).filter(
        (d) => d.code !== 'srt-blank-line' && d.code !== 'srt-arrow', // Fixed in writing.
      ),
      compatibility: [],
      youtube: [],
      headerLines: false,
    };
  }
  const source = converted.document;
  const exported = exportDocument(source, rest);
  const { spans } = serializeWithSpans(exported.document);
  return {
    text: exported.text,
    // WebVTT is always UTF-8 (spec §4.1).
    bytes: null,
    encoding: 'utf-8',
    lost: converted.lost,
    report: exported.report,
    diagnostics: locateInSerialized(exported.diagnostics, spans),
    // Of the document as edited, so the list does not change as fixes are ticked.
    compatibility: compatibilityIssues(source).map((x) => ({ id: x.fix.id, count: x.count })),
    youtube: youtubeCheck(source).map((x) => ({ id: x.feature.id, count: x.count })),
    headerLines: hasHeaderLines(source),
  };
}

// Requests are handled one at a time, in order: autosave writes must not interleave.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => respond(event.data));
};

async function respond(request: WorkerRequest): Promise<void> {
  let response: WorkerResponse;
  try {
    response = { id: request.id, ok: true, result: await handle(request) };
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  scope.postMessage(response);
}
