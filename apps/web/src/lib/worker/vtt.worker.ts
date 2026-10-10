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
  findReviewMarkers,
  importDocument,
  rulesetById,
  validate,
  validateImport,
  youtubeCheck,
} from '@microvtt/core';
import { clearAutosave, readAutosave, writeAutosave } from './autosave.ts';
import { locateInSerialized, locateInSource, serializeWithSpans } from './locate.ts';
import type { VttDocument } from '@microvtt/core';
import type {
  Checked,
  ExportedFile,
  ImportedFile,
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
      // WebVTT is UTF-8 (spec §6.1); a file that is not is read in the encoding it was saved in.
      const decoded = decodeFile(new Uint8Array(request.bytes), request.encoding);
      const imported = importDocument(decoded.text);
      const diagnostics = locateInSource(validateImport(imported), imported.document);
      if (decoded.encoding !== 'utf-8') {
        diagnostics.unshift({
          code: 'file-encoding',
          severity: 'error',
          message: `The file is not UTF-8; it was read as ${decoded.encoding}${decoded.guessed ? ' (a guess)' : ''}. Export writes UTF-8.`,
          list: 'file',
          index: 0,
        });
      }
      return {
        ok: imported.ok,
        document: imported.document,
        diagnostics,
        autoCaptions: detectAutoCaptions(imported.document),
        encoding: decoded.encoding,
        encodingGuessed: decoded.guessed,
      } satisfies ImportedFile;
    }
    case 'validate': {
      current = request.document;
      const { text, spans } = serializeWithSpans(request.document);
      const result = validate(text, { fileType: request.fileType });
      const ruleset = request.quality && rulesetById(request.quality.ruleset);
      return {
        diagnostics: locateInSerialized(result.diagnostics, spans),
        review: findReviewMarkers(request.document),
        quality: ruleset
          ? checkQuality(
              request.document,
              ruleset,
              request.quality?.overrides,
              request.quality?.fps ? { fps: request.quality.fps } : {},
            )
          : [],
      } satisfies Checked;
    }
    case 'detect':
      return detectAutoCaptions(request.document);
    case 'cleanup':
      return cleanupAutoCaptions(request.document, request.options);
    case 'export': {
      const exported = exportDocument(request.document, request.options);
      const { spans } = serializeWithSpans(exported.document);
      return {
        text: exported.text,
        report: exported.report,
        diagnostics: locateInSerialized(exported.diagnostics, spans),
        // Of the document as edited, so the list does not change as fixes are ticked.
        compatibility: compatibilityIssues(request.document).map((x) => ({
          id: x.fix.id,
          count: x.count,
        })),
        youtube: youtubeCheck(request.document).map((x) => ({ id: x.feature.id, count: x.count })),
        headerLines: hasHeaderLines(request.document),
      } satisfies ExportedFile;
    }
    case 'preview':
      return exportDocument(request.document).text;
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
