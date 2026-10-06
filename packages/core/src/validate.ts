/**
 * Conformance checker (spec §4 "Syntax").
 *
 * The parser (§6) is deliberately lenient; this module reports everything the syntax forbids,
 * with ranges into the normalized input. It runs on top of the parser's block structure, so
 * block boundaries always agree with what a user agent sees.
 */
import { checkCueText, checkChapterTitle } from './cuetext-check.ts';
import { checkStylesheet } from './css.ts';
import type { Diagnostic, DiagnosticCode } from './diagnostics.ts';
import { diagnostic } from './diagnostics.ts';
import type { ImportResult } from './document.ts';
import { importDocument } from './document.ts';
import type { BlockInfo, ParsedCue, SourceRange } from './parser.ts';

/**
 * Which payloads to require (§4.6). The base syntax allows any payload to be metadata text, so
 * "any" only checks structure; "captions" is the default for a caption editor.
 */
export type FileType = 'captions' | 'chapters' | 'metadata' | 'any';

export interface ValidateOptions {
  fileType?: FileType;
}

export interface ValidationResult extends ImportResult {
  diagnostics: Diagnostic[];
}

const TIMESTAMP = /^(?:([0-9]{2,}):)?([0-5][0-9]):([0-5][0-9])\.[0-9]{3}$/;
const PERCENTAGE = /^([0-9]+(?:\.[0-9]+)?)%$/;

/** A strict WebVTT percentage (syntax and 0..100 range). */
export function isPercentage(value: string): boolean {
  const m = PERCENTAGE.exec(value);
  return m !== null && Number(m[1]) <= 100;
}

interface Line {
  text: string;
  start: number;
}

function linesOf(normalized: string, range: SourceRange): Line[] {
  const lines: Line[] = [];
  let start = range.start;
  for (const text of normalized.slice(range.start, range.end).split('\n')) {
    lines.push({ text, start });
    start += text.length + 1;
  }
  return lines;
}

const isEmpty = (r: SourceRange): boolean => r.end === r.start;

/** ASCII whitespace, which is what the parser skips and splits on (never Unicode spaces). */
const WS = /[\t\n\f\r ]/;

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  add(code: DiagnosticCode, message: string, start: number, end: number): void {
    this.diagnostics.push(diagnostic(code, message, { start, end: Math.max(end, start) }));
  }
}

const CUE_SETTING_NAMES = new Set(['vertical', 'line', 'position', 'size', 'align', 'region']);
const REGION_SETTING_NAMES = new Set([
  'id',
  'width',
  'lines',
  'regionanchor',
  'viewportanchor',
  'scroll',
]);

/** Splits on runs of ASCII whitespace (as the parser does), keeping each token's offset. */
function tokens(text: string, offset: number): Line[] {
  const out: Line[] = [];
  const re = /[^\t\n\f\r ]+/g;
  for (let m = re.exec(text); m; m = re.exec(text))
    out.push({ text: m[0], start: offset + m.index });
  return out;
}

function checkCueSettingValue(name: string, value: string): DiagnosticCode | null {
  switch (name) {
    case 'vertical':
      return value === 'rl' || value === 'lr' ? null : 'cue-setting-value';
    case 'line': {
      const m = /^(-?[0-9]+(?:\.[0-9]+)?%?|[0-9]+(?:\.[0-9]+)?%)(?:,(start|center|end))?$/.exec(
        value,
      );
      const pos = m?.[1];
      if (!pos) return 'cue-setting-value';
      if (pos.endsWith('%')) return isPercentage(pos) ? null : 'cue-setting-value';
      return /^-?[0-9]+$/.test(pos) ? null : 'cue-line-not-integer';
    }
    case 'position': {
      const [pos, align, extra] = value.split(',');
      if (extra !== undefined || !isPercentage(pos as string)) return 'cue-setting-value';
      return align === undefined || ['line-left', 'center', 'line-right'].includes(align)
        ? null
        : 'cue-setting-value';
    }
    case 'size':
      return isPercentage(value) ? null : 'cue-setting-value';
    case 'align':
      return ['start', 'center', 'end', 'left', 'right'].includes(value)
        ? null
        : 'cue-setting-value';
    default:
      return null; // region: any identifier; resolution is checked separately.
  }
}

