/**
 * Canonical serialization of a document.
 *
 * The serializer writes exactly what the model says; it assumes the document has been through
 * `repair` (which makes every value expressible in WebVTT syntax). Output uses LF by default,
 * always ends with a line terminator, and lists cue settings in a fixed order, omitting defaults.
 */
import type { CueNode, CueSpanNode } from './cuetext.ts';
import type { Cue, Note, Region, Style, VttDocument } from './document.ts';
import { formatTimestamp } from './timestamp.ts';

export interface SerializeOptions {
  /** Line terminator. Default LF. */
  lineEnding?: '\n' | '\r\n';
  /** Write "mm:ss.ttt" when the hours are zero. Default false (always "hh:mm:ss.ttt"). */
  omitZeroHours?: boolean;
  /** Start the file with U+FEFF. Default false. */
  byteOrderMark?: boolean;
}

/** Formats a number in plain decimal notation (WebVTT syntax has no exponents). */
export function formatDecimal(n: number): string {
  // Expand JavaScript's shortest round-trip representation ("1.5e-7") into plain digits.
  const s = String(n);
  const m = /^(-?)([0-9])(?:\.([0-9]+))?e([+-][0-9]+)$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = '', exp] = m as unknown as [
    string,
    string,
    string,
    string | undefined,
    string,
  ];
  const digits = int + frac;
  const point = 1 + Number(exp); // Position of the decimal point within `digits`.
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

const percent = (n: number): string => `${formatDecimal(n)}%`;

export function serializeCueSettings(cue: Cue): string {
  const settings: string[] = [];
  if (cue.vertical !== '') settings.push(`vertical:${cue.vertical}`);
  if (cue.line !== 'auto') {
    const line = cue.snapToLines ? formatDecimal(cue.line) : percent(cue.line);
    settings.push(cue.lineAlign === 'start' ? `line:${line}` : `line:${line},${cue.lineAlign}`);
  }
  if (cue.position !== 'auto') {
    const pos = percent(cue.position);
    settings.push(
      cue.positionAlign === 'auto' ? `position:${pos}` : `position:${pos},${cue.positionAlign}`,
    );
  }
  if (cue.size !== 100) settings.push(`size:${percent(cue.size)}`);
  if (cue.align !== 'center') settings.push(`align:${cue.align}`);
  // Last, so that no later setting can take the cue out of its region when parsed.
  if (cue.region !== null) settings.push(`region:${cue.region}`);
  return settings.join(' ');
}

export function serializeCue(cue: Cue, options: SerializeOptions = {}): string {
  const omit = options.omitZeroHours ?? false;
  const settings = serializeCueSettings(cue);
  const timing = `${formatTimestamp(cue.startMs, omit)} --> ${formatTimestamp(cue.endMs, omit)}`;
  const head = cue.id === '' ? '' : `${cue.id}\n`;
  return `${head}${settings ? `${timing} ${settings}` : timing}\n${cue.text}`;
}

export function serializeRegion(region: Region): string {
  const settings = [`id:${region.id}`];
  if (region.width !== 100) settings.push(`width:${percent(region.width)}`);
  if (region.lines !== 3) settings.push(`lines:${formatDecimal(region.lines)}`);
  if (region.regionAnchorX !== 0 || region.regionAnchorY !== 100) {
    settings.push(`regionanchor:${percent(region.regionAnchorX)},${percent(region.regionAnchorY)}`);
  }
  if (region.viewportAnchorX !== 0 || region.viewportAnchorY !== 100) {
    settings.push(
      `viewportanchor:${percent(region.viewportAnchorX)},${percent(region.viewportAnchorY)}`,
    );
  }
  if (region.scroll === 'up') settings.push('scroll:up');
  return `REGION\n${settings.join(' ')}`;
}

const serializeStyle = (style: Style): string => `STYLE\n${style.css}`;
const serializeNote = (note: Note): string => `NOTE${note.text}`;

/** Yields the file in chunks (one per block), so large documents need no single huge string. */
export function* serializeChunks(
  doc: VttDocument,
  options: SerializeOptions = {},
): Generator<string> {
  const eol = options.lineEnding ?? '\n';
  const fix = eol === '\n' ? (s: string) => s : (s: string) => s.replace(/\n/g, eol);
  const bom = options.byteOrderMark ? '\ufeff' : '';
  // The signature line is followed by a blank line even when no blocks follow (§4.1 requires
  // two or more line terminators); blocks are separated by one blank line.
  yield `${bom}WEBVTT${doc.title === '' ? '' : ` ${doc.title}`}${eol}${eol}`;
  let first = true;
  const block = (text: string): string => {
    const out = `${first ? '' : eol}${fix(text)}${eol}`;
    first = false;
    return out;
  };
  for (const item of doc.head) {
    yield block(
      item.type === 'region'
        ? serializeRegion(item)
        : item.type === 'style'
          ? serializeStyle(item)
          : serializeNote(item),
    );
  }
  for (const item of doc.body) {
    yield block(item.type === 'cue' ? serializeCue(item, options) : serializeNote(item));
  }
}

/** Serializes a (repaired) document. */
export function serialize(doc: VttDocument, options: SerializeOptions = {}): string {
  let out = '';
  for (const chunk of serializeChunks(doc, options)) out += chunk;
  return out;
}

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Writes a cue text node tree as WebVTT caption text. Every span is closed explicitly. The
 * caller must pass a tree that is valid (see `repairCueText`): classes non-empty and free of
 * forbidden characters, annotations present only on v and lang.
 */
export function serializeCueText(nodes: CueNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += escapeText(node.value);
    } else if (node.type === 'timestamp') {
      out += `<${formatTimestamp(node.ms)}>`;
    } else {
      out += serializeSpan(node);
    }
  }
  return out;
}

function serializeSpan(node: CueSpanNode): string {
  const classes = node.classes.map((c) => `.${c}`).join('');
  let annotation = '';
  if (node.type === 'v')
    annotation = ` ${node.annotation.replace(/&/g, '&amp;').replace(/>/g, '&gt;')}`;
  if (node.type === 'lang')
    annotation = ` ${(node.language ?? '').replace(/&/g, '&amp;').replace(/>/g, '&gt;')}`;
  return `<${node.type}${classes}${annotation}>${serializeCueText(node.children)}</${node.type}>`;
}
