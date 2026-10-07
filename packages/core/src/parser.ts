/**
 * The WebVTT file parser (spec §6.1–§6.3).
 *
 * The spec describes the parser as a pointer moving over the whole input. This implementation
 * is line-based and incremental: text is pushed in chunks, and only complete lines are processed
 * until `end()` is called. The observable result is identical, because every decision the spec's
 * "collect a WebVTT block" algorithm makes depends only on whole lines, and its one backtracking
 * step (an arrow line that ends the current block) maps to re-feeding that line to the next block.
 *
 * Times are integer milliseconds. Property names and values follow the VTTCue / VTTRegion API so
 * the model can be mirrored into native objects.
 */
import { LineEndingNormalizer, WebVTTDecoder } from './decode.ts';
import { parseTimestamp } from './timestamp.ts';

export interface SourceRange {
  /** Offset of the first character, in the normalized input (after CRLF/CR → LF, NUL → U+FFFD). */
  start: number;
  /** Offset just past the last character of the block's last line. */
  end: number;
}

export interface ParsedRegion {
  id: string;
  /** Percentage of the video width. */
  width: number;
  lines: number;
  regionAnchorX: number;
  regionAnchorY: number;
  viewportAnchorX: number;
  viewportAnchorY: number;
  scroll: '' | 'up';
  range: SourceRange;
}

export type LineAlignSetting = 'start' | 'center' | 'end';
export type PositionAlignSetting = 'line-left' | 'center' | 'line-right' | 'auto';
export type AlignSetting = 'start' | 'center' | 'end' | 'left' | 'right';
export type DirectionSetting = '' | 'rl' | 'lr';

export interface ParsedCue {
  id: string;
  startMs: number;
  endMs: number;
  pauseOnExit: boolean;
  region: ParsedRegion | null;
  vertical: DirectionSetting;
  snapToLines: boolean;
  line: number | 'auto';
  lineAlign: LineAlignSetting;
  position: number | 'auto';
  positionAlign: PositionAlignSetting;
  size: number;
  align: AlignSetting;
  /** Raw cue text; parse it with `parseCueText` when the node tree is needed. */
  text: string;
  range: SourceRange;
}

export interface ParsedStylesheet {
  /** The CSS text of a STYLE block (everything after the "STYLE" line). */
  css: string;
  range: SourceRange;
}

export interface ParseResult {
  /** False when the file signature is invalid; the file was then not processed at all. */
  ok: boolean;
  /** Cues in file order (a TextTrackCueList sorts them; see `sortCues`). */
  cues: ParsedCue[];
  /** Every region definition, in file order, including ones that cannot be referenced. */
  regions: ParsedRegion[];
  stylesheets: ParsedStylesheet[];
}

/**
 * How a block was classified. Blocks the spec's parser discards are reported too, so the
 * validator and the document model can see comments, headers and errors.
 */
export type BlockKind =
  /** The "WEBVTT" line. */
  | 'signature'
  /** Lines directly after the signature line, before the first blank line (ignored). */
  | 'header'
  | 'cue'
  /** An arrow line on line 1 or 2 whose timings failed to parse: the block is dropped. */
  | 'invalid-cue'
  | 'style'
  | 'region'
  /** A NOTE comment block (ignored by the parser). */
  | 'note'
  /** Anything else the parser drops, e.g. STYLE/REGION after the first cue, or stray text. */
  | 'discarded';

export interface BlockInfo {
  kind: BlockKind;
  range: SourceRange;
  /** What ended the block: a blank line, an arrow line (no blank line before it), or the input. */
  endedBy: 'blank' | 'arrow' | 'eof';
  /** True if a cue had been parsed before this block started. */
  afterCue: boolean;
  cue?: ParsedCue;
  stylesheet?: ParsedStylesheet;
  region?: ParsedRegion;
}

export interface ParserOptions {
  /** Called for every block, in file order, once it is complete. */
  onBlock?: (block: BlockInfo) => void;
  /**
   * Read cue setting values from older drafts of the spec (as YouTube still writes them, e.g.
   * `position:10%,middle`) as they were meant, instead of ignoring the setting as the spec
   * requires. Off by default, so `parse` stays exactly the spec's algorithm.
   */
  legacyValues?: boolean;
}

const ARROW = '-->';

