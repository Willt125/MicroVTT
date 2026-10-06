/** Maps text-offset diagnostics onto document items. Runs in the worker; testable in Node. */
import type { Diagnostic, SourceRange, VttDocument } from '@microvtt/core';
import { serializeChunks } from '@microvtt/core';
import type { ItemDiagnostic } from './protocol.ts';

interface Span {
  start: number;
  end: number;
  list: 'head' | 'body';
  index: number;
}

/** Index of the last span starting at or before `offset`, or -1. */
function find(spans: Span[], offset: number): number {
  let lo = 0;
  let hi = spans.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((spans[mid] as Span).start <= offset) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function attach(diagnostics: Diagnostic[], spans: Span[]): ItemDiagnostic[] {
  return diagnostics.map((d) => {
    const i = find(spans, d.range.start);
    const span = spans[i];
    const inside = span !== undefined && d.range.start <= span.end;
    return {
      code: d.code,
      severity: d.severity,
      message: d.message,
      list: inside ? span.list : 'file',
      index: inside ? span.index : -1,
    };
  });
}

/** For diagnostics of an imported file: items carry their source ranges. */
export function locateInSource(diagnostics: Diagnostic[], doc: VttDocument): ItemDiagnostic[] {
  const spans: Span[] = [];
  const add = (list: 'head' | 'body', items: { source?: SourceRange }[]): void => {
    items.forEach((item, index) => {
      if (item.source) spans.push({ start: item.source.start, end: item.source.end, list, index });
    });
  };
  add('head', doc.head);
  add('body', doc.body);
  spans.sort((a, b) => a.start - b.start);
  return attach(diagnostics, spans);
}

/**
 * Serializes `doc` (without repair) and records where each item starts, so diagnostics of the
 * serialized text can be attached to items.
 */
export function serializeWithSpans(doc: VttDocument): { text: string; spans: Span[] } {
  const spans: Span[] = [];
  let text = '';
  let n = -1; // Chunk 0 is the signature line.
  const order: Span['list'][] = [
    ...doc.head.map(() => 'head' as const),
    ...doc.body.map(() => 'body' as const),
  ];
  for (const chunk of serializeChunks(doc)) {
    if (n >= 0) {
      const list = order[n] as Span['list'];
      const index = list === 'head' ? n : n - doc.head.length;
      spans.push({ start: text.length, end: text.length + chunk.length, list, index });
    }
    text += chunk;
    n++;
  }
  return { text, spans };
}

export function locateInSerialized(diagnostics: Diagnostic[], spans: Span[]): ItemDiagnostic[] {
  return attach(diagnostics, spans);
}
