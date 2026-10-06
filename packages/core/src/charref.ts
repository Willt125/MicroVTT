/**
 * HTML character references, as consumed by the WebVTT cue text tokenizer.
 *
 * WebVTT (§6.4 "attempt to consume an HTML character reference") refers to HTML's original
 * "consume a character reference" algorithm, which takes an "additional allowed character" and,
 * when it does not recognize a reference, returns nothing and consumes nothing.
 */
import { MAX_NAMED_REFERENCE_LENGTH, NAMED_CHARACTER_REFERENCES } from './entities.generated.ts';

export interface CharacterReference {
  /** The characters the reference represents (one or two code points). */
  value: string;
  /** Index just past the last character consumed. */
  end: number;
}

// Numeric references to these C1 code points map to Windows-1252 characters instead.
const C1_REPLACEMENTS: ReadonlyMap<number, number> = new Map([
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);

const isAsciiDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isAsciiHexDigit = (c: number): boolean =>
  isAsciiDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
const isAsciiAlphanumeric = (c: number): boolean =>
  isAsciiDigit(c) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/**
 * Attempts to consume a character reference from `input` at `position`, which points just past
 * the U+0026 AMPERSAND. Returns null when nothing is consumed; the caller then emits a literal "&".
 */
export function consumeCharacterReference(
  input: string,
  position: number,
  additionalAllowedCharacter?: number,
): CharacterReference | null {
  if (position >= input.length) return null;
  const c = input.charCodeAt(position);
  // Tab, LF, FF, space, "<", "&", or the additional allowed character: not a reference.
  if (
    c === 0x09 ||
    c === 0x0a ||
    c === 0x0c ||
    c === 0x20 ||
    c === 0x3c ||
    c === 0x26 ||
    c === additionalAllowedCharacter
  ) {
    return null;
  }
  return c === 0x23 ? consumeNumeric(input, position + 1) : consumeNamed(input, position);
}

function consumeNumeric(input: string, position: number): CharacterReference | null {
  let pos = position;
  const x = input.charCodeAt(pos);
  const hex = x === 0x78 || x === 0x58;
  if (hex) pos++;
  const isDigit = hex ? isAsciiHexDigit : isAsciiDigit;
  const start = pos;
  while (pos < input.length && isDigit(input.charCodeAt(pos))) pos++;
  if (pos === start) return null; // Unconsume "#" (and "x").

  // Accumulate with saturation so arbitrarily long digit runs cannot lose the "too large" signal.
  let codePoint = 0;
  for (let i = start; i < pos; i++) {
    codePoint = codePoint * (hex ? 16 : 10) + parseInt(input[i] as string, 16);
    if (codePoint > 0x10ffff) codePoint = 0x110000;
  }
  if (input.charCodeAt(pos) === 0x3b) pos++;

  let value: number;
  if (codePoint === 0x00) value = 0xfffd;
  else if (C1_REPLACEMENTS.has(codePoint)) value = C1_REPLACEMENTS.get(codePoint) as number;
  else if ((codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) value = 0xfffd;
  else value = codePoint;
  return { value: String.fromCodePoint(value), end: pos };
}

function consumeNamed(input: string, position: number): CharacterReference | null {
  // Consume the longest run of characters that matches a name in the table. Names are ASCII
  // alphanumerics, optionally followed by ";".
  let best: CharacterReference | null = null;
  const limit = Math.min(input.length, position + MAX_NAMED_REFERENCE_LENGTH);
  let pos = position;
  while (pos < limit) {
    const c = input.charCodeAt(pos);
    if (c === 0x3b) {
      const value = NAMED_CHARACTER_REFERENCES.get(input.slice(position, pos + 1));
      if (value !== undefined) best = { value, end: pos + 1 };
      break;
    }
    if (!isAsciiAlphanumeric(c)) break;
    pos++;
    const value = NAMED_CHARACTER_REFERENCES.get(input.slice(position, pos));
    if (value !== undefined) best = { value, end: pos };
  }
  return best;
}
