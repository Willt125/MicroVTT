/**
 * The editable document model.
 *
 * A `VttDocument` holds what a WebVTT file means (the spec parser's results) plus what an
 * authoring tool must not lose even though the parser ignores it: the title on the signature
 * line, NOTE comments and their positions, and text the parser discards.
 *
 * Values follow the VTTCue / VTTRegion API domains, except that times are integer milliseconds
 * and a cue refers to its region by id.
 */
import { normalizeInput } from './decode.ts';
import type {
  AlignSetting,
  BlockInfo,
  DirectionSetting,
  LineAlignSetting,
  ParseResult,
  ParsedCue,
  ParsedRegion,
  PositionAlignSetting,
  SourceRange,
} from './parser.ts';
import { colourStyleSheet, modernizeCueText } from './legacy-text.ts';
import { parse } from './parser.ts';

export interface Cue {
  type: 'cue';
  id: string;
  startMs: number;
  endMs: number;
  /** Raw cue text (markup source). */
  text: string;
  /** Id of the region the cue belongs to, or null. */
  region: string | null;
  vertical: DirectionSetting;
  snapToLines: boolean;
  line: number | 'auto';
  lineAlign: LineAlignSetting;
  position: number | 'auto';
  positionAlign: PositionAlignSetting;
  size: number;
  align: AlignSetting;
  source?: SourceRange;
  /**
   * A `region:` id the cue names that was not defined before it (so the cue is in no region).
   * Kept so that moving a late REGION block to the header can reconnect the cue.
   */
  unresolvedRegion?: string;
}

export interface Region {
  type: 'region';
  id: string;
  width: number;
  lines: number;
  regionAnchorX: number;
  regionAnchorY: number;
  viewportAnchorX: number;
  viewportAnchorY: number;
  scroll: '' | 'up';
  source?: SourceRange;
}

export interface Style {
  type: 'style';
  css: string;
  source?: SourceRange;
}

export interface Note {
  type: 'note';
  /**
   * Everything after "NOTE": empty, or starting with a space, tab or line feed. For example the
   * block "NOTE hello" has text " hello".
   */
  text: string;
  /**
   * Where a note came from when it was not a comment in the source: lines the parser ignored
   * (after the signature, or stray blocks). Export keeps them as comments.
   */
  preserved?: 'header' | 'discarded';
  source?: SourceRange;
}

export type HeadItem = Region | Style | Note;
export type BodyItem = Cue | Note;

export interface VttDocument {
  /** Text after "WEBVTT " on the signature line. */
  title: string;
  /** Blocks before the first cue: regions, style sheets and comments. */
  head: HeadItem[];
  /** Cues and the comments between them, in file order. */
  body: BodyItem[];
}

export function createDocument(): VttDocument {
  return { title: '', head: [], body: [] };
}

/** A cue with the VTTCue constructor's defaults. */
export function createCue(startMs: number, endMs: number, text: string): Cue {
  return {
    type: 'cue',
    id: '',
    startMs,
    endMs,
    text,
    region: null,
    vertical: '',
    snapToLines: true,
    line: 'auto',
    lineAlign: 'start',
    position: 'auto',
    positionAlign: 'auto',
    size: 100,
    align: 'center',
  };
}

/** A region with the VTTRegion constructor's defaults. */
export function createRegion(id = ''): Region {
  return {
    type: 'region',
    id,
    width: 100,
    lines: 3,
    regionAnchorX: 0,
    regionAnchorY: 100,
    viewportAnchorX: 0,
    viewportAnchorY: 100,
    scroll: '',
  };
}

export const cuesOf = (doc: VttDocument): Cue[] =>
  doc.body.filter((item): item is Cue => item.type === 'cue');

export const regionsOf = (doc: VttDocument): Region[] =>
  doc.head.filter((item): item is Region => item.type === 'region');

export interface ImportResult {
  /** False when the signature is invalid: the file is not WebVTT and the document is empty. */
  ok: boolean;
  document: VttDocument;
  /** The spec parser's result, as a user agent would see the file. */
  parsed: ParseResult;
  /** Every block in file order, including those the parser discards. */
  blocks: BlockInfo[];
  /** The input after the parser's transformations; source ranges index into it. */
  normalized: string;
}