const isAsciiWhitespace = (c: number): boolean =>
  c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;

/** Splits on runs of ASCII whitespace, dropping empty tokens. */
function splitOnSpaces(input: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let i = 0; i <= input.length; i++) {
    const ws = i === input.length || isAsciiWhitespace(input.charCodeAt(i));
    if (ws) {
      if (start !== -1) tokens.push(input.slice(start, i));
      start = -1;
    } else if (start === -1) {
      start = i;
    }
  }
  return tokens;
}

/** HTML "rules for parsing floating-point number values", for inputs already syntax-checked. */
function parseFloatingPoint(input: string): number | null {
  const value = Number(input);
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : value; // -0 is not a valid result.
}

const PERCENTAGE = /^[0-9]+(?:\.[0-9]+)?%$/;

/** The rules to parse a percentage string. */
function parsePercentage(input: string): number | null {
  if (!PERCENTAGE.test(input)) return null;
  const value = parseFloatingPoint(input.slice(0, -1));
  if (value === null || value < 0 || value > 100) return null;
  return value;
}

function splitOnFirst(value: string, separator: string): [string, string | null] {
  const i = value.indexOf(separator);
  return i === -1 ? [value, null] : [value.slice(0, i), value.slice(i + 1)];
}

/** Iterates name/value pairs of a settings list, skipping tokens without a usable colon. */
function* settingsOf(input: string): Generator<[string, string]> {
  for (const setting of splitOnSpaces(input)) {
    const colon = setting.indexOf(':');
    if (colon <= 0 || colon === setting.length - 1) continue;
    yield [setting.slice(0, colon), setting.slice(colon + 1)];
  }
}

function newRegion(range: SourceRange): ParsedRegion {
  return {
    id: '',
    width: 100,
    lines: 3,
    regionAnchorX: 0,
    regionAnchorY: 100,
    viewportAnchorX: 0,
    viewportAnchorY: 100,
    scroll: '',
    range,
  };
}

/** Collect WebVTT region settings (§6.2). */
function parseRegionSettings(input: string, region: ParsedRegion): void {
  for (const [name, value] of settingsOf(input)) {
    switch (name) {
      case 'id':
        region.id = value;
        break;
      case 'width': {
        const width = parsePercentage(value);
        if (width !== null) region.width = width;
        break;
      }
      case 'lines':
        if (/^[0-9]+$/.test(value)) region.lines = Number(value);
        break;
      case 'regionanchor':
      case 'viewportanchor': {
        const [xs, ys] = splitOnFirst(value, ',');
        if (ys === null) break;
        const x = parsePercentage(xs);
        const y = parsePercentage(ys);
        if (x === null || y === null) break;
        if (name === 'regionanchor') {
          region.regionAnchorX = x;
          region.regionAnchorY = y;
        } else {
          region.viewportAnchorX = x;
          region.viewportAnchorY = y;
        }
        break;
      }
      case 'scroll':
        if (value === 'up') region.scroll = 'up';
        break;
    }
  }
}

/** Parses the offset part of a `line` setting, or returns null to skip the setting. */
function parseLinePosition(linepos: string): number | null {
  if (!/[0-9]/.test(linepos)) return null;
  if (linepos.endsWith('%')) return parsePercentage(linepos);
  if (/[^0-9.-]/.test(linepos)) return null;
  if (linepos.indexOf('-', 1) !== -1) return null;
  const dot = linepos.indexOf('.');
  if (dot !== -1) {
    if (linepos.indexOf('.', dot + 1) !== -1) return null;
    const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
    if (
      dot === 0 ||
      dot === linepos.length - 1 ||
      !isDigit(linepos.charCodeAt(dot - 1)) ||
      !isDigit(linepos.charCodeAt(dot + 1))
    ) {
      return null;
    }
  }
  return parseFloatingPoint(linepos);
}

const LEGACY_POSITION_ALIGN: Record<string, string> = {
  start: 'line-left',
  middle: 'center',
  end: 'line-right',
};

/**
 * The current form of a cue setting value written with an older draft's names, or null when
 * it uses none: `align:middle`, `line:…,middle`, and `position:…,start|middle|end` (now
 * `line-left`, `center`, `line-right`). Only the names change; the value may still be invalid.
 */
