/**
 * Cue text tags that other tools write (SRT and HTML habits) and WebVTT does not have, read as
 * they were meant on import (Phase 4d): `<br>` is a line break, and `<font color>` becomes a
 * class. Parsers drop both tags (keeping the text), which runs words together across `<br>`
 * and loses the colour.
 */

/** The spec's default text colour classes (§7.2) and the colour each stands for. */
const DEFAULT_COLOURS: Record<string, string> = {
  white: '#ffffff',
  lime: '#00ff00',
  cyan: '#00ffff',
  red: '#ff0000',
  yellow: '#ffff00',
  magenta: '#ff00ff',
  blue: '#0000ff',
  black: '#000000',
};

export interface LegacyTag {
  /** Offsets of the whole tag in the cue text. */
  start: number;
  end: number;
  kind: 'br' | 'font' | 'font-end';
  /** For `font`: the colour attribute as written, if any. */
  color?: string;
}

const TAG = /<br\s*\/?>|<font\b[^>]*>|<\/font\s*>/gi;
const COLOR_ATTRIBUTE = /\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** The `<br>`, `<font …>` and `</font>` tags in raw cue text. */
export function findLegacyTags(text: string): LegacyTag[] {
  const tags: LegacyTag[] = [];
  for (const m of text.matchAll(TAG)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    const lower = raw.toLowerCase();
    if (lower.startsWith('<br')) tags.push({ start, end, kind: 'br' });
    else if (lower.startsWith('</')) tags.push({ start, end, kind: 'font-end' });
    else {
      const c = COLOR_ATTRIBUTE.exec(raw);
      const color = c?.[1] ?? c?.[2] ?? c?.[3];
      tags.push(
        color === undefined ? { start, end, kind: 'font' } : { start, end, kind: 'font', color },
      );
    }
  }
  return tags;
}

/**
 * The class for a colour, and the CSS colour a generated class needs (null for the spec's
 * default classes, which need no style sheet). Null when the colour is not one CSS reads.
 */
export function colourClass(color: string): { name: string; css: string | null } | null {
  let c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) c = `#${[...c.slice(1)].map((d) => d + d).join('')}`;
  if (c in DEFAULT_COLOURS) return { name: c, css: null };
  const named = Object.entries(DEFAULT_COLOURS).find(([, hex]) => hex === c);
  if (named) return { name: named[0], css: null };
  if (/^#[0-9a-f]{6}$/.test(c)) return { name: `color-${c.slice(1)}`, css: c };
  if (/^[a-z]+$/.test(c)) return { name: `color-${c}`, css: c };
  return null;
}

/**
 * Cue text with `<br>` as a line break and `<font color>` as a class span (`<c.yellow>`); other
 * `<font>` tags are dropped as parsers drop them, keeping their text. `classes` lists generated
 * classes with their CSS colour. Null when the text has none of these tags.
 */
export function modernizeCueText(
  text: string,
): { text: string; classes: Map<string, string> } | null {
  const tags = findLegacyTags(text);
  if (tags.length === 0) return null;
  const classes = new Map<string, string>();
  const open: boolean[] = []; // Per open <font>: whether it became a <c> span.
  let out = '';
  let last = 0;
  for (const tag of tags) {
    out += text.slice(last, tag.start);
    last = tag.end;
    if (tag.kind === 'br') {
      out += '\n';
    } else if (tag.kind === 'font') {
      const cls = tag.color === undefined ? null : colourClass(tag.color);
      open.push(cls !== null);
      if (cls) {
        out += `<c.${cls.name}>`;
        if (cls.css) classes.set(cls.name, cls.css);
      }
    } else if (open.pop()) {
      out += '</c>';
    }
  }
  out += text.slice(last);
  return { text: out, classes };
}

/** A STYLE block body giving each generated class its colour. */
export function colourStyleSheet(classes: Map<string, string>): string {
  return [...classes].map(([name, css]) => `::cue(.${name}) { color: ${css}; }`).join('\n');
}
