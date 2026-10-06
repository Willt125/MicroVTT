/**
 * Minimal CSS support for STYLE blocks.
 *
 * A STYLE block "represents a CSS style sheet; the requirements given in the relevant CSS
 * specifications apply". This module parses at the level of CSS Syntax (rules, blocks,
 * declarations, strings, comments) to find syntax errors, and checks WebVTT's §8 restrictions:
 * only ::cue / ::cue-region rules affect cues, and only some properties apply to them.
 * Property values are not validated.
 */
import type { Diagnostic } from './diagnostics.ts';
import { diagnostic } from './diagnostics.ts';

export interface CssDeclaration {
  name: string;
  value: string;
  start: number;
  end: number;
}

export interface CssRule {
  /** "@media …" etc. for at-rules, the selector list for qualified rules. */
  prelude: string;
  atRule: boolean;
  /** Raw block contents (between the braces), or null for a statement at-rule. */
  body: string | null;
  /** Declarations of a qualified rule (nested rules are not listed). */
  declarations: CssDeclaration[];
  start: number;
  end: number;
}

export interface CssError {
  message: string;
  start: number;
  end: number;
}

export interface CssSheet {
  rules: CssRule[];
  errors: CssError[];
  /** Rules that are well-formed (parsers keep them). */
  validRules: CssRule[];
  /** Per valid rule: declarations that are well-formed. */
  invalidDeclarations: Set<CssDeclaration>;
}

/**
 * Scans from `pos` to the first unnested occurrence of one of `stops`, skipping strings,
 * comments, escapes and (), [] and {} groups. Records syntax errors along the way.
 */
function scan(css: string, pos: number, stops: string, errors: CssError[]): number {
  const closers: string[] = [];
  let i = pos;
  while (i < css.length) {
    const ch = css[i] as string;
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) {
        errors.push({ message: 'Unterminated comment.', start: i, end: css.length });
        return css.length;
      }
      i = end + 2;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) {
        if (css[j] === '\n') {
          errors.push({ message: 'Line break inside a string.', start: i, end: j });
          break;
        }
        j += css[j] === '\\' ? 2 : 1;
      }
      if (j >= css.length)
        errors.push({ message: 'Unterminated string.', start: i, end: css.length });
      i = j + 1;
      continue;
    }
    if (closers.length === 0 && stops.includes(ch)) return i;
    if (ch === '(' || ch === '[' || ch === '{') {
      closers.push(ch === '(' ? ')' : ch === '[' ? ']' : '}');
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (closers[closers.length - 1] === ch) closers.pop();
      else if (closers.length === 0)
        return i; // Unbalanced closer: let the caller decide.
      else errors.push({ message: `Unexpected "${ch}".`, start: i, end: i + 1 });
    }
    i++;
  }
  if (closers.length > 0) {
    errors.push({
      message: `Missing "${closers.reverse().join('')}" before the end of the style sheet.`,
      start: pos,
      end: css.length,
    });
  }
  return css.length;
}

const DECLARATION = /^\s*(--[^\s:]+|-?[A-Za-z_][A-Za-z0-9_-]*)\s*:([\s\S]*)$/;

