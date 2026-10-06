/**
 * Parsing, validation and export run here, off the main thread, so a 12-hour file never
 * blocks typing or scrolling.
 */
import { exportDocument, importDocument, validate, validateImport } from '@microvtt/core';
import { locateInSerialized, locateInSource, serializeWithSpans } from './locate.ts';
import type { ExportedFile, ImportedFile, WorkerRequest, WorkerResponse } from './protocol.ts';

// The app's TypeScript config uses the DOM library; describe just the worker scope we use.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

function handle(request: WorkerRequest): unknown {
  switch (request.type) {
    case 'import': {
      // UTF-8 only (spec §6.1); one leading BOM is stripped by the decoder.
      const text = new TextDecoder('utf-8').decode(request.bytes);
      const imported = importDocument(text);
      const diagnostics = locateInSource(validateImport(imported), imported.document);
      return { ok: imported.ok, document: imported.document, diagnostics } satisfies ImportedFile;
    }
    case 'validate': {
      const { text, spans } = serializeWithSpans(request.document);
      const result = validate(text, { fileType: request.fileType });
      return locateInSerialized(result.diagnostics, spans);
    }
    case 'export': {
      const exported = exportDocument(request.document, request.options);
      const { spans } = serializeWithSpans(exported.document);
      return {
        text: exported.text,
        report: exported.report,
        diagnostics: locateInSerialized(exported.diagnostics, spans),
      } satisfies ExportedFile;
    }
  }
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  let response: WorkerResponse;
  try {
    response = { id: request.id, ok: true, result: handle(request) };
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  scope.postMessage(response);
};
