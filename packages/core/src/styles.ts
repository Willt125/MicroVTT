/** Editing STYLE blocks: pure operations on the document, and checks for the styles editor. */
import { checkStylesheet, parseStylesheet } from './css.ts';
import { parseCueText, type CueNode } from './cuetext.ts';
import { DIAGNOSTICS, type DiagnosticCode, type Severity } from './diagnostics.ts';
import type { Style, VttDocument } from './document.ts';
import { wrapForBackground, wrapTimedParts } from './markup.ts';

/** A new STYLE block's starting text. */
export const NEW_STYLE_SHEET = '::cue {\n  \n}';

/** Adds a STYLE block after the last one (or at the end of the header); returns its head index. */
export function addStyle(
  doc: VttDocument,
  css = NEW_STYLE_SHEET,
): { document: VttDocument; index: number } {
  const last = doc.head.reduce((at, h, i) => (h.type === 'style' ? i : at), -1);
  const index = last === -1 ? doc.head.length : last + 1;
  const head = [...doc.head];
  head.splice(index, 0, { type: 'style', css });
  return { document: { ...doc, head }, index };
}

function styleAt(doc: VttDocument, index: number): Style {
  const item = doc.head[index];
  if (item?.type !== 'style') throw new RangeError(`No STYLE block at header index ${index}.`);
  return item;
}

/** Replaces the CSS of the STYLE block at header index `index`. */
export function updateStyle(doc: VttDocument, index: number, css: string): VttDocument {
  styleAt(doc, index);
  const head = [...doc.head];
  head[index] = { type: 'style', css };
  return { ...doc, head };
}

/** Deletes the STYLE block at header index `index`. */
export function deleteStyle(doc: VttDocument, index: number): VttDocument {
  styleAt(doc, index);
  return { ...doc, head: doc.head.filter((_, i) => i !== index) };
}

export interface StyleProblem {
  code: DiagnosticCode | 'style-blank-line' | 'style-arrow';
  severity: Severity;
  message: string;
  /** 1-based line of the CSS where it starts. */
  line: number;
}

/**
 * Problems in a style sheet as it is being written: what the validator reports (syntax, rules
 * that select no cue, properties that do not apply), with the line each starts on, and the two
 * things a STYLE block cannot hold, blank lines and "-->", which export removes.
 */
export function styleSheetProblems(css: string): StyleProblem[] {
  const lineOf = (offset: number): number => css.slice(0, offset).split('\n').length;
  const out: StyleProblem[] = checkStylesheet(css, 0).map((d) => ({
    code: d.code,
    severity: DIAGNOSTICS[d.code].severity,
    message: d.message,
    line: lineOf(d.range.start),
  }));
  for (const m of css.matchAll(/\n[ \t]*(?=\n)/g)) {
    if (css.slice(m.index).trim() === '') break; // Trailing blank lines are just dropped.
    out.push({
      code: 'style-blank-line',
      severity: 'warning',
      message: 'A blank line would end the STYLE block; export removes it.',
      line: lineOf(m.index) + 1,
    });
  }
  for (const m of css.matchAll(/-->/g))
    out.push({
      code: 'style-arrow',
      severity: 'warning',
      message: '"-->" cannot be in a STYLE block; export writes it as "--\\>".',
      line: lineOf(m.index),
    });
  return out.sort((a, b) => a.line - b.line);
}

/** Classes, voices and languages the document's cue text uses, with how many cues use each. */
export interface CueSelectors {
  classes: Map<string, number>;
  voices: Map<string, number>;
  languages: Map<string, number>;
}

export function cueSelectors(doc: VttDocument): CueSelectors {
  const out: CueSelectors = { classes: new Map(), voices: new Map(), languages: new Map() };
  const count = (map: Map<string, number>, key: string, seen: Set<string>, kind: string): void => {
    if (key === '' || seen.has(kind + key)) return;
    seen.add(kind + key);
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const item of doc.body) {
    if (item.type !== 'cue' || !/</.test(item.text)) continue;
    const seen = new Set<string>();
    const walk = (nodes: CueNode[]): void => {
      for (const node of nodes) {
        if (node.type === 'text' || node.type === 'timestamp') continue;
        for (const c of node.classes) count(out.classes, c, seen, '.');
        if (node.type === 'v') count(out.voices, node.annotation, seen, 'v');
        if (node.type === 'lang') count(out.languages, node.language ?? '', seen, 'l');
        walk(node.children);
      }
    };
    walk(parseCueText(item.text).children);
  }
  return out;
}

