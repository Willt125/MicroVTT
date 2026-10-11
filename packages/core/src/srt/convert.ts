/**
 * Converting between SubRip and WebVTT documents. What one format has and the other cannot say
 * is flattened or left out, and listed, so that a conversion never loses anything silently.
 */
import { parseCueText, type CueNode } from '../cuetext.ts';
import {
  createCue,
  createDocument,
  type BodyItem,
  type Cue,
  type VttDocument,
} from '../document.ts';
import { colourStyleSheet, modernizeCueText } from '../legacy-text.ts';
import { srtAnchor } from './text.ts';

/** Something a conversion could not carry over, and how many cues (or blocks) had it. */
export interface ConversionLoss {
  what: string;
  count: number;
}

export interface Conversion {
  document: VttDocument;
  lost: ConversionLoss[];
}

class Losses {
  private readonly counts = new Map<string, number>();
  add(what: string, n = 1): void {
    if (n > 0) this.counts.set(what, (this.counts.get(what) ?? 0) + n);
  }
  list(): ConversionLoss[] {
    return [...this.counts].map(([what, count]) => ({ what, count }));
  }
}

const SRT_TOKEN = /<\/?(?:[bBiIuUsS]|[fF][oO][nN][tT])(?:\s[^>\n]*)?>|\{\\[^}\n]*\}/g;
const escapeVtt = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** WebVTT settings for a SubRip position (numeric keypad: 7 8 9 top, 1 2 3 bottom). */
function anchorSettings(anchor: number): Partial<Cue> {
  const row = Math.floor((anchor - 1) / 3); // 0 bottom, 1 middle, 2 top
  const column = (anchor - 1) % 3; // 0 left, 1 centre, 2 right
  const out: Partial<Cue> = {};
  if (row === 2) out.line = 0;
  if (row === 1) Object.assign(out, { line: 50, snapToLines: false, lineAlign: 'center' });
  if (column === 0) out.align = 'left';
  if (column === 2) out.align = 'right';
  return out;
}

/** SubRip cue text as WebVTT cue text; what it loses is counted once per cue. */
function srtTextToVtt(text: string, losses: Losses, classes: Map<string, string>): string {
  const found = new Set<string>();
  const lost = { add: (what: string): void => void found.add(what) };
  const out = convertSrtText(text, lost, classes);
  for (const what of found) losses.add(what);
  return out;
}

