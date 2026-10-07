/**
 * Export-time repair: makes every value in a document expressible as conforming WebVTT, and
 * reports each change. `serialize(repair(doc).document)` always validates without errors; the
 * property tests enforce this for arbitrary input.
 *
 * Where possible a repair preserves what a user agent would show. For example, `line` "auto"
 * with `snapToLines` false renders exactly like `line:100%`, so that is what gets written.
 */
import { isValidLanguageTag } from './bcp47.ts';
import { repairStylesheet } from './css.ts';
import type { CueNode, CueSpanNode } from './cuetext.ts';
import { extractChapterTitle, parseCueText } from './cuetext.ts';
import { checkChapterTitle, checkCueText } from './cuetext-check.ts';
import type { DiagnosticCode } from './diagnostics.ts';
import type { BodyItem, Cue, HeadItem, Note, Region, VttDocument } from './document.ts';
import { serializeCueText } from './serialize.ts';
import type { FileType } from './validate.ts';

export interface RepairEntry {
  code: DiagnosticCode;
  message: string;
  /** The item changed: its kind and its index in `head` or `body` of the repaired document. */
  target?: { list: 'head' | 'body'; index: number } | { list: 'title' };
}

export interface RepairOptions {
  fileType?: FileType;
}

export interface RepairResult {
  document: VttDocument;
  report: RepairEntry[];
}

const finiteOr = (n: number, fallback: number): number => (Number.isFinite(n) ? n : fallback);

/** The largest time (ms) for which "time + 1 ms" is still exact. */
const MAX_TIME = Number.MAX_SAFE_INTEGER - 1;

/**
 * What a parser would read back for a string: NUL becomes U+FFFD, CRLF and CR become LF (§6.1).
 * Applied to every string before anything else, so the export round-trips.
 */
// eslint-disable-next-line no-control-regex
const asParsed = (s: string): string => s.replace(/\u0000/g, '\ufffd').replace(/\r\n?/g, '\n');
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const percentage = (n: number, fallback: number): number => clamp(finiteOr(n, fallback), 0, 100);

/** Removes blank lines, CRs and leading/trailing line feeds from multi-line text. */
function tidyLines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line !== '')
    .join('\n');
}

const breakArrows = (text: string): string => text.replace(/-->/g, '-- >');

function repairNoteText(text: string): string {
  let t = asParsed(text);
  if (t !== '' && !/^[ \t\n]/.test(t)) t = ` ${t}`;
  // Keep the separator after "NOTE", then tidy the rest.
  const sep = t.charAt(0);
  const body = breakArrows(tidyLines(t.slice(sep === '\n' ? 1 : 0)));
  if (body === '') return '';
  return sep === '\n' ? `\n${body}` : body;
}

/** Valid class name characters: anything but tab, LF, CR, space, "&", "<", ">", ".". */
const VALID_CLASS = /^[^\t\n\r &<>.]+$/;

interface TreeContext {
  startMs: number;
  endMs: number;
  lastTimestamp: number;
}

function repairNodes(nodes: CueNode[], ctx: TreeContext): CueNode[] {
  const out: CueNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      out.push(node);
    } else if (node.type === 'timestamp') {
      if (node.ms > ctx.lastTimestamp && node.ms > ctx.startMs && node.ms < ctx.endMs) {
        ctx.lastTimestamp = node.ms;
        out.push(node);
      }
    } else {
      out.push(...repairSpan(node, ctx));
    }
  }
  return out;
}

function repairSpan(node: CueSpanNode, ctx: TreeContext): CueNode[] {
  const children = repairNodes(node.children, ctx);
  const span: CueSpanNode = {
    ...node,
    classes: node.classes.filter((c) => VALID_CLASS.test(c)),
    children,
  };
  if (node.type === 'v' && !/[^ \t]/.test(node.annotation)) return children;
  if (node.type === 'lang' && !isValidLanguageTag(node.language ?? '')) return children;
  if (node.type === 'ruby') {
    let lastRt = -1;
    children.forEach((child, i) => {
      if (child.type === 'rt') lastRt = i;
    });
    if (lastRt === -1) return children;
    const tail = children.slice(lastRt + 1);
    const tailIsSpace = tail.every((n) => n.type === 'text' && /^[ \t\n]*$/.test(n.value));
    if (!tailIsSpace) {
      span.children = children.slice(0, lastRt + 1);
      return [span, ...tail];
    }
  }
  return [span];
}

