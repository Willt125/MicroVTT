/**
 * Chapters files: cues whose text is a chapter title (§4.2.3), which either nest or do not
 * overlap (§4.5, "only nested cues"). The outline of a chapters document, splitting a chapter at
 * a time, closing gaps and overlaps, and converting to and from the chapter lists video sites
 * read from a description ("0:00 Intro", one per line).
 */
import { extractChapterTitle } from './cuetext.ts';
import { createCue, type BodyItem, type Cue, type VttDocument } from './document.ts';

/** A chapter in the outline: its body index, how deeply it nests, and whether it crosses another. */
export interface ChapterEntry {
  index: number;
  cue: Cue;
  /** The title as viewers read it (character references decoded). */
  title: string;
  /** 0 for a top-level chapter, 1 inside one, and so on. */
  depth: number;
  /** True when it overlaps another chapter without either containing the other. */
  crosses: boolean;
}

const contains = (a: Cue, b: Cue): boolean => a.startMs <= b.startMs && b.endMs <= a.endMs;
const overlaps = (a: Cue, b: Cue): boolean => a.startMs < b.endMs && b.startMs < a.endMs;

/** The chapters in time order (an enclosing chapter before those inside it), with depth. */
export function chapterOutline(doc: VttDocument): ChapterEntry[] {
  const cues = doc.body
    .map((item, index) => ({ item, index }))
    .filter((x): x is { item: Cue; index: number } => x.item.type === 'cue')
    .sort((a, b) => a.item.startMs - b.item.startMs || b.item.endMs - a.item.endMs);
  return cues.map(({ item, index }, i) => {
    let depth = 0;
    let crosses = false;
    cues.forEach(({ item: other }, j) => {
      if (j === i || !overlaps(item, other)) return;
      const outer = contains(other, item) && !(contains(item, other) && j > i);
      if (outer) depth++;
      else if (!contains(item, other)) crosses = true;
    });
    return { index, cue: item, title: extractChapterTitle(item.text), depth, crosses };
  });
}

/** Top-level chapters (inside no other), in time order. */
const topLevel = (doc: VttDocument): ChapterEntry[] =>
  chapterOutline(doc).filter((c) => c.depth === 0);

