/** Helpers for rules whose fixes rewrite raw cue text, keeping the format's markup. */
import type { TextDialect } from '../format/dialect.ts';
import type { Cue } from '../document.ts';

/** Whether the cue's raw text is what is read (no markup or escapes), so it can be rewritten. */
export const isPlain = (info: { cue: Cue; dialect: TextDialect }): boolean =>
  !info.dialect.hasMarkup(info.cue.text);

const patterns = new WeakMap<TextDialect, Map<string, RegExp>>();
/**
 * A regular expression built around the dialect's markup: `source` gets `T` (one markup
 * token) and `C` (one closing token). Cached per dialect.
 */
export function markupPattern(
  dialect: TextDialect,
  source: (T: string, C: string) => string,
  flags = '',
): RegExp {
  let cache = patterns.get(dialect);
  if (!cache) patterns.set(dialect, (cache = new Map()));
  const key = `${source.toString()}/${flags}`;
  let re = cache.get(key);
  if (!re) cache.set(key, (re = new RegExp(source(dialect.tag, dialect.closingTag), flags)));
  re.lastIndex = 0;
  return re;
}