function convertSrtText(
  text: string,
  lost: { add(what: string): void },
  classes: Map<string, string>,
): string {
  let out = '';
  let last = 0;
  const toggled: string[] = [];
  for (const m of text.matchAll(SRT_TOKEN)) {
    out += escapeVtt(text.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = m[0];
    if (tag.startsWith('{')) {
      for (const command of tag.slice(2, -1).split('\\')) {
        const toggle = /^([biu])([01])$/.exec(command);
        if (toggle) {
          const name = toggle[1] as string;
          if (toggle[2] === '1' && !toggled.includes(name)) {
            out += `<${name}>`;
            toggled.push(name);
          } else if (toggle[2] === '0' && toggled.includes(name)) {
            out += `</${name}>`;
            toggled.splice(toggled.indexOf(name), 1);
          }
        } else if (!/^an?[1-9]$/.test(command)) {
          lost.add('Override blocks other than position, italic, bold and underline ({\\…})');
        }
      }
    } else {
      const lower = tag.toLowerCase().replace(/\s+/g, ' ');
      if (/^<\/?s>$/.test(lower)) lost.add('Strikethrough (<s>)');
      else if (/^<\/?[biu]>$/.test(lower)) out += lower;
      else out += tag; // <font>: read below.
    }
  }
  out += escapeVtt(text.slice(last));
  out += toggled
    .reverse()
    .map((n) => `</${n}>`)
    .join('');
  if (/<font\b(?![^>]*\bcolor)[^>]*>/i.test(out))
    lost.add('Font faces and sizes (<font face/size>)');
  const modern = modernizeCueText(out);
  if (!modern) return out;
  for (const [name, css] of modern.classes) classes.set(name, css);
  return modern.text;
}

/** A SubRip document as WebVTT: markup, colours and positions carried over. */
export function srtToVtt(doc: VttDocument): Conversion {
  const lost = new Losses();
  const classes = new Map<string, string>();
  const body: BodyItem[] = doc.body.map((item) => {
    if (item.type !== 'cue') return item;
    const anchor = srtAnchor(item.text);
    const cue: Cue = {
      ...item,
      ...(anchor === null ? {} : anchorSettings(anchor)),
      text: srtTextToVtt(item.text, lost, classes),
    };
    delete cue.source;
    return cue;
  });
  const head = classes.size > 0 ? [{ type: 'style' as const, css: colourStyleSheet(classes) }] : [];
  return { document: { ...createDocument(), head, body }, lost: lost.list() };
}

/** The SubRip position for a cue's WebVTT settings, or null for the default (bottom centre). */
function settingsAnchor(cue: Cue): number | null {
  let row = 0;
  if (cue.line !== 'auto') {
    if (cue.snapToLines) row = cue.line >= 0 ? 2 : 0;
    else row = cue.line < 33 ? 2 : cue.line < 67 ? 1 : 0;
  }
  const column = cue.align === 'left' ? 0 : cue.align === 'right' ? 2 : 1;
  const anchor = row * 3 + column + 1;
  return anchor === 2 ? null : anchor;
}

/** WebVTT cue text as SubRip cue text; what it loses is counted once per cue. */
function vttTextToSrt(text: string, losses: Losses, colours: Map<string, string>): string {
  const found = new Set<string>();
  const lost = { add: (what: string): void => void found.add(what) };
  const out = convertVttText(text, lost, colours);
  for (const what of found) losses.add(what);
  return out;
}

function convertVttText(
  text: string,
  lost: { add(what: string): void },
  colours: Map<string, string>,
): string {
  const write = (nodes: CueNode[]): string =>
    nodes
      .map((node): string => {
        switch (node.type) {
          case 'text':
            return node.value;
          case 'timestamp':
            lost.add('Word timings (<00:00:01.000>)');
            return '';
          case 'b':
          case 'i':
          case 'u':
            return `<${node.type}>${write(node.children)}</${node.type}>`;
          case 'rt':
            lost.add('Ruby text (<rt>)');
            return '';
          case 'v':
            if (node.annotation) lost.add('Voice names (<v Name>)');
            return write(node.children);
          case 'lang':
            lost.add('Language spans (<lang>)');
            return write(node.children);
          default: {
            const colour = node.classes.map((c) => colours.get(c)).find((c) => c !== undefined);
            if (node.classes.length > 0 && colour === undefined) lost.add('Classes (<c.name>)');
            const inner = write(node.children);
            return colour === undefined ? inner : `<font color="${colour}">${inner}</font>`;
          }
        }
      })
      .join('');
  return write(parseCueText(text).children);
}

/** A WebVTT document as SubRip: cues with their markup and position; the rest is listed. */
export function vttToSrt(doc: VttDocument): Conversion {
  const lost = new Losses();
  // Colours: the spec's default classes, and classes a STYLE block gives a colour.
  const colours = new Map<string, string>(
    ['white', 'lime', 'cyan', 'red', 'yellow', 'magenta', 'blue', 'black'].map((c) => [c, c]),
  );
  for (const item of doc.head) {
    if (item.type === 'style') {
      for (const m of item.css.matchAll(
        /::cue\(\.([\w-]+)\)\s*\{[^}]*?(?<![-\w])color\s*:\s*([^;}]+)/g,
      ))
        colours.set(m[1] as string, (m[2] as string).trim());
      lost.add('Style sheets (STYLE blocks), apart from text colours');
    } else if (item.type === 'region') lost.add('Regions (REGION blocks)');
    else if (item.preserved !== 'header') lost.add('Comments (NOTE blocks)');
  }
  if (doc.title.trim() !== '') lost.add('The text after "WEBVTT"');
  const body: BodyItem[] = [];
  for (const item of doc.body) {
    if (item.type !== 'cue') {
      lost.add('Comments (NOTE blocks)');
      continue;
    }
    if (item.vertical !== '') lost.add('Vertical text');
    if (item.size !== 100) lost.add('Cue box sizes');
    if (item.region !== null) lost.add('Regions (REGION blocks)');
    if (item.id !== '') lost.add('Cue identifiers');
    const anchor = settingsAnchor(item);
    const text = vttTextToSrt(item.text, lost, colours);
    body.push(
      createCue(item.startMs, item.endMs, anchor === null ? text : `{\\an${anchor}}${text}`),
    );
  }
  return { document: { ...createDocument(), body }, lost: lost.list() };
}