export function modernizeSetting(name: string, value: string): string | null {
  if (name === 'align') return value === 'middle' ? 'center' : null;
  if (name !== 'line' && name !== 'position') return null;
  const comma = value.indexOf(',');
  if (comma === -1) return null;
  const align = value.slice(comma + 1);
  const modern =
    name === 'line' ? (align === 'middle' ? 'center' : undefined) : LEGACY_POSITION_ALIGN[align];
  return modern === undefined ? null : `${value.slice(0, comma)},${modern}`;
}

/** Parse the WebVTT cue settings (§6.3). */
function parseCueSettings(
  input: string,
  regions: ParsedRegion[],
  cue: ParsedCue,
  legacy: boolean,
): void {
  for (const [name, written] of settingsOf(input)) {
    const value = (legacy && modernizeSetting(name, written)) || written;
    switch (name) {
      case 'region': {
        let found: ParsedRegion | null = null;
        for (let i = regions.length - 1; i >= 0; i--) {
          if ((regions[i] as ParsedRegion).id === value) {
            found = regions[i] as ParsedRegion;
            break;
          }
        }
        cue.region = found;
        break;
      }
      case 'vertical':
        if (value === 'rl' || value === 'lr') cue.vertical = value;
        if (cue.vertical !== '') cue.region = null;
        break;
      case 'line': {
        const [linepos, linealign] = splitOnFirst(value, ',');
        const number = parseLinePosition(linepos);
        if (number === null) break;
        if (linealign === 'start' || linealign === 'center' || linealign === 'end') {
          cue.lineAlign = linealign;
        } else if (linealign !== null) {
          break;
        }
        cue.line = number;
        cue.snapToLines = !linepos.endsWith('%');
        cue.region = null;
        break;
      }
      case 'position': {
        const [colpos, colalign] = splitOnFirst(value, ',');
        const number = parsePercentage(colpos);
        if (number === null) break;
        if (colalign === 'line-left' || colalign === 'center' || colalign === 'line-right') {
          cue.positionAlign = colalign;
        } else if (colalign !== null) {
          break;
        }
        cue.position = number;
        break;
      }
      case 'size': {
        const number = parsePercentage(value);
        if (number === null) break;
        cue.size = number;
        if (number !== 100) cue.region = null;
        break;
      }
      case 'align':
        if (
          value === 'start' ||
          value === 'center' ||
          value === 'end' ||
          value === 'left' ||
          value === 'right'
        ) {
          cue.align = value;
        }
        break;
    }
  }
}

/** Collect WebVTT cue timings and settings (§6.3). Returns false on failure. */
function parseCueTimingsAndSettings(
  line: string,
  regions: ParsedRegion[],
  cue: ParsedCue,
  legacy: boolean,
): boolean {
  let pos = 0;
  const skipWhitespace = (): void => {
    while (pos < line.length && isAsciiWhitespace(line.charCodeAt(pos))) pos++;
  };
  skipWhitespace();
  const start = parseTimestamp(line, pos);
  if (!start.ok) return false;
  pos = start.end;
  skipWhitespace();
  if (!line.startsWith(ARROW, pos)) return false;
  pos += ARROW.length;
  skipWhitespace();
  const end = parseTimestamp(line, pos);
  if (!end.ok) return false;
  cue.startMs = start.ms;
  cue.endMs = end.ms;
  parseCueSettings(line.slice(end.end), regions, cue, legacy);
  return true;
}

function newCue(id: string, range: SourceRange): ParsedCue {
  return {
    id,
    startMs: 0,
    endMs: 0,
    pauseOnExit: false,
    region: null,
    vertical: '',
    snapToLines: true,
    line: 'auto',
    lineAlign: 'start',
    position: 'auto',
    positionAlign: 'auto',
    size: 100,
    align: 'center',
    text: '',
    range,
  };
}

/** True if `buffer` is `keyword` followed only by ASCII whitespace. */
function isBlockKeyword(buffer: string, keyword: string): boolean {
  if (!buffer.startsWith(keyword)) return false;
  for (let i = keyword.length; i < buffer.length; i++) {
    if (!isAsciiWhitespace(buffer.charCodeAt(i))) return false;
  }
  return true;
}