function parseDeclarations(
  body: string,
  offset: number,
  errors: CssError[],
  invalid: Set<CssDeclaration>,
): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  let pos = 0;
  while (pos < body.length) {
    const end = scan(body, pos, ';{}', errors);
    if (body[end] === '{') {
      // A nested rule (CSS Nesting): skip its block.
      const close = scan(body, end + 1, '}', errors);
      pos = close + 1;
      continue;
    }
    const item = body.slice(pos, end);
    if (
      item.trim() !== '' &&
      item
        .trim()
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim() !== ''
    ) {
      const m = DECLARATION.exec(item.replace(/\/\*[\s\S]*?\*\//g, ''));
      const decl: CssDeclaration = {
        name: m?.[1] ?? '',
        value: (m?.[2] ?? '').trim(),
        start: offset + pos,
        end: offset + end,
      };
      declarations.push(decl);
      if (!m) {
        invalid.add(decl);
        errors.push({
          message: `"${item.trim()}" is not a "property: value" declaration.`,
          start: decl.start,
          end: decl.end,
        });
      }
    }
    pos = end + 1;
  }
  return declarations;
}

/** Parses a style sheet into rules, recording CSS syntax errors. */
export function parseStylesheet(css: string): CssSheet {
  const errors: CssError[] = [];
  const rules: CssRule[] = [];
  const validRules: CssRule[] = [];
  const invalidDeclarations = new Set<CssDeclaration>();
  let pos = 0;
  while (pos < css.length) {
    // Skip whitespace and comments between rules.
    const ws = /^(?:\s+|\/\*[\s\S]*?\*\/)*/.exec(css.slice(pos))?.[0].length ?? 0;
    pos += ws;
    if (pos >= css.length) break;
    if (css.startsWith('/*', pos)) {
      errors.push({ message: 'Unterminated comment.', start: pos, end: css.length });
      break;
    }
    const start = pos;
    const atRule = css[pos] === '@';
    const stop = scan(css, pos, atRule ? ';{' : '{', errors);
    const prelude = css.slice(pos, stop).trim();
    if (stop >= css.length) {
      errors.push({
        message: atRule
          ? `"${prelude}" is missing ";" or a { } block.`
          : `"${prelude}" has no { } block.`,
        start,
        end: css.length,
      });
      break;
    }
    if (css[stop] === '}') {
      errors.push({ message: 'Unexpected "}".', start: stop, end: stop + 1 });
      pos = stop + 1;
      continue;
    }
    if (css[stop] === ';') {
      const rule: CssRule = { prelude, atRule, body: null, declarations: [], start, end: stop + 1 };
      rules.push(rule);
      validRules.push(rule);
      pos = stop + 1;
      continue;
    }
    const close = scan(css, stop + 1, '}', errors);
    if (close >= css.length) {
      // CSS closes the block at the end of input (so browsers keep the rule), but it is an error.
      errors.push({ message: `"${prelude}" is missing its closing "}".`, start, end: css.length });
    }
    const body = css.slice(stop + 1, close);
    const rule: CssRule = {
      prelude,
      atRule,
      body,
      declarations: atRule ? [] : parseDeclarations(body, stop + 1, errors, invalidDeclarations),
      start,
      end: Math.min(close + 1, css.length),
    };
    rules.push(rule);
    if (prelude === '' && !atRule) {
      errors.push({ message: 'This rule has no selector.', start, end: stop + 1 });
    } else {
      validRules.push(rule);
    }
    pos = close + 1;
  }
  return { rules, errors, validRules, invalidDeclarations };
}

const CUE_PROPERTIES =
  /^(?:color|opacity|visibility|text-decoration(?:-[a-z-]+)?|text-shadow|background(?:-[a-z-]+)?|outline(?:-[a-z-]+)?|font(?:-[a-z-]+)?|line-height|white-space|text-combine-upright|ruby-position)$/;
const BOX_PROPERTIES =
  /^(?:font(?:-[a-z-]+)?|line-height|white-space|text-combine-upright|ruby-position)$/;
const ANIMATION_PROPERTIES = /^(?:transition|animation)(?:-[a-z-]+)?$/;

/** Splits a selector list on top-level commas. */
function selectorList(prelude: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(prelude.slice(start).trim());
  return parts;
}

/** Whether `property` applies under every selector in the list (§8). */
function propertyApplies(property: string, selectors: string[]): boolean {
  return selectors.every((sel) => {
    const lower = sel.toLowerCase();
    if (CUE_PROPERTIES.test(property)) {
      // Box-affecting properties do not apply with :past / :future.
      return !(BOX_PROPERTIES.test(property) && /::cue\(.*:(?:past|future)/.test(lower));
    }
    return ANIMATION_PROPERTIES.test(property) && /::cue\(/.test(lower);
  });
}

/** Diagnostics for a STYLE block's style sheet; `offset` is where the CSS starts in the input. */
export function checkStylesheet(css: string, offset: number): Diagnostic[] {
  const sheet = parseStylesheet(css);
  const out: Diagnostic[] = sheet.errors.map((e) =>
    diagnostic('style-css-syntax', e.message, {
      start: offset + e.start,
      end: offset + Math.max(e.end, e.start + 1),
    }),
  );
  for (const rule of sheet.rules) {
    if (rule.atRule) continue;
    const selectors = selectorList(rule.prelude);
    const nonCue = selectors.filter((sel) => !/::cue(?:-region)?(?![\w-])/i.test(sel));
    if (nonCue.length > 0) {
      out.push(
        diagnostic(
          'style-selector',
          `"${nonCue.join('", "')}" does not select ::cue or ::cue-region, so it has no effect on cues.`,
          {
            start: offset + rule.start,
            end: offset + rule.start + rule.prelude.length,
          },
        ),
      );
      continue;
    }
    for (const decl of rule.declarations) {
      if (sheet.invalidDeclarations.has(decl) || decl.name.startsWith('--')) continue;
      const property = decl.name.toLowerCase();
      if (!propertyApplies(property, selectors)) {
        out.push(
          diagnostic(
            'style-property-ignored',
            `"${decl.name}" does not apply to ::cue or ::cue-region and is ignored.`,
            {
              start: offset + decl.start,
              end: offset + decl.end,
            },
          ),
        );
      }
    }
  }
  return out;
}

/**
 * Rewrites a style sheet without the parts that fail to parse. Returns the input unchanged when
 * it has no syntax errors.
 */
export function repairStylesheet(css: string): string {
  const sheet = parseStylesheet(css);
  if (sheet.errors.length === 0) return css;
  const out: string[] = [];
  for (const rule of sheet.validRules) {
    if (rule.body === null) {
      out.push(`${rule.prelude};`);
    } else if (rule.atRule) {
      const inner = repairStylesheet(rule.body);
      out.push(`${rule.prelude} {\n${inner}\n}`);
    } else {
      const decls = rule.declarations
        .filter((d) => !sheet.invalidDeclarations.has(d))
        .map((d) => `  ${d.name}: ${d.value};`);
      out.push(`${rule.prelude} {\n${decls.join('\n')}\n}`);
    }
  }
  return out.join('\n');
}
