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
/** An identifier with its CSS escapes (`\\31 `, `\\:`) resolved. */
function unescapeIdent(text: string): string {
  return text.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n]?|([\s\S]))/g,
    (_, hex?: string, ch?: string) => {
      if (hex === undefined) return ch ?? '';
      const code = parseInt(hex, 16);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(code);
    },
  );
}

function readIdent(text: string, i: number): [string, number] {
  let j = i;
  while (j < text.length) {
    const ch = text[j] as string;
    if (ch === '\\') {
      // An escape: up to six hex digits and one white space, or any one character.
      const hex = /^[0-9a-fA-F]{1,6}[ \t\n]?/.exec(text.slice(j + 1, j + 8));
      j += 1 + (hex ? hex[0].length : 1);
    } else if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 0x7f) j++;
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
  // Whether the current compound names its element (a type or universal selector). Compounds
  // that do not are limited to the cue and its nodes, so that :not() and the like cannot reach
  // the boxes the renderer adds around them.
  let typed = false;
  let compound = false;
  // A named namespace prefix: node objects are in the empty namespace (§8), so it cannot match.
  let foreign = false;
  const endCompound = (): void => {
    if (compound && !typed) out += ':is(.vtt-cue, .vtt-node)';
    if (foreign) out += ':not(*)';
    typed = false;
    compound = false;
    foreign = false;
  };
  const prefix = (at: number): boolean => selector[at] === '|' && selector[at + 1] !== '=';
  while (i < selector.length) {
    const ch = selector[i] as string;
    if (/[\s>+~]/.test(ch)) {
      endCompound();
      out += ch;
      i++;
      continue;
    }
    compound = true;
    // Namespace prefixes: `*|` and `|` (no namespace) match node objects.
    if (prefix(i)) {
      i++;
      continue;
    }
    if (ch === '*' && prefix(i + 1)) {
      i += 2;
      continue;
    }
    if (/[A-Za-z_\\-]/.test(ch) || ch.charCodeAt(0) > 0x7f) {
      const [, end] = readIdent(selector, i);
      if (prefix(end)) {
        foreign = true;
        i = end + 1;
        continue;
      }
    }
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
      out += `[data-vtt-id=${cssString(unescapeIdent(id))}]`;
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
      typed = true;
      i++;
    } else if (/[A-Za-z_\\-]/.test(ch) || ch.charCodeAt(0) > 0x7f) {
      // A type selector: WebVTT names match their elements; other names match nothing.
      const [name, end] = readIdent(selector, i);
      out += NODE_NAMES.has(name.toLowerCase()) ? name.toLowerCase() : 'vtt-none';
      typed = true;
      i = end;
    } else {
      out += ch;
      i++;
    }
  }
  endCompound();
  return out;
}

/**
 * Whether a compound selector matches the element STYLE blocks apply to (§7.3): a single empty
 * element with no name, no namespace, no attributes, classes or ID, and no parent or siblings.
 * Universal selectors (`*`, `*|*`, `|*`), `:not()`, `:is()` and `:where()` can match it;
 * names, namespaces, attributes, other pseudo-classes and combinators cannot.
 */
function matchesHypotheticalElement(selector: string): boolean {
  let i = 0;
  const text = selector.trim();
  if (text === '') return true;
  while (i < text.length) {
    const rest = text.slice(i);
    const universal = /^(?:\*\|\*|\|\*|\*)/.exec(rest);
    if (universal) {
      i += universal[0].length;
      continue;
    }
    if (rest.startsWith(':')) {
      const [name, end] = readIdent(text, i + 1);
      const lower = name.toLowerCase();
      if (text[end] !== '(' || !['not', 'is', 'where'].includes(lower)) return false;
      const close = skipGroup(text, end);
      const inner = splitList(text.slice(end + 1, close - 1)).map(matchesHypotheticalElement);
      if (lower === 'not' ? inner.some(Boolean) : !inner.some(Boolean)) return false;
      i = close;
      continue;
    }
    // A name, a namespace, a class, an ID, an attribute or a combinator.
    return false;
  }
  return true;
}