/** True if `line` begins a WebVTT comment block: "NOTE" followed by a space, a tab, or nothing. */
export function isCommentStart(line: string): boolean {
  if (!line.startsWith('NOTE')) return false;
  const c = line.charCodeAt(4);
  return line.length === 4 || c === 0x20 || c === 0x09;
}

/** State of one invocation of "collect a WebVTT block". */
class Block {
  lineCount = 0;
  buffer = '';
  firstLine = '';
  seenArrow = false;
  cue: ParsedCue | null = null;
  stylesheet = false;
  region: ParsedRegion | null = null;
  readonly inHeader: boolean;
  readonly start: number;
  readonly afterCue: boolean;
  end: number;

  constructor(inHeader: boolean, start: number, afterCue: boolean) {
    this.inHeader = inHeader;
    this.start = start;
    this.afterCue = afterCue;
    this.end = start;
  }
}

const Phase = {
  /** Waiting for the signature line. */
  Signature: 0,
  /** Signature seen; the next line decides whether there is a header block. */
  AfterSignature: 1,
  /** Between blocks, or inside one. */
  Blocks: 2,
  /** Signature invalid: input is ignored. */
  Failed: 3,
} as const;
type Phase = (typeof Phase)[keyof typeof Phase];

/**
 * Incremental WebVTT parser. Push normalized text with `push` (or use `WebVTTByteParser` for
 * bytes), then call `end`.
 */
export class WebVTTParser {
  private phase: Phase = Phase.Signature;
  private carry = '';
  /** Offset in the normalized input of the start of `carry`. */
  private offset = 0;
  private block: Block | null = null;
  private seenCue = false;
  private readonly normalizer = new LineEndingNormalizer();
  private readonly result: ParseResult = { ok: false, cues: [], regions: [], stylesheets: [] };
  private ended = false;
  private readonly onBlock: ((block: BlockInfo) => void) | undefined;
  private readonly legacy: boolean;

  constructor(options: ParserOptions = {}) {
    this.onBlock = options.onBlock;
    this.legacy = options.legacyValues === true;
  }

  /** Pushes a chunk of decoded text. NUL and CR handling is applied here. */
  push(text: string): void {
    if (this.ended) throw new Error('WebVTTParser: push() after end()');
    if (this.phase === Phase.Failed) return;
    const chunk = this.carry + this.normalizer.push(text);
    let lineStart = 0;
    for (let lf = chunk.indexOf('\n'); lf !== -1; lf = chunk.indexOf('\n', lineStart)) {
      this.line(chunk.slice(lineStart, lf), this.offset + lineStart);
      if ((this.phase as Phase) === Phase.Failed) return;
      lineStart = lf + 1;
    }
    this.offset += lineStart;
    this.carry = chunk.slice(lineStart);
    // The signature can be rejected before a whole line arrives.
    if (this.phase === Phase.Signature && this.carry.length >= 7 && !this.signatureOk(this.carry)) {
      this.phase = Phase.Failed;
    }
  }

  /** Signals end of input and returns the result. */
  end(): ParseResult {
    if (this.ended) return this.result;
    this.ended = true;
    if (this.phase !== Phase.Failed) {
      if (this.carry !== '') this.line(this.carry, this.offset);
      this.carry = '';
      if (this.phase === Phase.Signature) this.phase = Phase.Failed; // Empty input.
      if (this.block) this.finishBlock(this.block, 'eof');
      this.block = null;
    }
    if (this.phase === Phase.Failed) {
      return { ok: false, cues: [], regions: [], stylesheets: [] };
    }
    this.result.ok = true;
    return this.result;
  }

  private signatureOk(line: string): boolean {
    if (!line.startsWith('WEBVTT')) return false;
    if (line.length === 6) return true;
    const c = line.charCodeAt(6);
    return c === 0x20 || c === 0x09;
  }

  private line(line: string, start: number): void {
    switch (this.phase) {
      case Phase.Signature:
        this.phase = this.signatureOk(line) ? Phase.AfterSignature : Phase.Failed;
        if (this.phase === Phase.AfterSignature && this.onBlock) {
          this.onBlock({
            kind: 'signature',
            range: { start, end: start + line.length },
            endedBy: 'blank',
            afterCue: false,
          });
        }
        return;
      case Phase.AfterSignature:
        this.phase = Phase.Blocks;
        // A non-empty line right after the signature starts a block "in header".
        if (line !== '') this.blockLine(line, start, true);
        return;
      case Phase.Blocks:
        this.blockLine(line, start, false);
        return;
      case Phase.Failed:
        return;
    }
  }

