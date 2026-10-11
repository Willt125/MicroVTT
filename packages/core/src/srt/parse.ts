/**
 * Reading SubRip files. SubRip has no specification; this reads what players read, and is
 * lenient where they are: blocks with no number or no blank line between them, times written
 * loosely, and box coordinates after the times. What it cannot read, or reads differently from
 * how it is written, is reported (codes `srt-…` in diagnostics.ts).
 */
import { DIAGNOSTICS, type DiagnosticCode, type Severity } from '../diagnostics.ts';
import { createCue, createDocument, type Cue, type VttDocument } from '../document.ts';
import { parseLegacyTimestamp } from '../timestamp.ts';

/** A problem found in a document, attached to an item (or the file) rather than a text offset. */
export interface ItemDiagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  /** Where it applies: an index into `head` or `body`, or the file as a whole. */
  list: 'head' | 'body' | 'file';
  index: number;
}

export const itemDiagnostic = (
  code: DiagnosticCode,
  message: string,
  list: ItemDiagnostic['list'] = 'file',
  index = 0,
): ItemDiagnostic => ({ code, severity: DIAGNOSTICS[code].severity, message, list, index });

/** How a SubRip file was written, so it can be saved the same way. */
export interface SrtStyle {
  lineEnding: '\n' | '\r\n';
  byteOrderMark: boolean;
}

export interface SrtImport {
  document: VttDocument;
  diagnostics: ItemDiagnostic[];
  style: SrtStyle;
}

const TIME = String.raw`[0-9]+:[0-9]{1,2}(?::[0-9]{1,2})?(?:[.,][0-9]+)?`;
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})(.*)$`);
const STRICT = /^[0-9]{2,}:[0-9]{2}:[0-9]{2},[0-9]{3}$/;
const NUMBER = /^\s*[0-9]+\s*$/;

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
/** "is" or "are", "was" or "were", "has" or "have" for `n` things. */
const verb = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Reads a SubRip file's text (already decoded). */
export function parseSrt(input: string): SrtImport {
  const style: SrtStyle = {
    lineEnding: /\r\n/.test(input) ? '\r\n' : '\n',
    byteOrderMark: input.startsWith('\uFEFF'),
  };
  const lines = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const isTiming = (i: number): boolean => TIMING.test(lines[i] ?? '');
  /** A block starts at `i`: a timing line, or a number followed by one. */
  const blockStart = (i: number): boolean =>
    isTiming(i) || (NUMBER.test(lines[i] ?? '') && isTiming(i + 1));

  const cues: Cue[] = [];
  const numbers: (number | null)[] = [];
  const diagnostics: ItemDiagnostic[] = [];
  let skipped = 0;
  let skippedAt = -1;
  let loose = 0;
  let coordinates = 0;
  let unreadableTimes = 0;

  let i = 0;
  while (i < lines.length) {
    if ((lines[i] as string).trim() === '') {
      i++;
      continue;
    }
    if (!blockStart(i)) {
      skipped++;
      if (skippedAt === -1) skippedAt = i + 1;
      i++;
      continue;
    }
    let number: number | null = null;
    if (!isTiming(i)) number = Number((lines[i++] as string).trim());
    const m = TIMING.exec(lines[i++] as string) as RegExpExecArray;
    const [startText, endText, rest] = [m[1] as string, m[2] as string, m[3] as string];
    const start = parseLegacyTimestamp(startText);
    const end = parseLegacyTimestamp(endText);
    const text: string[] = [];
    // The text runs to a blank line, or to the next block when a blank line is missing.
    while (i < lines.length && (lines[i] as string).trim() !== '' && !blockStart(i)) {
      text.push(lines[i++] as string);
    }
    if (!start.ok || !end.ok || start.end !== startText.length || end.end !== endText.length) {
      unreadableTimes++;
      continue;
    }
    if (!STRICT.test(startText) || !STRICT.test(endText)) loose++;
    if (rest.trim() !== '') coordinates++;
    cues.push(createCue(start.ms, end.ms, text.join('\n')));
    numbers.push(number);
  }

  if (skipped > 0)
    diagnostics.push(
      itemDiagnostic(
        'srt-block-unreadable',
        `${plural(skipped, 'line')} that ${verb(skipped, 'is', 'are')} not part of a cue ${verb(skipped, 'was', 'were')} left out (${skipped === 1 ? '' : 'the first is '}line ${skippedAt}).`,
      ),
    );
  if (unreadableTimes > 0)
    diagnostics.push(
      itemDiagnostic(
        'srt-block-unreadable',
        `${plural(unreadableTimes, 'cue')} with times that could not be read ${verb(unreadableTimes, 'was', 'were')} left out.`,
      ),
    );
  if (loose > 0)
    diagnostics.push(
      itemDiagnostic(
        'srt-timing-format',
        `${plural(loose, 'cue')} ${verb(loose, 'has', 'have')} times not written HH:MM:SS,mmm.`,
      ),
    );
  if (coordinates > 0)
    diagnostics.push(
      itemDiagnostic(
        'srt-coordinates',
        `${plural(coordinates, 'cue')} ${verb(coordinates, 'has', 'have')} box coordinates.`,
      ),
    );
  const misnumbered = numbers.filter((n, k) => n !== k + 1).length;
  if (misnumbered > 0)
    diagnostics.push(
      itemDiagnostic(
        'srt-numbering',
        `${plural(misnumbered, 'cue')} ${verb(misnumbered, 'is', 'are')} not numbered in order from 1 (or ${verb(misnumbered, 'has', 'have')} no number).`,
      ),
    );

  return { document: { ...createDocument(), body: cues }, diagnostics, style };
}

/** Whether text looks like a SubRip file: a cue number (optional) then a timing line. */
export function looksLikeSrt(start: string): boolean {
  const lines = start
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first === -1) return false;
  return (
    TIMING.test(lines[first] as string) ||
    (NUMBER.test(lines[first] as string) && TIMING.test(lines[first + 1] ?? ''))
  );
}