function cueFromParsed(cue: ParsedCue): Cue {
  return {
    type: 'cue',
    id: cue.id,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    region: cue.region ? cue.region.id : null,
    vertical: cue.vertical,
    snapToLines: cue.snapToLines,
    line: cue.line,
    lineAlign: cue.lineAlign,
    position: cue.position,
    positionAlign: cue.positionAlign,
    size: cue.size,
    align: cue.align,
    source: cue.range,
  };
}

function regionFromParsed(region: ParsedRegion): Region {
  const { range, ...values } = region;
  return { type: 'region', ...values, source: range };
}

/** The last `region:` id on a cue's timing line, if no region with that id exists. */
function unresolvedRegion(block: string, regions: ParsedRegion[]): string | null {
  const timing = block.split('\n').find((line) => line.includes('-->')) ?? '';
  const ids = [...timing.matchAll(/(?:^|[ \t])region:([^ \t]+)/g)].map((m) => m[1] as string);
  const id = ids[ids.length - 1];
  return id !== undefined && !regions.some((r) => r.id === id) ? id : null;
}

/**
 * Imports decoded text into a document, keeping comments and preserving discarded text.
 * Byte input should be decoded with `WebVTTDecoder` first (UTF-8, as the spec requires).
 */
export function importDocument(text: string): ImportResult {
  const normalized = normalizeInput(text);
  const blocks: BlockInfo[] = [];
  // Old-draft setting names (YouTube still writes `position:…,middle`) are read as meant;
  // the validator reports them, and export writes the current names.
  const parsed = parse(normalized, {
    onBlock: (block) => blocks.push(block),
    legacyValues: true,
  });
  const document = createDocument();
  if (!parsed.ok) return { ok: false, document, parsed, blocks, normalized };

  const slice = (r: SourceRange): string => normalized.slice(r.start, r.end);
  let seenCue = false;
  const colours = new Map<string, string>();
  const place = (item: Note | Region | Style): void => {
    if (item.type === 'note' && seenCue) document.body.push(item);
    else document.head.push(item);
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'signature': {
        const line = slice(block.range);
        document.title = line.length > 7 ? line.slice(7) : '';
        break;
      }
      case 'cue': {
        const cue = cueFromParsed(block.cue as ParsedCue);
        const named = unresolvedRegion(slice(block.range), parsed.regions);
        if (cue.region === null && named !== null) cue.unresolvedRegion = named;
        // `<br>` and `<font color>` (SRT and HTML habits) are read as meant.
        const modern = modernizeCueText(cue.text);
        if (modern) {
          cue.text = modern.text;
          for (const [name, css] of modern.classes) colours.set(name, css);
        }
        document.body.push(cue);
        seenCue = true;
        break;
      }
      case 'region':
        place(regionFromParsed(block.region as ParsedRegion));
        break;
      case 'style':
        place({ type: 'style', css: block.stylesheet?.css ?? '', source: block.range });
        break;
      case 'note':
        place({ type: 'note', text: slice(block.range).slice(4), source: block.range });
        break;
      case 'header': {
        // Empty when a cue directly follows the signature line: nothing to keep.
        if (block.range.end === block.range.start) break;
        // Old-draft `Region:` lines become regions; the rest is kept as a comment.
        for (const region of block.legacyRegions ?? []) place(regionFromParsed(region));
        const rest = block.legacyRegions
          ? slice(block.range)
              .split('\n')
              .filter((line) => !line.startsWith('Region:'))
              .join('\n')
          : slice(block.range);
        if (rest === '') break;
        place({ type: 'note', text: `\n${rest}`, preserved: 'header', source: block.range });
        break;
      }
      case 'invalid-cue':
      case 'discarded':
        place({
          type: 'note',
          text: `\n${slice(block.range)}`,
          preserved: 'discarded',
          source: block.range,
        });
        break;
    }
  }
  // Generated colour classes get their colours from a style sheet at the end of the header.
  if (colours.size > 0) document.head.push({ type: 'style', css: colourStyleSheet(colours) });
  return { ok: true, document, parsed, blocks, normalized };
}