/** Rewrites caption cue text so it conforms, keeping its structure where possible. */
export function repairCueText(text: string, startMs: number, endMs: number): string {
  const tree = parseCueText(text);
  const ctx: TreeContext = { startMs, endMs, lastTimestamp: startMs };
  // Unwrapping or dropping markup can leave empty lines behind, which would split the cue.
  const rebuilt = tidyLines(serializeCueText(repairNodes(tree.children, ctx)));
  if (checkCueText(rebuilt, 0, startMs, endMs).length === 0) return rebuilt;
  // Should not happen; fall back to the plain text so the export still conforms.
  return extractChapterTitle(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function uniqueName(base: string, used: Set<string>): string {
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Returns a repaired copy of `doc` and a report of every change. The input is not modified. */
export function repair(doc: VttDocument, options: RepairOptions = {}): RepairResult {
  const fileType = options.fileType ?? 'captions';
  const report: RepairEntry[] = [];
  const note = (code: DiagnosticCode, message: string, target?: RepairEntry['target']): void => {
    report.push(target ? { code, message, target } : { code, message });
  };

  // Title: a single line.
  let title = asParsed(doc.title);
  if (/\n/.test(title)) {
    title = title.replace(/\n+/g, ' ');
    note('signature-line-terminators', 'Line breaks in the title were replaced with spaces.', {
      list: 'title',
    });
  }

  // Head: notes, style sheets and regions.
  // Null marks an earlier duplicate region, removed at the end.
  const head: (HeadItem | null)[] = [];
  const regionRenames = new Map<string, string>();
  const regionByIdIndex = new Map<string, number>();
  for (const item of doc.head) {
    if (item.type === 'note') {
      const fixed = fixNote(item, 'head', head.length, note);
      head.push(fixed);
    } else if (item.type === 'style') {
      const source = asParsed(item.css);
      let css = repairStylesheet(source);
      if (css !== source)
        note('style-css-syntax', 'Parts of a style sheet that do not parse were removed.', {
          list: 'head',
          index: head.length,
        });
      css = tidyLines(css).replace(/-->/g, '--\\>');
      if (css.trim() === '') {
        note('style-empty', 'An empty STYLE block was removed.');
        continue;
      }
      head.push({ ...item, css });
    } else {
      const region = repairRegion(item, regionRenames, head.length, note);
      if (region === null) continue;
      const previous = regionByIdIndex.get(region.id);
      if (previous !== undefined) {
        // Cues use the last region with a given id: drop the earlier one.
        head[previous] = null;
        note(
          'region-id-duplicate',
          `An earlier region with id "${region.id}" was removed; cues use the last one.`,
        );
      }
      regionByIdIndex.set(region.id, head.length);
      head.push(region);
    }
  }
  const cleanHead = head.filter((item): item is HeadItem => item !== null);
  const regionIds = new Set(
    cleanHead.filter((i): i is Region => i.type === 'region').map((r) => r.id),
  );

  // Body: cues and notes. Group each cue with the notes before it, then sort by start time.
  const units: { notes: Note[]; cue: Cue | null }[] = [];
  let pending: Note[] = [];
  for (const item of doc.body) {
    if (item.type === 'note') pending.push(item);
    else {
      units.push({ notes: pending, cue: item });
      pending = [];
    }
  }
  const trailing = pending;
  // Sort on the times repair will write, so NaN or fractional input cannot misorder the output.
  const startOf = (u: { cue: Cue | null }): number => normalizeTimes(u.cue as Cue)[0];
  const sorted = [...units].sort((a, b) => startOf(a) - startOf(b));
  if (sorted.some((u, i) => u !== units[i]))
    note('cue-start-order', 'Cues were sorted by start time.');

  const body: BodyItem[] = [];
  const usedIds = new Set<string>();
  for (const unit of [...sorted, { notes: trailing, cue: null }]) {
    for (const n of unit.notes) body.push(fixNote(n, 'body', body.length, note));
    if (unit.cue)
      body.push(
        repairCue(unit.cue, {
          fileType,
          regionIds,
          regionRenames,
          usedIds,
          index: body.length,
          note,
        }),
      );
  }

  if (fileType === 'chapters') fixChapterNesting(body, note);

  // Notes before the first cue are read back as part of the head: put them there.
  const firstCue = body.findIndex((item) => item.type === 'cue');
  const leading = body.splice(0, firstCue === -1 ? body.length : firstCue) as Note[];
  cleanHead.push(...leading);

  return { document: { title, head: cleanHead, body }, report };
}

type Note_ = (code: DiagnosticCode, message: string, target?: RepairEntry['target']) => void;

function fixNote(item: Note, list: 'head' | 'body', index: number, note: Note_): Note {
  const text = repairNoteText(item.text);
  if (item.preserved === 'header') {
    note('header-text', 'Text after the "WEBVTT" line was kept as a NOTE comment.', {
      list,
      index,
    });
  } else if (item.preserved === 'discarded') {
    note('block-discarded', 'Text that parsers ignore was kept as a NOTE comment.', {
      list,
      index,
    });
  }
  if (text !== item.text && item.text.includes('-->')) {
    note('note-contains-arrow', 'An arrow in a comment was broken up ("-- >").', { list, index });
  }
  return { ...item, text };
}

function repairRegion(
  input: Region,
  renames: Map<string, string>,
  index: number,
  note: Note_,
): Region | null {
  const target = { list: 'head' as const, index };
  const region: Region = { ...input, id: asParsed(input.id) };
  if (region.id === '') {
    note('region-id-missing', 'A region without an id was removed.');
    return null;
  }
  let id = region.id;
  if (/[\t\n\f\r ]|-->/.test(id)) {
    id = id.replace(/-->/g, '--_').replace(/[\t\n\f\r ]+/g, '_');
    renames.set(input.id, id);
    note('region-id-invalid', `Region "${region.id}" was renamed to "${id}".`, target);
  }
  const fixed: Region = {
    ...region,
    id,
    width: percentage(region.width, 100),
    lines: Math.max(0, Math.round(finiteOr(region.lines, 3))),
    regionAnchorX: percentage(region.regionAnchorX, 0),
    regionAnchorY: percentage(region.regionAnchorY, 100),
    viewportAnchorX: percentage(region.viewportAnchorX, 0),
    viewportAnchorY: percentage(region.viewportAnchorY, 100),
    scroll: region.scroll === 'up' ? 'up' : '',
  };
  const changed = (
    [
      'width',
      'lines',
      'regionAnchorX',
      'regionAnchorY',
      'viewportAnchorX',
      'viewportAnchorY',
      'scroll',
    ] as const
  ).filter((k) => fixed[k] !== region[k]);
  if (changed.length > 0)
    note(
      'region-setting-value',
      `Out-of-range region values were corrected (${changed.join(', ')}).`,
      target,
    );
  return fixed;
}

/** Whole, non-negative milliseconds within the exact-integer range (end before the +1 ms fix). */
function normalizeTimes(cue: Cue): [number, number] {
  const start = clamp(Math.round(finiteOr(cue.startMs, 0)), 0, MAX_TIME - 1);
  const end = clamp(Math.round(finiteOr(cue.endMs, start + 1)), 0, MAX_TIME);
  return [start, end];
}

interface CueRepairContext {
  fileType: FileType;
  regionIds: Set<string>;
  regionRenames: Map<string, string>;
  usedIds: Set<string>;
  index: number;
  note: Note_;
}

function repairCue(cue: Cue, ctx: CueRepairContext): Cue {
  const target = { list: 'body' as const, index: ctx.index };
  const note = (code: DiagnosticCode, message: string): void => ctx.note(code, message, target);
  const c: Cue = {
    ...cue,
    id: asParsed(cue.id),
    text: asParsed(cue.text),
    region: cue.region === null ? null : asParsed(cue.region),
  };
  // Editor state for moving a late REGION block (see quickfix.ts), not part of the file.
  delete c.unresolvedRegion;

  // Identifier: one line, no arrow, unique.
  if (/\n|-->/.test(c.id)) {
    c.id = breakArrows(c.id.replace(/\n+/g, ' '));
    note('cue-id-invalid', 'Line breaks or "-->" in a cue id were replaced.');
  }
  if (c.id !== '') {
    if (ctx.usedIds.has(c.id)) {
      const renamed = uniqueName(c.id, ctx.usedIds);
      note('cue-id-duplicate', `Duplicate cue id "${c.id}" was renamed to "${renamed}".`);
      c.id = renamed;
    }
    ctx.usedIds.add(c.id);
  }

  // Times: non-negative integers, end after start.
  const [start, end] = normalizeTimes(c);
  if (start !== c.startMs || end !== c.endMs)
    note('timestamp-syntax', 'Cue times were rounded to whole milliseconds.');
  c.startMs = start;
  c.endMs = end;
  if (c.endMs <= c.startMs) {
    c.endMs = c.startMs + 1;
    note('cue-end-not-after-start', 'The end time was set to 1 ms after the start time.');
  }

  // Settings.
  if (c.vertical !== '' && c.vertical !== 'rl' && c.vertical !== 'lr') c.vertical = '';
  if (!['start', 'center', 'end'].includes(c.lineAlign)) c.lineAlign = 'start';
  if (!['start', 'center', 'end', 'left', 'right'].includes(c.align)) c.align = 'center';
  if (!['line-left', 'center', 'line-right', 'auto'].includes(c.positionAlign))
    c.positionAlign = 'auto';
  if (c.line !== 'auto' && !Number.isFinite(c.line)) c.line = 'auto';
  if (c.line === 0) c.line = 0; // -0 is written as "0" and read back as +0.
  if (!c.snapToLines && (c.line === 'auto' || c.line < 0 || c.line > 100)) {
    // Renders as 100% (cue computed line), so write exactly that.
    c.line = 100;
    note(
      'cue-setting-value',
      'A line position that cannot be written was replaced by "line:100%", which renders the same.',
    );
  }
  if (c.snapToLines && c.line !== 'auto' && !Number.isInteger(c.line)) {
    c.line = Math.round(c.line);
    note('cue-line-not-integer', 'A fractional line number was rounded.');
  }
  if (c.line === 'auto' && c.lineAlign !== 'start') {
    c.lineAlign = 'start';
    note(
      'cue-setting-value',
      'A line alignment without a line position cannot be written and was dropped.',
    );
  }
  if (c.position !== 'auto') {
    const p = percentage(c.position, 50);
    if (p !== c.position)
      note('cue-setting-value', 'An out-of-range position was clamped to 0–100%.');
    c.position = p;
  } else if (c.positionAlign !== 'auto') {
    c.positionAlign = 'auto';
    note(
      'cue-setting-value',
      'A position alignment without a position cannot be written and was dropped.',
    );
  }
  const size = percentage(c.size, 100);
  if (size !== c.size) note('cue-setting-value', 'An out-of-range size was clamped to 0–100%.');
  c.size = size;

  // Region reference.
  if (c.region !== null) {
    const renamed = ctx.regionRenames.get(c.region) ?? c.region;
    if (!ctx.regionIds.has(renamed)) {
      note('cue-region-undefined', `The reference to undefined region "${c.region}" was removed.`);
      c.region = null;
    } else if (c.vertical !== '' || c.line !== 'auto' || c.size !== 100) {
      note(
        'cue-region-ignored',
        `The cue was taken out of region "${c.region}" (it has a vertical, line or size setting).`,
      );
      c.region = null;
    } else {
      c.region = renamed;
    }
  }

  // Text: no blank lines, no arrows, valid payload for the file type.
  let text = tidyLines(c.text);
  if (text !== c.text)
    note('block-missing-blank-line', 'Blank lines inside the cue text were removed.');
  if (ctx.fileType === 'captions' || ctx.fileType === 'chapters') {
    text = text.replace(/-->/g, '--&gt;');
    const problems =
      ctx.fileType === 'captions'
        ? checkCueText(text, 0, c.startMs, c.endMs)
        : checkChapterTitle(text, 0);
    if (problems.length > 0) {
      text =
        ctx.fileType === 'captions'
          ? repairCueText(text, c.startMs, c.endMs)
          : extractChapterTitle(text)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
      const kinds = new Set(problems.map((p) => p.code)).size;
      note(
        problems[0]?.code ?? 'cue-text-tag',
        `The cue text was rewritten to fix ${problems.length} markup ${problems.length === 1 ? 'problem' : 'problems'}${kinds > 1 ? ` of ${kinds} kinds` : ''}.`,
      );
    }
  } else {
    text = breakArrows(text);
  }
  c.text = text;
  return c;
}

/** Chapters must nest: trim a chapter that runs past one starting inside it. */
function fixChapterNesting(body: BodyItem[], note: Note_): void {
  const cues = body.filter((i): i is Cue => i.type === 'cue');
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < cues.length; i++) {
      const a = cues[i] as Cue;
      for (let j = i + 1; j < cues.length; j++) {
        const b = cues[j] as Cue;
        const partial = b.startMs > a.startMs && b.startMs < a.endMs && b.endMs > a.endMs;
        if (partial) {
          a.endMs = b.startMs;
          note(
            'chapters-not-nested',
            `A chapter was shortened to end where the next one starts (${b.startMs} ms).`,
          );
          changed = true;
        }
      }
    }
  }
}