function checkRegionSettingValue(name: string, value: string): boolean {
  switch (name) {
    case 'id':
      return !value.includes('-->');
    case 'width':
      return isPercentage(value);
    case 'lines':
      return /^[0-9]+$/.test(value);
    case 'regionanchor':
    case 'viewportanchor': {
      const parts = value.split(',');
      return parts.length === 2 && parts.every(isPercentage);
    }
    case 'scroll':
      return value === 'up';
    default:
      return false;
  }
}

interface CueContext {
  definedRegions: Set<string>;
  out: Collector;
}

/** Strict check of a timing line (§4.1 cue timings, §4.4 settings). */
function checkTimingLine(line: Line, ctx: CueContext): void {
  const { out } = ctx;
  const t = line.text;
  const at = (i: number): number => line.start + i;
  let pos = 0;
  if (pos < t.length && WS.test(t.charAt(0))) {
    while (pos < t.length && WS.test(t.charAt(pos))) pos++;
    out.add('timing-whitespace', 'Nothing may come before the start time.', at(0), at(pos));
  }
  const readTimestamp = (): void => {
    const m = /^[0-9:.]+/.exec(t.slice(pos));
    const ts = m?.[0] ?? '';
    const tm = TIMESTAMP.exec(ts);
    if (!tm) {
      out.add(
        'timestamp-syntax',
        `"${ts}" is not a valid WebVTT timestamp.`,
        at(pos),
        at(pos + ts.length),
      );
    }
    pos += ts.length;
  };
  const readSeparator = (where: string): void => {
    const m = /^[\t\n\f\r ]*/.exec(t.slice(pos))?.[0] ?? '';
    if (m === '' || /[^ \t]/.test(m)) {
      out.add('timing-whitespace', `Use spaces or tabs ${where}.`, at(pos), at(pos + m.length));
    }
    pos += m.length;
  };
  readTimestamp();
  readSeparator('before "-->"');
  pos += 3; // "-->", guaranteed by the parser having accepted the line.
  readSeparator('after "-->"');
  readTimestamp();

  const rest = t.slice(pos);
  if (rest === '') return;
  const lead = /^[\t\n\f\r ]*/.exec(rest)?.[0] ?? '';
  if (lead === '' || /[^ \t]/.test(lead)) {
    out.add(
      'timing-whitespace',
      'Separate the settings from the end time with spaces or tabs.',
      at(pos),
      at(pos + Math.max(lead.length, 1)),
    );
  }
  const settingsStart = pos + lead.length;
  const settings = t.slice(settingsStart);
  if (settings === '') return; // Whitespace followed by an empty settings list is allowed.
  const trail = /[\t\n\f\r ]*$/.exec(settings)?.[0].length ?? 0;
  if (trail > 0) {
    out.add(
      'cue-settings-whitespace',
      'Remove the whitespace after the last setting.',
      at(t.length - trail),
      at(t.length),
    );
  }
  if (/[\n\f\r]/.test(settings.slice(0, settings.length - trail))) {
    out.add(
      'cue-settings-whitespace',
      'Separate settings with spaces or tabs only.',
      at(settingsStart),
      at(t.length),
    );
  }
  checkSettingsList(settings, at(settingsStart), ctx);
}

