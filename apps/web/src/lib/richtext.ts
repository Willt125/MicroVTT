/** Helpers for the cue text tools: toggling simple spans and naming spans for display. */
import {
  spansAt,
  unwrapRange,
  wrapRange,
  type MarkupEdit,
  type MarkupKind,
  type MarkupSpan,
} from '@microvtt/core';

/** Spans with no annotation, toggled by a button or a shortcut. */
export type SimpleSpan = 'i' | 'b' | 'u' | 's';

/**
 * Italic, bold, underline or strikethrough on or off for the selection: taken out of the span it
 * is in, if there is one (the whole span for a caret), otherwise wrapped in a new one.
 */
export function toggleSpan(
  text: string,
  start: number,
  end: number,
  kind: MarkupKind,
  name: SimpleSpan,
): MarkupEdit {
  const span = spansAt(text, start, end, kind)
    .filter((s) => s.name === name)
    .at(-1);
  if (span) return unwrapRange(text, span, start, end, kind);
  return wrapRange(text, start, end, `<${name}>`, `</${name}>`, kind);
}

const NAMES: Record<string, string> = {
  i: 'Italic',
  b: 'Bold',
  u: 'Underline',
  s: 'Strikethrough',
  ruby: 'Ruby',
  rt: 'Ruby text',
  font: 'Font',
};

/** A span as the breadcrumb shows it, e.g. "Voice Bob", "Class .loud", "Italic". */
export function spanLabel(span: MarkupSpan): string {
  const classes = span.classes.map((c) => `.${c}`).join('');
  switch (span.name) {
    case 'v':
      return `Voice ${span.annotation || '(no name)'}${classes ? ` ${classes}` : ''}`;
    case 'c':
      return `Class ${classes || '(none)'}`;
    case 'lang':
      return `Language ${span.annotation || '(none)'}`;
    case 'font':
      return `Font ${span.annotation}`.trim();
    default:
      return (NAMES[span.name] ?? span.name) + (classes ? ` ${classes}` : '');
  }
}
