/**
 * Style sheets for rendering cues (spec §8, "CSS extensions"): `::cue`, `::cue(selector)`,
 * `::cue-region` and `::cue-region(#id)` rules, rewritten as ordinary rules for a DOM in which
 * each cue is an element `.vtt-cue` (the root list of WebVTT Node Objects) holding an inline
 * `.vtt-bg` (the cue background box) and one element per WebVTT Internal Node Object, named as
 * the spec names them (c, i, b, u, ruby, rt, v, lang) with the class `vtt-node`. Regions are
 * elements `.vtt-region`. Only the properties the spec lets each pseudo-element set are kept.
 *
 * Rendering code adds: `data-vtt-id` (the cue identifier) on `.vtt-cue`, `voice` on `v`,
 * `lang` on `lang` and on the root, `data-vtt-region-id` on regions, and `vtt-past` /
 * `vtt-future` classes for the `:past` and `:future` pseudo-classes.
 */
import { parseStylesheet, type CssDeclaration } from './css.ts';

/** Element names of WebVTT Internal Node Objects (§8.2.2). */
const NODE_NAMES = new Set(['c', 'i', 'b', 'u', 'ruby', 'rt', 'v', 'lang']);

const SHARED = ['color', 'opacity', 'visibility', 'text-shadow'];
const SHARED_PREFIXES = ['text-decoration', 'background', 'outline'];
const SIZING = ['line-height', 'white-space', 'text-combine-upright', 'ruby-position'];
const SIZING_PREFIXES = ['font'];

const matches = (name: string, names: string[], prefixes: string[]): boolean =>
  names.includes(name) || prefixes.some((p) => name === p || name.startsWith(`${p}-`));

/** Properties that apply to `::cue` and `::cue-region` (§8.2.1, §8.2.4). */
const appliesToCue = (name: string): boolean =>
  matches(name, [...SHARED, ...SIZING], [...SHARED_PREFIXES, ...SIZING_PREFIXES]);

/**
 * Properties that apply to `::cue(selector)` (§8.2.2): sizing properties only when the selector
 * has no `:past` or `:future`.
 */
const appliesToCueArgument = (name: string, timed: boolean): boolean =>
  matches(name, SHARED, [...SHARED_PREFIXES, 'transition', 'animation']) ||
  (!timed && matches(name, SIZING, SIZING_PREFIXES));

const isBackground = (name: string): boolean =>
  name === 'background' || name.startsWith('background-');

/** Splits at top-level commas (not inside parentheses, brackets or strings). */
function splitList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\') i++;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** Reads a CSS identifier at `i` (with escapes); returns it and the index after it. */
function readIdent(text: string, i: number): [string, number] {
  let j = i;
  while (j < text.length) {
    const ch = text[j] as string;
    if (ch === '\\') j += 2;
    else if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 0x7f) j++;
    else break;
  }
  return [text.slice(i, j), j];
}