/**
 * A declaration's value closed the way the end of a style sheet closes it (CSS Syntax: brackets
 * and quotes left open at the end of the file are closed), so that it cannot swallow what the
 * renderer writes after it; null when it has a stray closing bracket.
 */
function closeValue(value: string): string | null {
  const open: string[] = [];
  let quote = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] as string;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\') i++;
    else if (ch === '(') open.push(')');
    else if (ch === '[') open.push(']');
    else if (ch === ')' || ch === ']') {
      if (open.pop() !== ch) return null;
    }
  }
  if (open.length === 0 && !quote) return value;
  return value.trimEnd() + quote + open.reverse().join('');
}

/** What a selector of the style sheet targets. */
type Target =
  | { kind: 'cue' }
  | { kind: 'cue-argument'; selector: string; timed: boolean }
  | { kind: 'region'; id: string | null };

/**
 * Parses `[prefix]::cue`, `::cue(…)`, `::cue-region` or `::cue-region(#id)`. Embedded style sheets
 * (STYLE blocks) apply to an element that only universal selectors match (see
 * matchesHypotheticalElement); a page's style sheet names the video, or nothing, in front.
 */
function parseTarget(selector: string, embedded: boolean): Target | null {
  const m = /::cue(-region)?(?:\(([\s\S]*)\))?$/i.exec(selector);
  if (!m) return null;
  const prefix = selector.slice(0, m.index).trim();
  if (embedded && !matchesHypotheticalElement(prefix)) return null;
  // The argument is everything inside the outermost parentheses.
  const open = selector.indexOf('(', m.index);
  const argument =
    m[2] === undefined ? null : selector.slice(open + 1, skipGroup(selector, open) - 1).trim();
  if (m[1]) {
    if (argument === null) return { kind: 'region', id: null };
    if (!argument.startsWith('#')) return null;
    const [id, end] = readIdent(argument, 1);
    return id && end === argument.length ? { kind: 'region', id: unescapeIdent(id) } : null;
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

const IMPORTANT = /!\s*important\s*$/i;

const declarationText = (declarations: CssDeclaration[]): string =>
  declarations.map((d) => `${d.name}: ${d.value};`).join(' ');

/** Prefixes a selector list with the scope, for each selector. */
const scoped = (scope: string, selectors: string[]): string =>
  selectors.map((s) => `${scope} ${s}`).join(', ');

/**
 * A style sheet rewritten for the rendering DOM inside `scope` (a selector for the element
 * holding one track's cues and regions). `embedded`: a STYLE block of the track itself, rather
 * than a style sheet of the page the video is in. `importance`: keep only normal or only
 * !important declarations (all by default).
 */
export function scopeCueStylesheet(
  css: string,
  scope: string,
  embedded: boolean,
  importance?: 'normal' | 'important',
): string {
  const sheet = parseStylesheet(css);
  const out: string[] = [];
  for (const rule of sheet.validRules) {
    if (rule.atRule) {
      const name = /^@([\w-]+)/.exec(rule.prelude)?.[1]?.toLowerCase();
      if (rule.body === null) continue; // @import (blocked), @charset, @namespace, @layer list.
      if (name === 'media' || name === 'supports' || name === 'layer' || name === 'container') {
        const inner = scopeCueStylesheet(rule.body, scope, embedded, importance);
        if (inner) out.push(`${rule.prelude} { ${inner} }`);
      } else if ((name === 'keyframes' || name === 'font-face') && importance !== 'important') {
        if (!(embedded && blockedUrl(rule.body))) out.push(`${rule.prelude} { ${rule.body} }`);
      }
      continue;
    }
    const valid = rule.declarations.flatMap((d) => {
      const value = closeValue(d.value);
      return sheet.invalidDeclarations.has(d) ||
        value === null ||
        (embedded && blockedUrl(value)) ||
        (importance !== undefined && IMPORTANT.test(value) !== (importance === 'important'))
        ? []
        : [{ ...d, value }];
    });
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
