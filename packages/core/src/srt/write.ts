/** Checking and writing SubRip documents. */
import type { RepairEntry } from '../repair.ts';
import type { Cue, VttDocument } from '../document.ts';
import { itemDiagnostic, type ItemDiagnostic, type SrtStyle } from './parse.ts';

/** Tags and override blocks players know (see `srt-unknown-tag`). */
const KNOWN_TAG = /^<\/?(?:[bius]|font)(?:\s[^>]*)?>$/i;
const KNOWN_BLOCK = /^\{(?:\\(?:an[1-9]|a[1-9]|[bius][01]|c&H[0-9A-Fa-f]{6}&|fn[^\\}]*|fs\d+))+\}$/;
/** Things that look like markup: a tag-like `<word…>` or `</word>`, or a brace block. */
const MARKUP = /<\/?[A-Za-z][^<>\n]*>|\{[^{}\n]*\}/g;

const BLANK_LINE = /\n[ \t]*\n/;
const ARROW = /-->/;

/** Problems in a SubRip document, by cue. */
export function validateSrt(doc: VttDocument): ItemDiagnostic[] {
  const out: ItemDiagnostic[] = [];
  doc.body.forEach((item, index) => {
    if (item.type !== 'cue') return;
    if (item.endMs <= item.startMs)
      out.push(
        itemDiagnostic(
          'srt-end-before-start',
          'The cue does not end after it starts.',
          'body',
          index,
        ),
      );
    if (BLANK_LINE.test(item.text.trim()))
      out.push(itemDiagnostic('srt-blank-line', 'The text has a blank line.', 'body', index));
    if (ARROW.test(item.text))
      out.push(itemDiagnostic('srt-arrow', 'The text contains "-->".', 'body', index));
    const unknown = (item.text.match(MARKUP) ?? []).filter(
      (m) =>
        !KNOWN_TAG.test(m) && !(m.startsWith('{') && KNOWN_BLOCK.test(m)) && !/^\{[^\\]/.test(m),
    );
    if (unknown.length > 0)
      out.push(
        itemDiagnostic(
          'srt-unknown-tag',
          `Markup players may show as text: ${[...new Set(unknown)].slice(0, 3).join(' ')}`,
          'body',
          index,
        ),
      );
  });
  return out;
}

/** A SubRip time: HH:MM:SS,mmm (more hour digits when needed). */
export function formatSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor(t / 60_000) % 60;
  const s = Math.floor(t / 1000) % 60;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
}

/** The text of a cue as it can be written: no blank lines, no "-->". */
function writableText(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n')
    .replace(/-->/g, '->');
}

export interface SrtWriteResult {
  text: string;
  /** What writing changed. */
  report: RepairEntry[];
}

/**
 * Writes a SubRip file: cues numbered from 1, times HH:MM:SS,mmm, a blank line after each cue,
 * in the given line endings (and with a byte order mark if asked). Notes and settings are not
 * written (SubRip has neither).
 */
export function writeSrt(doc: VttDocument, style: Partial<SrtStyle> = {}): SrtWriteResult {
  const eol = style.lineEnding ?? '\n';
  const report: RepairEntry[] = [];
  const cues = doc.body.filter((item): item is Cue => item.type === 'cue');
  const blocks = cues.map((cue, i) => {
    const text = writableText(cue.text);
    if (text !== cue.text.replace(/\n+$/, '')) {
      const index = doc.body.indexOf(cue);
      const code = ARROW.test(cue.text) ? 'srt-arrow' : 'srt-blank-line';
      report.push({
        code,
        message:
          code === 'srt-arrow'
            ? '"-->" in the text is written as "->".'
            : 'Blank lines in the text are left out.',
        target: { list: 'body', index },
      });
    }
    return [`${i + 1}`, `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`, text]
      .filter((line, k) => k < 2 || line !== '')
      .join('\n')
      .replace(/\n/g, eol);
  });
  const text = (style.byteOrderMark ? '\uFEFF' : '') + blocks.map((b) => b + eol + eol).join('');
  return { text, report };
}