function checkSettingsList(settings: string, offset: number, ctx: CueContext): void {
  const { out } = ctx;
  const seen = new Map<string, number>();
  let regionValue: string | null = null;
  let regionStart = 0;
  let regionEnd = 0;
  const outOfRegion: string[] = [];
  for (const token of tokens(settings, offset)) {
    const end = token.start + token.text.length;
    const colon = token.text.indexOf(':');
    if (colon <= 0 || colon === token.text.length - 1) {
      out.add(
        'cue-setting-malformed',
        `"${token.text}" is not a "name:value" setting.`,
        token.start,
        end,
      );
      continue;
    }
    const name = token.text.slice(0, colon);
    const value = token.text.slice(colon + 1);
    if (!CUE_SETTING_NAMES.has(name)) {
      out.add('cue-setting-unknown', `Unknown cue setting "${name}".`, token.start, end);
      continue;
    }
    if (seen.has(name)) {
      out.add('cue-setting-duplicate', `"${name}" appears more than once.`, token.start, end);
    }
    seen.set(name, token.start);
    const problem = checkCueSettingValue(name, value);
    if (problem === 'cue-line-not-integer') {
      out.add(
        problem,
        `Line number "${value}" must be an integer (or use a percentage).`,
        token.start,
        end,
      );
    } else if (problem) {
      out.add(problem, `"${value}" is not a valid value for "${name}".`, token.start, end);
    }
    if (name === 'region') {
      regionValue = value;
      regionStart = token.start;
      regionEnd = end;
    } else if (
      !problem &&
      (name === 'vertical' ||
        name === 'line' ||
        (name === 'size' && Number(value.slice(0, -1)) !== 100))
    ) {
      outOfRegion.push(name);
    }
  }
  if (regionValue !== null) {
    if (!ctx.definedRegions.has(regionValue)) {
      ctx.out.add(
        'cue-region-undefined',
        `No region "${regionValue}" is defined before the first cue.`,
        regionStart,
        regionEnd,
      );
    } else if (outOfRegion.length > 0) {
      ctx.out.add(
        'cue-region-ignored',
        `The "${outOfRegion.join('", "')}" setting takes this cue out of region "${regionValue}".`,
        regionStart,
        regionEnd,
      );
    }
  }
}

function checkRegionBlock(lines: Line[], out: Collector, regionIds: Map<string, number>): void {
  const settingsLines = lines.slice(1);
  const seen = new Set<string>();
  let id: Line | null = null;
  for (const line of settingsLines) {
    if (/^[\t\n\f\r ]|[\t\n\f\r ]$|[\n\f\r]/.test(line.text)) {
      out.add(
        'region-settings-whitespace',
        'Separate region settings with single spaces, tabs or line breaks only.',
        line.start,
        line.start + line.text.length,
      );
    }
    for (const token of tokens(line.text, line.start)) {
      const end = token.start + token.text.length;
      const colon = token.text.indexOf(':');
      if (colon <= 0 || colon === token.text.length - 1) {
        out.add(
          'region-setting-malformed',
          `"${token.text}" is not a "name:value" setting.`,
          token.start,
          end,
        );
        continue;
      }
      const name = token.text.slice(0, colon);
      const value = token.text.slice(colon + 1);
      if (!REGION_SETTING_NAMES.has(name)) {
        out.add('region-setting-unknown', `Unknown region setting "${name}".`, token.start, end);
        continue;
      }
      if (seen.has(name))
        out.add('region-setting-duplicate', `"${name}" appears more than once.`, token.start, end);
      seen.add(name);
      if (!checkRegionSettingValue(name, value)) {
        if (name === 'id')
          out.add('region-id-invalid', 'A region id must not contain "-->".', token.start, end);
        else
          out.add(
            'region-setting-value',
            `"${value}" is not a valid value for "${name}".`,
            token.start,
            end,
          );
      }
      if (name === 'id') id = { text: value, start: token.start };
    }
  }
  const first = lines[0] as Line;
  if (id === null) {
    out.add(
      'region-id-missing',
      'This region has no "id" setting, so no cue can use it.',
      first.start,
      first.start + first.text.length,
    );
  } else {
    const previous = regionIds.get(id.text);
    if (previous !== undefined) {
      out.add(
        'region-id-duplicate',
        `Region id "${id.text}" is already used.`,
        id.start,
        id.start + 3 + id.text.length,
      );
    }
    regionIds.set(id.text, id.start);
  }
}