/** Selectors to start a rule from: every cue, the WebVTT elements, and what the document uses. */
export function ruleTemplates(selectors: CueSelectors): { label: string; css: string }[] {
  const quote = (s: string): string => `"${s.replace(/["\\]/g, '\\$&')}"`;
  const rule = (selector: string, body: string): string => `${selector} {\n  ${body}\n}`;
  return [
    { label: 'Every cue', css: rule('::cue', 'color: white;') },
    { label: 'Italic text (<i>)', css: rule('::cue(i)', 'color: yellow;') },
    { label: 'Bold text (<b>)', css: rule('::cue(b)', 'color: yellow;') },
    {
      label: 'Words not yet spoken, greyed (karaoke)',
      css: rule('::cue(:future)', 'color: grey;'),
    },
    {
      label: 'Words not yet spoken, hidden (paint-on)',
      css: rule('::cue(:future)', 'visibility: hidden;'),
    },
    {
      // The box is on the <c> spans, so it grows with the words shown; a <c> inside another
      // adds no second layer.
      label: 'Words not yet spoken, hidden, box growing with them (paint-on)',
      css: [
        rule('::cue', 'background: transparent;'),
        rule(`::cue(${PLAIN_C})`, 'background: rgba(0, 0, 0, 0.8);'),
        rule(`::cue(c ${PLAIN_C})`, 'background: transparent;'),
        rule('::cue(:future)', 'visibility: hidden;'),
      ].join('\n'),
    },
    { label: 'Every region', css: rule('::cue-region', 'background: transparent;') },
    ...[...selectors.classes.keys()].sort().map((c) => ({
      label: `Class .${c}`,
      css: rule(
        `::cue(.${CSS_IDENT.test(c) ? c : c.replace(/[^\w-]/g, (ch) => `\\${ch}`)})`,
        'color: yellow;',
      ),
    })),
    ...[...selectors.voices.keys()].sort().map((v) => ({
      label: `Voice ${v}`,
      css: rule(`::cue(v[voice=${quote(v)}])`, 'color: cyan;'),
    })),
    ...[...selectors.languages.keys()].sort().map((l) => ({
      label: `Language ${l}`,
      css: rule(`::cue(:lang(${l}))`, 'font-style: italic;'),
    })),
  ];
}

const CSS_IDENT = /^-?[_a-zA-Z][\w-]*$/;

/**
 * `c` without one of the spec's background colour classes (§5): those are presentational hints
 * below every style sheet, so a background rule on all `c` spans would hide them.
 */
const PLAIN_C = `c:not(${['white', 'lime', 'cyan', 'red', 'yellow', 'magenta', 'blue', 'black']
  .map((c) => `.bg_${c}`)
  .join(', ')})`;

/** `doc` with `wrap` applied to every cue's text; the same document when no cue changes. */
function mapCueText(doc: VttDocument, wrap: (text: string) => string): VttDocument {
  let changed = false;
  const body = doc.body.map((i) => {
    if (i.type !== 'cue') return i;
    const text = wrap(i.text);
    if (text === i.text) return i;
    changed = true;
    return { ...i, text };
  });
  return changed ? { ...doc, body } : doc;
}

/**
 * How many cues have timed text outside any tag, which `:past` and `:future` rules cannot reach
 * (see `wrapTimedParts`).
 */
export const cuesWithUntaggedTiming = (doc: VttDocument): number =>
  doc.body.filter((i) => i.type === 'cue' && wrapTimedParts(i.text) !== i.text).length;

/** `doc` with every cue's timed text in tags (`wrapTimedParts`); the same document when none changes. */
export const wrapTimedPartsInAll = (doc: VttDocument): VttDocument =>
  mapCueText(doc, wrapTimedParts);

/**
 * Whether a style sheet puts a background on `c` spans (`::cue(c)`): then text outside a `<c>`
 * gets that background only from the cue itself, which such sheets usually make transparent.
 */
export const backsCSpans = (css: string): boolean =>
  parseStylesheet(css).rules.some(
    (r) =>
      !r.atRule &&
      /::cue\(\s*c(?::not\([^)]*\))?\s*\)/.test(r.prelude) &&
      r.declarations.some((d) => d.name === 'background' || d.name === 'background-color'),
  );

/** How many cues have visible text outside a top-level `<c>` (see `wrapForBackground`). */
export const cuesOutsideC = (doc: VttDocument): number =>
  doc.body.filter((i) => i.type === 'cue' && wrapForBackground(i.text) !== i.text).length;

/** `doc` with every cue's text in `<c>` spans (`wrapForBackground`); the same document when none changes. */
export const wrapForBackgroundInAll = (doc: VttDocument): VttDocument =>
  mapCueText(doc, wrapForBackground);

/** How cue text is wrapped in `<c>` for style sheets: not at all, timed text, or all text. */
export type TextWrap = 'none' | 'timed' | 'all';

/**
 * The wrapping a document's style sheets need: all text when one backs `c` spans, timed text
 * when one uses `:past` or `:future`, else none.
 */
export function wrapForStyles(doc: VttDocument): TextWrap {
  const sheets = doc.head.flatMap((h) => (h.type === 'style' ? [h.css] : []));
  if (sheets.some(backsCSpans)) return 'all';
  return sheets.some((css) => /:(?:past|future)\b/.test(css)) ? 'timed' : 'none';
}

/** `text` wrapped as `wrap` says (`wrapTimedParts`, `wrapForBackground`). */
export const applyTextWrap = (text: string, wrap: TextWrap): string =>
  wrap === 'all' ? wrapForBackground(text) : wrap === 'timed' ? wrapTimedParts(text) : text;

/**
 * Cues whose text the document's style sheets cannot reach, by body index, with the wrapping
 * that fixes them (`wrapForStyles`): text outside a `<c>` where a sheet backs `c` spans, timed
 * text outside a tag where one uses `:past` or `:future`. Empty when no sheet needs either.
 */
export function cuesStylesMiss(doc: VttDocument): { wrap: TextWrap; cues: number[] } {
  const wrap = wrapForStyles(doc);
  const cues: number[] = [];
  if (wrap !== 'none')
    doc.body.forEach((item, i) => {
      if (item.type === 'cue' && applyTextWrap(item.text, wrap) !== item.text) cues.push(i);
    });
  return { wrap, cues };
}

/** `doc` with every cue wrapped as its style sheets need; the same document when none changes. */
export const wrapAsStylesNeed = (doc: VttDocument): VttDocument => {
  const wrap = wrapForStyles(doc);
  return wrap === 'none' ? doc : mapCueText(doc, (text) => applyTextWrap(text, wrap));
};