/** The index after the bracket group opening at `i` (strings inside are skipped). */
function skipGroup(text: string, i: number): number {
  const open = text[i] as string;
  const close = open === '(' ? ')' : ']';
  let depth = 0;
  let quote = '';
  for (let j = i; j < text.length; j++) {
    const ch = text[j] as string;
    if (quote) {
      if (ch === '\\') j++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\') j++;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return j + 1;
  }
  return text.length;
}

const cssString = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;

/** Pseudo-classes whose argument is a selector list, to be rewritten too. */
const SELECTOR_ARGUMENTS = new Set(['not', 'is', 'where', 'has', 'matches']);

/**
 * A `::cue()` argument as a selector for the rendering DOM, or null when it cannot match (a
 * pseudo-element inside, for example). Sets `timed` when it uses `:past` or `:future`.
 */
function rewriteCueSelector(selector: string, state: { timed: boolean }): string | null {
  let out = '';
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i] as string;
    if (ch === '"' || ch === "'") {
      const end = selector.indexOf(ch, i + 1);
      out += selector.slice(i, end === -1 ? selector.length : end + 1);
      i = end === -1 ? selector.length : end + 1;
    } else if (ch === '[') {
      const end = skipGroup(selector, i);
      out += selector.slice(i, end);
      i = end;
    } else if (ch === '#') {
      const [id, end] = readIdent(selector, i + 1);
      out += `[data-vtt-id=${cssString(id.replace(/\\(.)/g, '$1'))}]`;
      i = end;
    } else if (ch === '.') {
      const [name, end] = readIdent(selector, i + 1);
      out += `.${name}`;
      i = end;
    } else if (ch === ':') {
      if (selector[i + 1] === ':') return null; // No pseudo-elements inside ::cue().
      const [name, end] = readIdent(selector, i + 1);
      let args = '';
      let next = end;
      if (selector[end] === '(') {
        next = skipGroup(selector, end);
        args = selector.slice(end + 1, next - 1);
      }
      const lower = name.toLowerCase();
      if (lower === 'root') out += '.vtt-cue';
      else if (lower === 'past' || lower === 'future') {
        state.timed = true;
        out += `.vtt-${lower}`;
      } else if (SELECTOR_ARGUMENTS.has(lower)) {
        const inner = splitList(args).map((s) => rewriteCueSelector(s, state));
        if (inner.some((s) => s === null)) return null;
        out += `:${name}(${inner.join(', ')})`;
      } else out += selector.slice(i, next);
      i = next;
    } else if (ch === '*') {
      out += ':is(.vtt-cue, .vtt-node)';
      i++;
    } else if (/[A-Za-z_\\-]/.test(ch) || ch.charCodeAt(0) > 0x7f) {
      // A type selector: WebVTT names match their elements; other names match nothing.
      const [name, end] = readIdent(selector, i);
      out += NODE_NAMES.has(name.toLowerCase()) ? name.toLowerCase() : 'vtt-none';
      i = end;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** What a selector of the style sheet targets. */
type Target =
  | { kind: 'cue' }
  | { kind: 'cue-argument'; selector: string; timed: boolean }
  | { kind: 'region'; id: string | null };

/**
 * Parses `[prefix]::cue`, `::cue(…)`, `::cue-region` or `::cue-region(#id)`. Embedded style sheets
 * (STYLE blocks) apply to an element that matches no selector of its own, so any prefix there
 * means the rule matches nothing; a page's style sheet may name the video in front.
 */
function parseTarget(selector: string, embedded: boolean): Target | null {
  const m = /::cue(-region)?(?:\(([\s\S]*)\))?$/i.exec(selector);
  if (!m) return null;
  const prefix = selector.slice(0, m.index).trim();
  if (embedded && prefix !== '') return null;
  // The argument is everything inside the outermost parentheses.
  const open = selector.indexOf('(', m.index);
  const argument =
    m[2] === undefined ? null : selector.slice(open + 1, skipGroup(selector, open) - 1).trim();
  if (m[1]) {
    if (argument === null) return { kind: 'region', id: null };
    const id = /^#((?:[\w-]|\\.|[^\x20-\x7f])+)$/.exec(argument);
    return id ? { kind: 'region', id: (id[1] as string).replace(/\\(.)/g, '$1') } : null;
  }
  if (argument === null) return { kind: 'cue' };
  const state = { timed: false };
  const rewritten = splitList(argument).map((s) => rewriteCueSelector(s, state));
  if (rewritten.length === 0 || rewritten.some((s) => s === null)) return null;
  return { kind: 'cue-argument', selector: rewritten.join(', '), timed: state.timed };
}

/** URLs in STYLE blocks resolve only for data: URLs (§7.3). */
const blockedUrl = (value: string): boolean =>
  [...value.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)].some(
    (m) => !/^data:/i.test((m[2] as string).trim()),
  );

const declarationText = (declarations: CssDeclaration[]): string =>
  declarations.map((d) => `${d.name}: ${d.value};`).join(' ');

/** Prefixes a selector list with the scope, for each selector. */
const scoped = (scope: string, selectors: string[]): string =>
  selectors.map((s) => `${scope} ${s}`).join(', ');

/**
 * A style sheet rewritten for the rendering DOM inside `scope` (a selector for the element
 * holding one track's cues and regions). `embedded`: a STYLE block of the track itself, rather
 * than a style sheet of the page the video is in.
 */
export function scopeCueStylesheet(css: string, scope: string, embedded: boolean): string {
  const sheet = parseStylesheet(css);
  const out: string[] = [];
  for (const rule of sheet.validRules) {
    if (rule.atRule) {
      const name = /^@([\w-]+)/.exec(rule.prelude)?.[1]?.toLowerCase();
      if (rule.body === null) continue; // @import (blocked), @charset, @namespace, @layer list.
      if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container') {
        const inner = scopeCueStylesheet(rule.body, scope, embedded);
        if (inner) out.push(`${rule.prelude} { ${inner} }`);
      } else if (name === 'keyframes' || name === 'font-face') {
        if (!(embedded && blockedUrl(rule.body))) out.push(`${rule.prelude} { ${rule.body} }`);
      }
      continue;
    }
    const valid = rule.declarations.filter(
      (d) => !sheet.invalidDeclarations.has(d) && !(embedded && blockedUrl(d.value)),
    );
    const plain: string[] = [];
    const backgrounds: string[] = [];
    const regions: string[] = [];
    const argued = new Map<boolean, string[]>();
    for (const selector of splitList(rule.prelude)) {
      const target = parseTarget(selector, embedded);
      if (!target) continue;
      if (target.kind === 'cue') {
        plain.push('.vtt-cue');
        backgrounds.push('.vtt-cue > .vtt-bg');
      } else if (target.kind === 'region') {
        regions.push(
          target.id === null
            ? '.vtt-region'
            : `.vtt-region[data-vtt-region-id=${cssString(target.id)}]`,
        );
      } else {
        const list = argued.get(target.timed) ?? [];
        list.push(target.selector);
        argued.set(target.timed, list);
      }
    }
    const cueDeclarations = valid.filter((d) => appliesToCue(d.name.toLowerCase()));
    const emit = (selectors: string[], declarations: CssDeclaration[]): void => {
      if (selectors.length > 0 && declarations.length > 0)
        out.push(`${scoped(scope, selectors)} { ${declarationText(declarations)} }`);
    };
    // ::cue: the background goes on the cue background box.
    emit(
      plain,
      cueDeclarations.filter((d) => !isBackground(d.name.toLowerCase())),
    );
    emit(
      backgrounds,
      cueDeclarations.filter((d) => isBackground(d.name.toLowerCase())),
    );
    emit(regions, cueDeclarations);
    for (const [timed, selectors] of argued) {
      const declarations = valid.filter((d) => appliesToCueArgument(d.name.toLowerCase(), timed));
      emit(
        selectors,
        declarations.filter((d) => !isBackground(d.name.toLowerCase())),
      );
      // Backgrounds on the root list (selected by :root, an id or *) go on the background box.
      emit(
        selectors.flatMap((s) => [`${s}:not(.vtt-cue)`, `${s} > .vtt-bg`]),
        declarations.filter((d) => isBackground(d.name.toLowerCase())),
      );
    }
  }
  return out.join('\n');
}
