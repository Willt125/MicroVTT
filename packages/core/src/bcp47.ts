/**
 * BCP 47 language tags (RFC 5646), for <lang> annotations.
 *
 * Checks well-formedness against the RFC's ABNF plus the parts of validity that need no registry
 * (no repeated variant subtags, no repeated extension singletons). Checking that each subtag is
 * registered in the IANA Language Subtag Registry is not done: it would mean bundling the
 * registry (~9,000 records). See docs/SPEC-NOTES.md.
 */

const ALPHANUM = '[a-z0-9]';
const LANGUAGE = `(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})`;
const SCRIPT = '[a-z]{4}';
const REGION = '(?:[a-z]{2}|[0-9]{3})';
const VARIANT = `(?:${ALPHANUM}{5,8}|[0-9]${ALPHANUM}{3})`;
const SINGLETON = '[0-9a-wy-z]';
const EXTENSION = `${SINGLETON}(?:-${ALPHANUM}{2,8})+`;
const PRIVATE_USE = `x(?:-${ALPHANUM}{1,8})+`;

const LANGTAG = new RegExp(
  `^(${LANGUAGE})(?:-(${SCRIPT}))?(?:-(${REGION}))?((?:-${VARIANT})*)((?:-${EXTENSION})*)(?:-${PRIVATE_USE})?$`,
);
const PRIVATE_ONLY = new RegExp(`^${PRIVATE_USE}$`);

// RFC 5646 §2.1 "grandfathered" tags.
const GRANDFATHERED = new Set([
  'en-gb-oed',
  'i-ami',
  'i-bnn',
  'i-default',
  'i-enochian',
  'i-hak',
  'i-klingon',
  'i-lux',
  'i-mingo',
  'i-navajo',
  'i-pwn',
  'i-tao',
  'i-tay',
  'i-tsu',
  'sgn-be-fr',
  'sgn-be-nl',
  'sgn-ch-de',
  'art-lojban',
  'cel-gaulish',
  'no-bok',
  'no-nyn',
  'zh-guoyu',
  'zh-hakka',
  'zh-min',
  'zh-min-nan',
  'zh-xiang',
]);

/** True if `tag` is a well-formed BCP 47 tag without repeated variants or extensions. */
export function isValidLanguageTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  if (GRANDFATHERED.has(lower) || PRIVATE_ONLY.test(lower)) return true;
  const m = LANGTAG.exec(lower);
  if (!m) return false;
  const variants = (m[4] ?? '').split('-').filter(Boolean);
  if (new Set(variants).size !== variants.length) return false;
  const singletons = (m[5] ?? '').split('-').filter((s) => s.length === 1);
  return new Set(singletons).size === singletons.length;
}