/** A chapter title as WebVTT chapter title text: `&`, `<` and `>` escaped, on one line. */
export const chapterTitleText = (title: string): string =>
  title
    .replace(/\s*\n\s*/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Inserts `cue` among the cues by start time; returns the document and its body index. */
function insertCue(doc: VttDocument, cue: Cue): { document: VttDocument; index: number } {
  const at = doc.body.findIndex((i) => i.type === 'cue' && i.startMs > cue.startMs);
  const index = at === -1 ? doc.body.length : at;
  const body: BodyItem[] = [...doc.body];
  body.splice(index, 0, cue);
  return { document: { ...doc, body }, index };
}

/**
 * Starts a new chapter at `atMs`. Inside a top-level chapter, that chapter is split there: it
 * now ends at `atMs` and the new one runs to where it ended. Elsewhere, the new chapter runs to
 * the next chapter's start, or to `endMs` (the media's end) after the last one.
 */
export function splitChapterAt(
  doc: VttDocument,
  atMs: number,
  title: string,
  endMs?: number,
): { document: VttDocument; index: number } {
  const at = Math.max(0, Math.round(atMs));
  const chapters = topLevel(doc);
  const inside = chapters.find((c) => c.cue.startMs < at && at < c.cue.endMs);
  if (chapters.some((c) => c.cue.startMs === at))
    throw new RangeError('A chapter already starts there.');
  if (inside) {
    const body = [...doc.body];
    body[inside.index] = { ...inside.cue, endMs: at };
    return insertCue({ ...doc, body }, createCue(at, inside.cue.endMs, chapterTitleText(title)));
  }
  const next = chapters.find((c) => c.cue.startMs > at);
  const end = next?.cue.startMs ?? (endMs !== undefined && endMs > at ? endMs : at + 60_000);
  return insertCue(doc, createCue(at, end, chapterTitleText(title)));
}

/**
 * Makes the top-level chapters continuous: each ends where the next starts (closing gaps and
 * removing overlaps), the first starts at 0, and with `endMs` the last ends there. Chapters
 * inside others are left as they are. Returns the document unchanged when nothing moves.
 */
export function makeChaptersContinuous(doc: VttDocument, endMs?: number): VttDocument {
  const chapters = topLevel(doc);
  const body = [...doc.body];
  let changed = false;
  chapters.forEach((c, i) => {
    const next = chapters[i + 1];
    const startMs = i === 0 ? 0 : c.cue.startMs;
    const end = next ? next.cue.startMs : (endMs ?? c.cue.endMs);
    if (startMs !== c.cue.startMs || end !== c.cue.endMs) {
      body[c.index] = { ...c.cue, startMs, endMs: Math.max(end, startMs + 1) };
      changed = true;
    }
  });
  return changed ? { ...doc, body } : doc;
}

// Chapter lists ("0:00 Intro").

/** h:mm:ss or m:ss, as video sites write chapter times (milliseconds kept only when not whole). */
export function formatListTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const frac = ms % 1000 === 0 ? '' : `.${String(ms % 1000).padStart(3, '0')}`;
  const ss = `${String(s).padStart(2, '0')}${frac}`;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?`;
const SEP = String.raw`[\s\-–—:|·•]*`;
const LEADING = new RegExp(String.raw`^\s*(?:[-*•]\s*|\d+[.)]\s+)?[([]?${TIME}[)\]]?${SEP}(.*)$`);
const TRAILING = new RegExp(String.raw`^(.*?)${SEP}[([]?${TIME}[)\]]?\s*$`);

function timeOf(h?: string, m?: string, s?: string, frac?: string): number | null {
  const mm = Number(m);
  const ss = Number(s);
  if (ss > 59 || (h !== undefined && mm > 59)) return null;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return ((Number(h ?? 0) * 60 + mm) * 60 + ss) * 1000 + ms;
}

/** A chapter read from a list line. */
export interface ListedChapter {
  startMs: number;
  title: string;
  /** 1-based line in the list. */
  line: number;
}

/**
 * Reads a chapter list: one chapter per line, a time (m:ss or h:mm:ss) before or after its
 * title, e.g. "0:00 Intro", "1:02:03 - Part two", "Credits (58:10)". Lines without a time are
 * listed in `skipped`. Chapters come back in time order.
 */
export function parseChapterList(text: string): {
  chapters: ListedChapter[];
  skipped: number[];
} {
  const chapters: ListedChapter[] = [];
  const skipped: number[] = [];
  text.split(/\r\n?|\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    let m = LEADING.exec(line);
    let startMs: number | null = null;
    let title = '';
    if (m) {
      startMs = timeOf(m[1], m[2], m[3], m[4]);
      title = (m[5] ?? '').trim();
    } else if ((m = TRAILING.exec(line))) {
      startMs = timeOf(m[2], m[3], m[4], m[5]);
      title = (m[1] ?? '').trim();
    }
    if (startMs === null || title === '') skipped.push(i + 1);
    else chapters.push({ startMs, title, line: i + 1 });
  });
  chapters.sort((a, b) => a.startMs - b.startMs);
  return { chapters, skipped };
}

/**
 * Chapters cues for a list: each runs to where the next starts, the last to `endMs` (the
 * media's end; a minute after its start when unknown or too early). Two chapters at the same
 * time keep the first.
 */
export function chaptersFromList(list: readonly ListedChapter[], endMs?: number): Cue[] {
  const unique = list.filter((c, i) => i === 0 || c.startMs !== list[i - 1]?.startMs);
  return unique.map((c, i) => {
    const next = unique[i + 1];
    const end = next
      ? next.startMs
      : endMs !== undefined && endMs > c.startMs
        ? endMs
        : c.startMs + 60_000;
    return createCue(c.startMs, end, chapterTitleText(c.title));
  });
}

/**
 * The document's top-level chapters as a list ("0:00 Intro" lines), with what video sites would
 * object to: YouTube wants the first at 0:00, at least three chapters, each at least 10 s long.
 * Chapters inside others cannot be listed and are counted in `nestedLeftOut`.
 */
export function chapterList(doc: VttDocument): {
  text: string;
  nestedLeftOut: number;
  notes: string[];
} {
  const outline = chapterOutline(doc);
  const top = outline.filter((c) => c.depth === 0);
  const text = top
    .map((c) => `${formatListTime(c.cue.startMs)} ${c.title.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
  const notes: string[] = [];
  if (top.length > 0 && top[0]?.cue.startMs !== 0)
    notes.push('The first chapter does not start at 0:00.');
  if (top.length < 3) notes.push('There are fewer than three chapters.');
  const short = top.filter((c, i) => {
    const end = top[i + 1]?.cue.startMs ?? c.cue.endMs;
    return end - c.cue.startMs < 10_000;
  }).length;
  if (short > 0)
    notes.push(`${short} ${short === 1 ? 'chapter is' : 'chapters are'} shorter than 10 seconds.`);
  return { text, nestedLeftOut: outline.length - top.length, notes };
}
