/**
 * Invisible formatting characters in cue text: direction marks and isolates for right-to-left
 * text, and the zero-width characters that join or separate words. They change how text displays
 * but cannot be seen in a text field, so the editor lists them and offers to insert them.
 */

export interface Mark {
  char: string;
  /** Short name, as Unicode abbreviates it. */
  abbr: string;
  name: string;
}

export const MARKS: readonly Mark[] = [
  { char: '\u200e', abbr: 'LRM', name: 'Left-to-right mark' },
  { char: '\u200f', abbr: 'RLM', name: 'Right-to-left mark' },
  { char: '\u061c', abbr: 'ALM', name: 'Arabic letter mark' },
  { char: '\u2066', abbr: 'LRI', name: 'Left-to-right isolate' },
  { char: '\u2067', abbr: 'RLI', name: 'Right-to-left isolate' },
  { char: '\u2068', abbr: 'FSI', name: 'First strong isolate' },
  { char: '\u2069', abbr: 'PDI', name: 'Pop directional isolate' },
  { char: '\u202a', abbr: 'LRE', name: 'Left-to-right embedding' },
  { char: '\u202b', abbr: 'RLE', name: 'Right-to-left embedding' },
  { char: '\u202d', abbr: 'LRO', name: 'Left-to-right override' },
  { char: '\u202e', abbr: 'RLO', name: 'Right-to-left override' },
  { char: '\u202c', abbr: 'PDF', name: 'Pop directional formatting' },
  { char: '\u200b', abbr: 'ZWSP', name: 'Zero-width space' },
  { char: '\u200c', abbr: 'ZWNJ', name: 'Zero-width non-joiner' },
  { char: '\u200d', abbr: 'ZWJ', name: 'Zero-width joiner' },
  { char: '\u2060', abbr: 'WJ', name: 'Word joiner' },
  { char: '\ufeff', abbr: 'ZWNBSP', name: 'Zero-width no-break space (BOM)' },
];

const ANY = new RegExp(`[${MARKS.map((m) => m.char).join('')}]`, 'g');

/** The invisible characters in `text`, with how often each occurs, in MARKS order. */
export function marksIn(text: string): { mark: Mark; count: number }[] {
  const counts = new Map<string, number>();
  for (const [ch] of text.matchAll(ANY)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return MARKS.filter((m) => counts.has(m.char)).map((mark) => ({
    mark,
    count: counts.get(mark.char) as number,
  }));
}

/** `text` with one kind of invisible character removed. */
export const withoutMark = (text: string, char: string): string => text.split(char).join('');

/** What can be inserted: a mark at the caret, or an isolate around the selection. */
export const INSERTS: readonly { label: string; before: string; after: string }[] = [
  { label: 'RLM (right-to-left mark)', before: '\u200f', after: '' },
  { label: 'LRM (left-to-right mark)', before: '\u200e', after: '' },
  { label: 'ALM (Arabic letter mark)', before: '\u061c', after: '' },
  { label: 'Right-to-left isolate around the selection', before: '\u2067', after: '\u2069' },
  { label: 'Left-to-right isolate around the selection', before: '\u2066', after: '\u2069' },
  { label: 'First-strong isolate around the selection', before: '\u2068', after: '\u2069' },
  { label: 'Zero-width space', before: '\u200b', after: '' },
  { label: 'Zero-width non-joiner', before: '\u200c', after: '' },
];

/** Inserts `before` and `after` around the selection; returns the new text and selection. */
export function insertAround(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
): { text: string; start: number; end: number } {
  return {
    text: text.slice(0, start) + before + text.slice(start, end) + after + text.slice(end),
    start: start + before.length,
    end: end + before.length,
  };
}