function checkKeywordLine(line: Line, keyword: string, out: Collector): void {
  if (/[^ \t]/.test(line.text.slice(keyword.length))) {
    out.add(
      'block-keyword-whitespace',
      `Only spaces or tabs may follow "${keyword}".`,
      line.start,
      line.start + line.text.length,
    );
  }
}

/** Checks for chapters: every pair of cues nests or is disjoint (§4.5). */
function checkNesting(cues: ParsedCue[], out: Collector): void {
  // Sweep in start order (end descending for ties) with a stack of open intervals.
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const stack: ParsedCue[] = [];
  for (const cue of sorted) {
    while (stack.length > 0 && (stack[stack.length - 1] as ParsedCue).endMs <= cue.startMs)
      stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && cue.endMs > parent.endMs) {
      out.add(
        'chapters-not-nested',
        'This chapter overlaps another chapter without being contained in it.',
        cue.range.start,
        cue.range.end,
      );
    }
    stack.push(cue);
  }
}

/** Validates an import result against the syntax rules. */
export function validateImport(imp: ImportResult, options: ValidateOptions = {}): Diagnostic[] {
  const out = new Collector();
  const fileType = options.fileType ?? 'captions';
  const { normalized } = imp;
  if (!imp.ok) {
    out.add(
      'signature-invalid',
      'This file does not start with "WEBVTT", so it is not a WebVTT file.',
      0,
      Math.min(normalized.indexOf('\n') >>> 0, normalized.length),
    );
    return out.diagnostics;
  }

  const definedRegions = new Set(imp.parsed.regions.map((r) => r.id).filter((id) => id !== ''));
  const regionIds = new Map<string, number>();
  const cueIds = new Map<string, number>();
  const ctx: CueContext = { definedRegions, out };
  let previousStart = -Infinity;

  const blocks: BlockInfo[] = imp.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as BlockInfo;
    const lines = linesOf(normalized, block.range);
    const first = lines[0] as Line;
    const firstEnd = first.start + first.text.length;

    if (block.kind === 'signature') {
      // Two or more line terminators must follow. A non-empty header block has its own diagnostic.
      const after = normalized.slice(block.range.end, block.range.end + 2);
      const next = blocks[i + 1];
      if (after !== '\n\n' && !(next?.kind === 'header' && !isEmpty(next.range))) {
        out.add(
          'signature-line-terminators',
          'Add a blank line after the "WEBVTT" line.',
          block.range.start,
          block.range.end,
        );
      }
      continue;
    }

    // An empty header block means a cue directly follows the signature line (reported above).
    if (block.kind === 'header' && isEmpty(block.range)) continue;

    // Blocks after one that ended on an arrow line are missing their blank line.
    const prev = blocks[i - 1];
    if (
      prev &&
      prev.kind !== 'signature' &&
      prev.endedBy === 'arrow' &&
      !(prev.kind === 'header' && isEmpty(prev.range))
    ) {
      out.add(
        'block-missing-blank-line',
        'This line contains "-->", so it starts a new block without a blank line before it. Add a blank line, or write the arrow as "--&gt;" if it is text.',
        first.start,
        firstEnd,
      );
    }

    switch (block.kind) {
      case 'header':
        out.add(
          'header-text',
          'Text right after the "WEBVTT" line is ignored by parsers; separate it with a blank line or make it a NOTE.',
          block.range.start,
          block.range.end,
        );
        break;

      case 'note':
        break;

      case 'invalid-cue': {
        const arrowLine = lines.find((l) => l.text.includes('-->')) as Line;
        if (first.text.startsWith('NOTE')) {
          out.add(
            'note-contains-arrow',
            'A comment must not contain "-->"; parsers treat this line as cue timings and drop the block.',
            arrowLine.start,
            arrowLine.start + arrowLine.text.length,
          );
        } else {
          out.add(
            'cue-timings-invalid',
            'These cue timings are invalid, so parsers drop this whole cue.',
            arrowLine.start,
            arrowLine.start + arrowLine.text.length,
          );
        }
        break;
      }

      case 'discarded': {
        const isStyle = /^STYLE[\t\n\f\r ]*$/.test(first.text);
        const isRegion = /^REGION[\t\n\f\r ]*$/.test(first.text);
        if (isStyle && block.afterCue) {
          out.add(
            'style-after-cue',
            'STYLE blocks must come before the first cue; parsers ignore this one.',
            block.range.start,
            block.range.end,
          );
        } else if (isRegion && block.afterCue) {
          out.add(
            'region-after-cue',
            'REGION blocks must come before the first cue; parsers ignore this one.',
            block.range.start,
            block.range.end,
          );
        } else if (isStyle && lines.length === 1) {
          out.add('style-empty', 'This STYLE block is empty.', block.range.start, block.range.end);
        } else if (isRegion && lines.length === 1) {
          out.add(
            'region-id-missing',
            'This region has no "id" setting, so no cue can use it.',
            block.range.start,
            block.range.end,
          );
        } else {
          out.add(
            'block-discarded',
            'Parsers ignore this block: it is not a cue, a NOTE comment, a STYLE block or a REGION block.',
            block.range.start,
            block.range.end,
          );
        }
        break;
      }

      case 'style':
        checkKeywordLine(first, 'STYLE', out);
        for (const d of checkStylesheet(block.stylesheet?.css ?? '', (lines[1] as Line).start))
          out.diagnostics.push(d);
        break;

      case 'region':
        checkKeywordLine(first, 'REGION', out);
        checkRegionBlock(lines, out, regionIds);
        break;

      case 'cue': {
        const cue = block.cue as ParsedCue;
        const timingIndex = first.text.includes('-->') ? 0 : 1;
        const timing = lines[timingIndex] as Line;
        if (timingIndex === 1 && cue.id !== '') {
          const dup = cueIds.get(cue.id);
          if (dup !== undefined)
            out.add(
              'cue-id-duplicate',
              `Cue id "${cue.id}" is already used.`,
              first.start,
              firstEnd,
            );
          else cueIds.set(cue.id, first.start);
        }
        checkTimingLine(timing, ctx);
        const timingEnd = timing.start + timing.text.length;
        if (cue.startMs < previousStart) {
          out.add(
            'cue-start-order',
            'This cue starts before the previous cue.',
            timing.start,
            timingEnd,
          );
        }
        previousStart = Math.max(previousStart, cue.startMs);
        if (cue.endMs <= cue.startMs) {
          out.add(
            'cue-end-not-after-start',
            'The end time must be after the start time.',
            timing.start,
            timingEnd,
          );
        }
        const payloadStart = timingEnd + 1;
        if (fileType === 'captions') {
          for (const d of checkCueText(cue.text, payloadStart, cue.startMs, cue.endMs))
            out.diagnostics.push(d);
        } else if (fileType === 'chapters') {
          for (const d of checkChapterTitle(cue.text, payloadStart)) out.diagnostics.push(d);
        }
        break;
      }
    }
  }

  if (fileType === 'chapters') checkNesting(imp.parsed.cues, out);

  const last = blocks[blocks.length - 1];
  if (last && last.kind !== 'signature' && !normalized.endsWith('\n')) {
    out.add(
      'missing-final-line-terminator',
      'End the file with a line break.',
      normalized.length,
      normalized.length,
    );
  }

  out.diagnostics.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  return out.diagnostics;
}

/** Imports and validates decoded text. */
export function validate(text: string, options: ValidateOptions = {}): ValidationResult {
  const imp = importDocument(text);
  return { ...imp, diagnostics: validateImport(imp, options) };
}