  private blockLine(line: string, start: number, inHeader: boolean): void {
    if (!this.block) {
      if (line === '') return; // Blank lines between blocks.
      this.block = new Block(inHeader, start, this.seenCue);
    }
    const block = this.block;
    block.lineCount++;
    if (block.lineCount === 1) block.firstLine = line;

    if (line.includes(ARROW)) {
      if (
        !block.inHeader &&
        (block.lineCount === 1 || (block.lineCount === 2 && !block.seenArrow))
      ) {
        block.seenArrow = true;
        const cue = newCue(block.buffer, { start: block.start, end: start + line.length });
        if (parseCueTimingsAndSettings(line, this.result.regions, cue, this.legacy)) {
          block.cue = cue;
          block.buffer = '';
          this.seenCue = true;
        } else {
          block.cue = null;
        }
        block.end = start + line.length;
        return;
      }
      // The arrow line ends this block and is processed again as the start of the next one.
      this.finishBlock(block, 'arrow');
      this.block = null;
      this.blockLine(line, start, false);
      return;
    }

    if (line === '') {
      this.finishBlock(block, 'blank');
      this.block = null;
      return;
    }

    if (!block.inHeader && block.lineCount === 2 && !this.seenCue) {
      if (isBlockKeyword(block.buffer, 'STYLE')) {
        block.stylesheet = true;
        block.buffer = '';
      } else if (isBlockKeyword(block.buffer, 'REGION')) {
        block.region = newRegion({ start: block.start, end: block.start });
        block.buffer = '';
      }
    }
    if (block.buffer !== '') block.buffer += '\n';
    block.buffer += line;
    block.end = start + line.length;
  }

  private finishBlock(block: Block, endedBy: BlockInfo['endedBy']): void {
    const range = { start: block.start, end: block.end };
    const info: BlockInfo = { kind: 'discarded', range, endedBy, afterCue: block.afterCue };
    if (block.cue) {
      block.cue.text = block.buffer;
      block.cue.range = range;
      this.result.cues.push(block.cue);
      info.kind = 'cue';
      info.cue = block.cue;
    } else if (block.stylesheet) {
      const stylesheet = { css: block.buffer, range };
      this.result.stylesheets.push(stylesheet);
      info.kind = 'style';
      info.stylesheet = stylesheet;
    } else if (block.region) {
      parseRegionSettings(block.buffer, block.region);
      block.region.range = range;
      this.result.regions.push(block.region);
      info.kind = 'region';
      info.region = block.region;
    } else if (block.inHeader) {
      info.kind = 'header';
    } else if (block.seenArrow) {
      info.kind = 'invalid-cue';
    } else if (isCommentStart(block.firstLine)) {
      info.kind = 'note';
    }
    this.onBlock?.(info);
  }
}

/** Incremental parser over UTF-8 bytes. */
export class WebVTTByteParser {
  private readonly decoder = new WebVTTDecoder();
  private readonly parser: WebVTTParser;

  constructor(options?: ParserOptions) {
    this.parser = new WebVTTParser(options);
  }

  push(bytes: Uint8Array): void {
    this.parser.push(this.decoder.push(bytes));
  }

  end(): ParseResult {
    this.parser.push(this.decoder.end());
    return this.parser.end();
  }
}

/** Parses a complete WebVTT document given as decoded text. */
export function parse(text: string, options?: ParserOptions): ParseResult {
  const parser = new WebVTTParser(options);
  parser.push(text);
  return parser.end();
}

/** Parses a complete WebVTT document given as bytes. */
export function parseBytes(bytes: Uint8Array, options?: ParserOptions): ParseResult {
  const parser = new WebVTTByteParser(options);
  parser.push(bytes);
  return parser.end();
}

/**
 * Sorts cues into HTML's text track cue order: by start time, then by end time descending, then
 * by file order. This is the order a TextTrackCueList exposes.
 */
export function sortCues<T extends Pick<ParsedCue, 'startMs' | 'endMs'>>(cues: readonly T[]): T[] {
  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs || b.cue.endMs - a.cue.endMs || a.index - b.index)
    .map(({ cue }) => cue);
}
